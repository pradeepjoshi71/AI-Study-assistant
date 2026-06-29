"""
EmbeddingService (extended with multimodal routing)
====================================================

Modality routing:
  TEXT / TABLE  → OpenAI text-embedding-3-small (1536-dim)
                  Tables are first serialized to Markdown text.
  IMAGE / DIAGRAM → CLIP ViT-B/32 (512-dim, torch inference)

The CLIP model is loaded once at module import time and shared across all
EmbeddingService instances.  Text embeddings retain the existing Redis cache
(TTL 7 days, keyed on SHA256 of cleaned text).  CLIP embeddings are also
cached in Redis (TTL 7 days, keyed on SHA256 of raw image bytes).
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import random
from typing import Any, Dict, List, Optional, Tuple

import redis
from openai import OpenAI

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── CLIP singleton ────────────────────────────────────────────────────────────

_clip_model = None
_clip_preprocess = None
_clip_device = "cpu"
_clip_loaded = False


def _load_clip() -> bool:
    """Lazily load CLIP ViT-B/32 on first use."""
    global _clip_model, _clip_preprocess, _clip_device, _clip_loaded
    if _clip_loaded:
        return _clip_model is not None

    try:
        import torch
        import clip as openai_clip  # pip: git+https://github.com/openai/CLIP.git or 'clip' pkg

        _clip_device = "cuda" if torch.cuda.is_available() else "cpu"
        _clip_model, _clip_preprocess = openai_clip.load("ViT-B/32", device=_clip_device)
        _clip_model.eval()
        _clip_loaded = True
        logger.info(f"CLIP ViT-B/32 loaded on device={_clip_device}.")
        return True
    except Exception as exc:
        logger.error(f"CLIP load failed: {exc}. Image embeddings will be mocked (zero vectors).")
        _clip_loaded = True  # mark as attempted — won't retry every call
        return False


def _clip_embed_pil(pil_img: Any) -> List[float]:
    """Encode one PIL image via CLIP; returns 512-dim float list."""
    import torch

    if not _load_clip() or _clip_model is None:
        return [0.0] * 512

    try:
        tensor = _clip_preprocess(pil_img).unsqueeze(0).to(_clip_device)
        with torch.no_grad():
            features = _clip_model.encode_image(tensor)
            features = features / features.norm(dim=-1, keepdim=True)  # L2 normalise
        return features[0].tolist()
    except Exception as exc:
        logger.error(f"CLIP encode failed: {exc}")
        return [0.0] * 512


def _clip_embed_bytes(image_bytes: bytes) -> List[float]:
    """Decode raw image bytes and encode via CLIP."""
    try:
        from PIL import Image as PILImage
        pil_img = PILImage.open(io.BytesIO(image_bytes)).convert("RGB")
        return _clip_embed_pil(pil_img)
    except Exception as exc:
        logger.error(f"Image decode for CLIP failed: {exc}")
        return [0.0] * 512


# ── Markdown table serialiser ─────────────────────────────────────────────────

def _df_to_markdown(df: Any) -> str:
    """Convert a pandas/camelot DataFrame to a Markdown table string."""
    try:
        return df.to_markdown(index=False)
    except Exception:
        # Fallback: pipe-delimited rows
        rows = [" | ".join(str(c) for c in row) for row in df.values]
        header = " | ".join(str(c) for c in df.columns)
        sep = " | ".join(["---"] * len(df.columns))
        return "\n".join([header, sep] + rows)


# ── EmbeddingService ──────────────────────────────────────────────────────────

class EmbeddingService:
    """
    Generates vector embeddings with modality-aware routing.

    TEXT / TABLE  → OpenAI text-embedding-3-small → 1536-dim
    IMAGE / DIAGRAM → CLIP ViT-B/32 → 512-dim
    """

    # Redis TTLs
    TEXT_CACHE_TTL = 604_800   # 7 days
    IMAGE_CACHE_TTL = 604_800  # 7 days

    def __init__(self):
        self.openai_api_key = settings.OPENAI_API_KEY
        self.has_openai = bool(self.openai_api_key and self.openai_api_key.strip())

        if self.has_openai:
            self.client = OpenAI(api_key=self.openai_api_key)
            logger.info("OpenAI client initialised for EmbeddingService.")
        else:
            self.client = None
            logger.warning("OPENAI_API_KEY missing. EmbeddingService text mode running in Mock Mode.")

        # Redis cache
        try:
            self.redis_client = redis.Redis(
                host=settings.AI_REDIS_HOST,
                port=settings.AI_REDIS_PORT,
                password=settings.AI_REDIS_PASSWORD or None,
                decode_responses=True,
            )
            self.redis_client.ping()
            logger.info(f"EmbeddingService connected to Redis at {settings.AI_REDIS_HOST}:{settings.AI_REDIS_PORT}.")
        except Exception as exc:
            self.redis_client = None
            logger.warning(f"Redis unavailable for EmbeddingService: {exc}. Caching disabled.")

        # Eagerly attempt CLIP load so first-request latency is absorbed at startup
        _load_clip()

    # ── Public: text embeddings (original interface, backward-compat) ──────────

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Returns 1536-dim text embeddings for a list of strings.
        Checks Redis cache per item; batches cache misses to OpenAI in groups of 20.
        """
        return self._embed_texts(texts)

    # ── Public: modality-routed embedding ─────────────────────────────────────

    def embed_chunk(
        self,
        modality: str,
        text: Optional[str] = None,
        image_bytes: Optional[bytes] = None,
        table_df: Optional[Any] = None,
    ) -> Dict[str, List[float]]:
        """
        Route a single chunk to the correct encoder based on modality.

        Returns a dict with one or both of:
            { "text_vec": [...1536 floats...], "image_vec": [...512 floats...] }

        TEXT    → text_vec only
        TABLE   → serialise DataFrame to Markdown, then text_vec only
        IMAGE   → image_vec only (from image_bytes via CLIP)
        DIAGRAM → image_vec only (same as IMAGE)
        """
        modality = (modality or "TEXT").upper()
        result: Dict[str, List[float]] = {}

        if modality in ("TEXT",):
            if text:
                result["text_vec"] = self._embed_texts([text])[0]
            else:
                result["text_vec"] = [0.0] * 1536

        elif modality == "TABLE":
            # Prefer DataFrame → Markdown; fall back to raw text
            if table_df is not None:
                md = _df_to_markdown(table_df)
            else:
                md = text or ""
            result["text_vec"] = self._embed_texts([md])[0] if md else ([0.0] * 1536)

        elif modality in ("IMAGE", "DIAGRAM"):
            if image_bytes:
                result["image_vec"] = self._embed_image_bytes(image_bytes)
            else:
                result["image_vec"] = [0.0] * 512

        else:
            # Unknown modality — fall back to text
            result["text_vec"] = self._embed_texts([text or ""])[0]

        return result

    def embed_chunks_bulk(
        self,
        chunks: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Processes a list of chunk dicts and returns them with vectors added.

        Each chunk dict should have:
            modality: str           (TEXT | TABLE | IMAGE | DIAGRAM)
            content:  str           (text content or caption)
            image_bytes: bytes opt  (raw image bytes for IMAGE/DIAGRAM)
            table_df: DataFrame opt (camelot DataFrame for TABLE)

        Returns: same list with added keys text_vec and/or image_vec.
        """
        # Batch TEXT/TABLE chunks together for efficiency
        text_indices = []
        text_inputs = []
        for i, chunk in enumerate(chunks):
            mod = (chunk.get("modality") or "TEXT").upper()
            if mod in ("TEXT", "TABLE"):
                if mod == "TABLE" and chunk.get("table_df") is not None:
                    text_inputs.append(_df_to_markdown(chunk["table_df"]))
                else:
                    text_inputs.append(chunk.get("content") or "")
                text_indices.append(i)

        # Batch embed all text/table chunks
        text_vecs = self._embed_texts(text_inputs) if text_inputs else []
        for batch_pos, chunk_idx in enumerate(text_indices):
            chunks[chunk_idx]["text_vec"] = text_vecs[batch_pos]

        # IMAGE/DIAGRAM: embed individually (each has unique bytes)
        for i, chunk in enumerate(chunks):
            mod = (chunk.get("modality") or "TEXT").upper()
            if mod in ("IMAGE", "DIAGRAM"):
                raw = chunk.get("image_bytes")
                if raw:
                    chunks[i]["image_vec"] = self._embed_image_bytes(raw)
                else:
                    chunks[i]["image_vec"] = [0.0] * 512

        return chunks

    # ── Private: text embedding with Redis cache ───────────────────────────────

    def _embed_texts(self, texts: List[str]) -> List[List[float]]:
        if not texts:
            return []

        results: List[Optional[List[float]]] = [None] * len(texts)
        miss_indices: List[int] = []
        miss_texts: List[str] = []

        # Cache look-up
        for idx, text in enumerate(texts):
            clean = " ".join(text.split())
            sha = hashlib.sha256(clean.encode()).hexdigest()
            cache_key = f"embed:sha256:{sha}"

            cached = self._redis_get(cache_key)
            if cached is not None:
                results[idx] = [float(x) for x in cached.split(",")]
            else:
                miss_indices.append(idx)
                miss_texts.append(clean)

        if not miss_texts:
            return results  # type: ignore[return-value]

        # OpenAI batch (groups of 20)
        openai_vecs: List[List[float]] = []
        batch_size = 20
        for i in range(0, len(miss_texts), batch_size):
            batch = miss_texts[i : i + batch_size]
            if self.client:
                try:
                    resp = self.client.embeddings.create(
                        model="text-embedding-3-small",
                        input=batch,
                        encoding_format="float",
                    )
                    openai_vecs.extend(d.embedding for d in resp.data)
                except Exception as exc:
                    logger.error(f"OpenAI embedding API error: {exc}")
                    raise
            else:
                # Mock — deterministic random 1536-dim vectors
                for t in batch:
                    random.seed(hash(t))
                    openai_vecs.append([random.uniform(-1.0, 1.0) for _ in range(1536)])

        # Fill results + cache
        for pos, (chunk_idx, clean_text) in enumerate(zip(miss_indices, miss_texts)):
            vec = openai_vecs[pos]
            results[chunk_idx] = vec
            sha = hashlib.sha256(clean_text.encode()).hexdigest()
            self._redis_set(f"embed:sha256:{sha}", ",".join(map(str, vec)), self.TEXT_CACHE_TTL)

        return results  # type: ignore[return-value]

    # ── Private: CLIP image embedding with Redis cache ────────────────────────

    def _embed_image_bytes(self, image_bytes: bytes) -> List[float]:
        sha = hashlib.sha256(image_bytes).hexdigest()
        cache_key = f"clip:sha256:{sha}"

        cached = self._redis_get(cache_key)
        if cached is not None:
            return [float(x) for x in cached.split(",")]

        vec = _clip_embed_bytes(image_bytes)
        self._redis_set(cache_key, ",".join(map(str, vec)), self.IMAGE_CACHE_TTL)
        return vec

    # ── Redis helpers ─────────────────────────────────────────────────────────

    def _redis_get(self, key: str) -> Optional[str]:
        if not self.redis_client:
            return None
        try:
            return self.redis_client.get(key)
        except Exception:
            return None

    def _redis_set(self, key: str, value: str, ttl: int) -> None:
        if not self.redis_client:
            return
        try:
            self.redis_client.setex(key, ttl, value)
        except Exception as exc:
            logger.debug(f"Redis set failed: {exc}")
