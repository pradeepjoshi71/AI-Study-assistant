"""
MultiModalEmbedder
==================
Consumes structured pipeline chunks (text + visual assets), routes each
through the correct encoder, and upserts named-vector points to the
study_chunks_v2 Qdrant collection.

Routing:
  TEXT / TABLE  → text_vec (1536-dim OpenAI)  +  image_vec = zeros (512-dim)
  IMAGE / DIAGRAM → image_vec (512-dim CLIP)  +  text_vec = zeros (1536-dim)

Each Qdrant point payload includes:
  orgId, docId, chunkId, chunkIndex, modality, text, pageRef,
  storageKey (Minio key, optional), caption (optional).
"""
from __future__ import annotations

import logging
import uuid
from typing import Any, Dict, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.http.models import PointStruct

from app.core.config import settings
from app.services.embedding_service import EmbeddingService
from app.services.qdrant_collections import (
    V2_COLLECTION,
    TEXT_VEC_DIM,
    IMAGE_VEC_DIM,
    ensure_v2_collection,
    get_qdrant_client,
)

logger = logging.getLogger(__name__)

# Zero-vector sentinels (used when a modality does not produce that vector)
_ZERO_TEXT = [0.0] * TEXT_VEC_DIM
_ZERO_IMAGE = [0.0] * IMAGE_VEC_DIM


class MultiModalEmbedder:
    """
    Stateless service that converts pipeline chunk dicts into Qdrant v2 points.

    Usage::

        embedder = MultiModalEmbedder()
        embedder.embed_and_upsert(
            org_id="org_abc",
            doc_id="doc_xyz",
            chunks=[
                {
                    "content":    "Gradient descent is...",
                    "modality":   "TEXT",
                    "pageRef":    3,
                    "sectionTitle": "Chapter 2",
                    # optional for visual chunks:
                    "storageKey": "orgs/.../images/uuid.png",
                    "imageHash":  "abcdef...",
                    "imageWidth": 800,
                    "imageHeight": 600,
                    "caption":    "Figure showing loss curve.",
                    "image_bytes": b"...",  # raw bytes for CLIP (if available)
                    "table_df":    <DataFrame>,  # for TABLE modality
                },
                ...
            ]
        )
    """

    def __init__(self):
        self.embedding_service = EmbeddingService()
        self._qdrant: Optional[QdrantClient] = None

    def _get_qdrant(self) -> Optional[QdrantClient]:
        """Lazy Qdrant client with collection bootstrap."""
        if self._qdrant is None:
            try:
                self._qdrant = get_qdrant_client()
                ensure_v2_collection(self._qdrant)
            except Exception as exc:
                logger.error(f"MultiModalEmbedder: Qdrant connection failed: {exc}")
                return None
        return self._qdrant

    # ── Main public method ────────────────────────────────────────────────────

    def embed_and_upsert(
        self,
        org_id: str,
        doc_id: str,
        chunks: List[Dict[str, Any]],
    ) -> int:
        """
        Embeds all chunks (modality-routed) and upserts them into study_chunks_v2.
        Returns the number of points successfully upserted.
        """
        if not chunks:
            return 0

        qdrant = self._get_qdrant()
        if qdrant is None:
            logger.error("MultiModalEmbedder: Qdrant unavailable. Skipping upsert.")
            return 0

        # Delete existing points for this docId before re-indexing
        try:
            from qdrant_client.http import models as qmodels
            qdrant.delete(
                collection_name=V2_COLLECTION,
                points_selector=qmodels.Filter(
                    must=[
                        qmodels.FieldCondition(
                            key="docId",
                            match=qmodels.MatchValue(value=doc_id),
                        )
                    ]
                ),
            )
        except Exception as exc:
            logger.warning(f"MultiModalEmbedder: pre-delete failed (non-fatal): {exc}")

        # ── Separate chunks by modality for batch efficiency ──────────────────
        text_table_idx: List[int] = []
        image_diagram_idx: List[int] = []

        for i, chunk in enumerate(chunks):
            mod = (chunk.get("modality") or "TEXT").upper()
            if mod in ("TEXT", "TABLE"):
                text_table_idx.append(i)
            else:
                image_diagram_idx.append(i)

        # ── Batch embed TEXT / TABLE ──────────────────────────────────────────
        text_inputs: List[str] = []
        for i in text_table_idx:
            chunk = chunks[i]
            mod = (chunk.get("modality") or "TEXT").upper()
            if mod == "TABLE" and chunk.get("table_df") is not None:
                from app.services.embedding_service import _df_to_markdown
                text_inputs.append(_df_to_markdown(chunk["table_df"]))
            else:
                text_inputs.append(chunk.get("content") or chunk.get("text") or "")

        text_vecs = self.embedding_service.get_embeddings(text_inputs) if text_inputs else []

        # ── Build Qdrant points ───────────────────────────────────────────────
        points: List[PointStruct] = []

        # --- TEXT / TABLE points ---
        for batch_pos, chunk_idx in enumerate(text_table_idx):
            chunk = chunks[chunk_idx]
            text_vec = text_vecs[batch_pos] if batch_pos < len(text_vecs) else _ZERO_TEXT

            point = self._build_point(
                chunk=chunk,
                org_id=org_id,
                doc_id=doc_id,
                chunk_idx=chunk_idx,
                text_vec=text_vec,
                image_vec=_ZERO_IMAGE,
            )
            points.append(point)

        # --- IMAGE / DIAGRAM points ---
        for chunk_idx in image_diagram_idx:
            chunk = chunks[chunk_idx]
            raw_bytes = chunk.get("image_bytes")

            if raw_bytes:
                image_vec = self.embedding_service._embed_image_bytes(raw_bytes)
            else:
                # No raw bytes available (e.g., pre-extracted caption-only chunk):
                # embed the caption as text to approximate visual semantics,
                # then place in image_vec slot using a zero fallback.
                image_vec = _ZERO_IMAGE
                logger.debug(
                    f"Chunk idx={chunk_idx} (modality={chunk.get('modality')}) "
                    "has no image_bytes; using zero image_vec."
                )

            point = self._build_point(
                chunk=chunk,
                org_id=org_id,
                doc_id=doc_id,
                chunk_idx=chunk_idx,
                text_vec=_ZERO_TEXT,
                image_vec=image_vec,
            )
            points.append(point)

        # ── Batch upsert to study_chunks_v2 ──────────────────────────────────
        if not points:
            return 0

        try:
            qdrant.upsert(collection_name=V2_COLLECTION, points=points)
            logger.info(
                f"MultiModalEmbedder: upserted {len(points)} points to "
                f"'{V2_COLLECTION}' for doc={doc_id} org={org_id}."
            )
            return len(points)
        except Exception as exc:
            logger.error(f"MultiModalEmbedder: Qdrant upsert failed: {exc}")
            raise

    # ── Point builder ─────────────────────────────────────────────────────────

    def _build_point(
        self,
        chunk: Dict[str, Any],
        org_id: str,
        doc_id: str,
        chunk_idx: int,
        text_vec: List[float],
        image_vec: List[float],
    ) -> PointStruct:
        """Construct a named-vector PointStruct for study_chunks_v2."""
        modality = (chunk.get("modality") or "TEXT").upper()
        page_ref = chunk.get("pageRef") or chunk.get("page_ref") or 1
        content = chunk.get("content") or chunk.get("text") or ""
        caption = chunk.get("caption") or ""
        storage_key = chunk.get("storageKey") or chunk.get("storage_key") or ""

        return PointStruct(
            id=str(uuid.uuid4()),
            vector={
                "text_vec": text_vec,
                "image_vec": image_vec,
            },
            payload={
                "orgId": org_id,
                "docId": doc_id,
                "chunkId": chunk.get("id") or str(uuid.uuid4()),
                "chunkIndex": chunk.get("chunkIndex", chunk_idx),
                "modality": modality,
                "text": content,
                "caption": caption,
                "pageRef": page_ref,
                "sectionTitle": chunk.get("sectionTitle") or "",
                "storageKey": storage_key,
                "imageHash": chunk.get("imageHash") or chunk.get("image_hash") or "",
                "imageWidth": chunk.get("imageWidth") or chunk.get("width") or 0,
                "imageHeight": chunk.get("imageHeight") or chunk.get("height") or 0,
            },
        )
