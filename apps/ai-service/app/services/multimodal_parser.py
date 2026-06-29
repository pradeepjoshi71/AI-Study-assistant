"""
MultiModalParser
================
After standard PDF text extraction, this service performs:

1. **Image Extraction** — PyMuPDF `page.get_images()` extracts all embedded XObject images.
2. **Table Extraction** — Camelot lattice (grid-bordered) then stream (borderless) per page.
3. **Visual Classification** — DETR (facebook/detr-resnet-50) classifies each image as
   diagram / chart / figure / photo using a heuristic label map.
4. **Resize** — All images resized so the longest side ≤ 1024 px (Lanczos).
5. **Minio Upload** — Images stored at `orgs/{orgId}/docs/{docId}/images/{imageId}.png`.
6. **GPT-4o Caption** — Each image/table thumbnail sent to GPT-4o Vision with surrounding
   page text to produce a 2-sentence caption.
7. **Redis Caption Cache** — Keyed on `caption:sha256(<raw_image_bytes>)`, TTL 30 days.
   On cache hit the GPT-4o call is skipped entirely.

Output
------
Each `ModalAsset` dict contains::

    {
        "modality":   "IMAGE" | "TABLE" | "DIAGRAM",
        "page_ref":   int,
        "storage_key": str,               # Minio key
        "image_hash":  str,               # hex SHA256 of original bytes
        "width":       int,
        "height":      int,
        "caption":     str,
        "from_cache":  bool,
    }
"""
from __future__ import annotations

import hashlib
import io
import logging
import os
import tempfile
import uuid
from typing import Any, Dict, List, Optional, Tuple

logger = logging.getLogger(__name__)

# ── Optional heavy dependencies — all wrapped so the service degrades gracefully ─

try:
    import fitz  # PyMuPDF
except ImportError:
    fitz = None

try:
    from PIL import Image as PILImage
except ImportError:
    PILImage = None

try:
    import camelot
except ImportError:
    camelot = None

try:
    import torch
    from transformers import DetrImageProcessor, DetrForObjectDetection
    _DETR_AVAILABLE = True
except ImportError:
    torch = None  # type: ignore
    DetrImageProcessor = None  # type: ignore
    DetrForObjectDetection = None  # type: ignore
    _DETR_AVAILABLE = False

try:
    import openai as _openai_mod
    _OPENAI_AVAILABLE = True
except ImportError:
    _openai_mod = None
    _OPENAI_AVAILABLE = False

import base64
import json

from app.core.config import settings
from app.services.minio_storage import upload_image, build_image_key

# ── DETR label heuristics ────────────────────────────────────────────────────

# COCO labels that map to "DIAGRAM" modality
_DIAGRAM_LABELS = {"chart", "graph", "diagram", "flow", "plot", "pie", "bar", "line"}
# COCO labels that map to "TABLE" modality (rarely output by DETR, backup)
_TABLE_LABELS = {"dining table", "table"}
# Default for photos
_PHOTO_LABEL = "IMAGE"

# Maximum pixel dimension after resize
_MAX_DIM = 1024

# Redis caption cache TTL: 30 days in seconds
_CACHE_TTL = 30 * 24 * 3600

# ── DETR model (singleton) ───────────────────────────────────────────────────

_detr_processor: Optional[Any] = None
_detr_model: Optional[Any] = None


def _load_detr():
    """Lazily loads the DETR model the first time classification is needed."""
    global _detr_processor, _detr_model
    if _detr_processor is not None:
        return True
    if not _DETR_AVAILABLE:
        logger.warning("DETR (transformers) not available. Defaulting all images to IMAGE modality.")
        return False
    try:
        logger.info("Loading DETR model (facebook/detr-resnet-50)...")
        _detr_processor = DetrImageProcessor.from_pretrained("facebook/detr-resnet-50")
        _detr_model = DetrForObjectDetection.from_pretrained("facebook/detr-resnet-50")
        _detr_model.eval()
        logger.info("DETR model loaded.")
        return True
    except Exception as exc:
        logger.error(f"Failed to load DETR model: {exc}")
        return False


# ── Helpers ──────────────────────────────────────────────────────────────────

def _sha256_hex(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _resize_image(img: "PILImage.Image", max_dim: int = _MAX_DIM) -> "PILImage.Image":
    """Resize so longest side ≤ max_dim, preserving aspect ratio."""
    w, h = img.size
    if max(w, h) <= max_dim:
        return img
    ratio = max_dim / max(w, h)
    new_size = (max(1, int(w * ratio)), max(1, int(h * ratio)))
    return img.resize(new_size, PILImage.LANCZOS)


def _img_to_png_bytes(img: "PILImage.Image") -> bytes:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _pil_from_bytes(raw: bytes) -> Optional["PILImage.Image"]:
    if not PILImage:
        return None
    try:
        return PILImage.open(io.BytesIO(raw)).convert("RGB")
    except Exception as exc:
        logger.debug(f"PIL open failed: {exc}")
        return None


def _classify_image(img: "PILImage.Image") -> str:
    """
    Run DETR on a PIL image and return ChunkModality string.
    Heuristic: if the highest-confidence detection label matches chart/diagram terms → DIAGRAM.
    Otherwise → IMAGE.
    """
    if not _load_detr() or not _DETR_AVAILABLE:
        return _PHOTO_LABEL

    try:
        inputs = _detr_processor(images=img, return_tensors="pt")
        with torch.no_grad():
            outputs = _detr_model(**inputs)

        target_sizes = torch.tensor([img.size[::-1]])
        results = _detr_processor.post_process_object_detection(
            outputs, threshold=0.5, target_sizes=target_sizes
        )[0]

        best_label = None
        best_score = 0.0
        for score, label in zip(results["scores"], results["labels"]):
            sc = float(score)
            lbl = _detr_model.config.id2label.get(int(label), "").lower()
            if sc > best_score:
                best_score = sc
                best_label = lbl

        if best_label:
            for kw in _DIAGRAM_LABELS:
                if kw in best_label:
                    return "DIAGRAM"
            for kw in _TABLE_LABELS:
                if kw in best_label:
                    return "TABLE"
        return _PHOTO_LABEL

    except Exception as exc:
        logger.error(f"DETR classification failed: {exc}")
        return _PHOTO_LABEL


def _get_redis_client():
    """Returns a Redis client using ai-service settings."""
    import redis
    return redis.Redis(
        host=settings.AI_REDIS_HOST,
        port=settings.AI_REDIS_PORT,
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
    )


def _get_openai_client():
    if not _OPENAI_AVAILABLE or not settings.OPENAI_API_KEY:
        return None
    return _openai_mod.OpenAI(api_key=settings.OPENAI_API_KEY)


def _generate_caption(
    image_bytes: bytes,
    page_text: str,
    image_hash: str,
) -> Tuple[str, bool]:
    """
    Returns (caption, from_cache).
    Checks Redis first; on miss, calls GPT-4o Vision, stores result.
    """
    cache_key = f"caption:{image_hash}"

    # ── Redis cache hit ──
    try:
        redis_client = _get_redis_client()
        cached = redis_client.get(cache_key)
        if cached:
            logger.debug(f"Caption cache HIT for hash {image_hash[:12]}…")
            return cached, True
    except Exception as exc:
        logger.warning(f"Redis caption cache read failed: {exc}")
        redis_client = None

    # ── GPT-4o Vision call ──
    openai_client = _get_openai_client()
    if not openai_client:
        logger.warning("OpenAI client unavailable. Returning placeholder caption.")
        return "Visual content extracted from document. No caption available without OpenAI key.", False

    try:
        b64 = base64.b64encode(image_bytes).decode("utf-8")
        context_snippet = page_text[:600].strip() if page_text else ""
        prompt = (
            "You are an academic assistant. Given the following image extracted from a study document "
            "and the surrounding page text, write exactly 2 concise sentences describing the content "
            "of the image (what it shows and why it is relevant to the document).\n\n"
            f"Surrounding page context:\n{context_snippet}\n\nImage caption:"
        )

        response = openai_client.chat.completions.create(
            model="gpt-4o",
            messages=[
                {
                    "role": "user",
                    "content": [
                        {"type": "text", "text": prompt},
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/png;base64,{b64}",
                                "detail": "low",
                            },
                        },
                    ],
                }
            ],
            max_tokens=120,
            temperature=0.3,
        )
        caption = response.choices[0].message.content.strip()

        # ── Store in Redis ──
        try:
            if redis_client:
                redis_client.set(cache_key, caption, ex=_CACHE_TTL)
        except Exception as exc:
            logger.warning(f"Redis caption cache write failed: {exc}")

        return caption, False

    except Exception as exc:
        logger.error(f"GPT-4o caption generation failed: {exc}")
        return "Caption generation failed.", False


# ── Main Parser Class ────────────────────────────────────────────────────────

class MultiModalParser:
    """
    Processes a PDF file and extracts all multimodal assets:
    embedded images, table screenshots, and DETR-classified diagrams.

    Usage::

        parser = MultiModalParser(org_id="org_abc", doc_id="doc_xyz")
        assets = parser.parse_pdf("/tmp/document.pdf")
        # assets: List[ModalAsset dict]
    """

    def __init__(self, org_id: str, doc_id: str):
        self.org_id = org_id
        self.doc_id = doc_id

    # ── Public API ────────────────────────────────────────────────────────────

    def parse_pdf(self, pdf_path: str) -> List[Dict[str, Any]]:
        """
        Full multimodal extraction pipeline for a PDF file.
        Returns a list of ModalAsset dicts.
        """
        if not fitz:
            logger.error("PyMuPDF (fitz) is required for MultiModalParser but is not installed.")
            return []

        assets: List[Dict[str, Any]] = []

        try:
            doc = fitz.open(pdf_path)
            page_texts: Dict[int, str] = {}

            # Pre-collect page text for caption context
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                page_texts[page_idx + 1] = page.get_text().strip()

            # ── Phase 1: Extract embedded images per page ──
            for page_idx in range(len(doc)):
                page = doc[page_idx]
                page_num = page_idx + 1
                image_list = page.get_images(full=True)

                for img_info in image_list:
                    xref = img_info[0]
                    try:
                        raw_asset = self._process_embedded_image(
                            doc=doc,
                            xref=xref,
                            page_num=page_num,
                            page_text=page_texts.get(page_num, ""),
                        )
                        if raw_asset:
                            assets.append(raw_asset)
                    except Exception as exc:
                        logger.warning(f"Failed to process image xref={xref} on page {page_num}: {exc}")

            doc.close()

        except Exception as exc:
            logger.error(f"MultiModalParser: PDF open/image extraction failed: {exc}")

        # ── Phase 2: Table extraction with Camelot ──
        table_assets = self._extract_tables(pdf_path, page_texts)
        assets.extend(table_assets)

        logger.info(
            f"MultiModalParser: extracted {len(assets)} multimodal assets "
            f"({sum(1 for a in assets if a['modality'] != 'TABLE')} images, "
            f"{sum(1 for a in assets if a['modality'] == 'TABLE')} tables) "
            f"from {pdf_path}"
        )
        return assets

    # ── Phase 1: Embedded image extraction ───────────────────────────────────

    def _process_embedded_image(
        self,
        doc: Any,
        xref: int,
        page_num: int,
        page_text: str,
    ) -> Optional[Dict[str, Any]]:
        """Extract one image XObject, resize, classify, caption, upload."""
        if not PILImage:
            logger.warning("Pillow not available. Skipping image extraction.")
            return None

        # Fetch raw image bytes from PDF XObject
        base_image = doc.extract_image(xref)
        raw_bytes: bytes = base_image["image"]

        if len(raw_bytes) < 512:
            # Too small — likely a decorative rule or icon; skip
            return None

        image_hash = _sha256_hex(raw_bytes)

        # Open + resize
        pil_img = _pil_from_bytes(raw_bytes)
        if pil_img is None:
            return None

        pil_img = _resize_image(pil_img)
        w, h = pil_img.size
        resized_bytes = _img_to_png_bytes(pil_img)

        # Classify modality
        modality = _classify_image(pil_img)

        # Caption (cached or GPT-4o)
        caption, from_cache = _generate_caption(resized_bytes, page_text, image_hash)

        # Upload to Minio
        image_id = str(uuid.uuid4())
        storage_key = upload_image(
            image_bytes=resized_bytes,
            org_id=self.org_id,
            doc_id=self.doc_id,
            image_id=image_id,
        )

        return {
            "modality": modality,
            "page_ref": page_num,
            "storage_key": storage_key,
            "image_hash": image_hash,
            "width": w,
            "height": h,
            "caption": caption,
            "from_cache": from_cache,
        }

    # ── Phase 2: Table extraction with Camelot ────────────────────────────────

    def _extract_tables(
        self,
        pdf_path: str,
        page_texts: Dict[int, str],
    ) -> List[Dict[str, Any]]:
        """
        Runs Camelot lattice (bordered tables) then stream (borderless) on each page.
        Renders each detected table as a PNG thumbnail, uploads to Minio, captions it.
        """
        if camelot is None:
            logger.warning("Camelot not installed. Skipping table extraction.")
            return []
        if PILImage is None:
            logger.warning("Pillow not available. Cannot render table thumbnails.")
            return []

        assets: List[Dict[str, Any]] = []

        for flavor in ("lattice", "stream"):
            try:
                tables = camelot.read_pdf(
                    pdf_path,
                    pages="all",
                    flavor=flavor,
                    suppress_stdout=True,
                )
            except Exception as exc:
                logger.warning(f"Camelot {flavor} extraction failed: {exc}")
                continue

            for tbl in tables:
                page_num = tbl.page
                try:
                    asset = self._process_table(tbl, page_num, page_texts.get(page_num, ""), flavor)
                    if asset:
                        assets.append(asset)
                except Exception as exc:
                    logger.warning(f"Failed to process Camelot table on page {page_num}: {exc}")

        return assets

    def _process_table(
        self,
        tbl: Any,
        page_num: int,
        page_text: str,
        flavor: str,
    ) -> Optional[Dict[str, Any]]:
        """Render a Camelot table to a PNG thumbnail and process it as a TABLE asset."""
        if not PILImage:
            return None

        # Render table DataFrame as a simple PNG via matplotlib (no display)
        try:
            import matplotlib
            matplotlib.use("Agg")
            import matplotlib.pyplot as plt

            df = tbl.df
            if df.empty or df.shape[0] < 2:
                return None  # Skip trivial tables

            fig, ax = plt.subplots(figsize=(min(14, df.shape[1] * 1.8), min(10, df.shape[0] * 0.5 + 1)))
            ax.axis("off")
            rendered = ax.table(
                cellText=df.values,
                colLabels=df.columns.tolist(),
                loc="center",
                cellLoc="center",
            )
            rendered.auto_set_font_size(False)
            rendered.set_fontsize(8)
            plt.tight_layout()

            buf = io.BytesIO()
            plt.savefig(buf, format="png", dpi=120, bbox_inches="tight")
            plt.close(fig)
            buf.seek(0)
            raw_bytes = buf.read()

        except Exception as exc:
            logger.warning(f"Table PNG render failed (flavor={flavor}): {exc}")
            return None

        image_hash = _sha256_hex(raw_bytes)

        pil_img = _pil_from_bytes(raw_bytes)
        if pil_img is None:
            return None
        pil_img = _resize_image(pil_img)
        w, h = pil_img.size
        resized_bytes = _img_to_png_bytes(pil_img)

        caption, from_cache = _generate_caption(resized_bytes, page_text, image_hash)

        image_id = str(uuid.uuid4())
        storage_key = upload_image(
            image_bytes=resized_bytes,
            org_id=self.org_id,
            doc_id=self.doc_id,
            image_id=image_id,
        )

        return {
            "modality": "TABLE",
            "page_ref": page_num,
            "storage_key": storage_key,
            "image_hash": image_hash,
            "width": w,
            "height": h,
            "caption": caption,
            "from_cache": from_cache,
        }
