"""
MultiModalRAGRetriever
======================
4-step multimodal query pipeline against study_chunks_v2.

Step 1 — Text vector search
    Encode query with OpenAI text-embedding-3-small → search text_vec (top 5).

Step 2 — Image vector search
    Encode query with CLIP ViT-B/32 → search image_vec (top 3).
    Falls back gracefully: if CLIP is unavailable or returns zero results,
    the image search step is skipped and the final list is text-only.

Step 3 — Merge & deduplicate
    Union results by chunkId. Each chunk carries its best text_score and
    image_score (0.0 if absent in that search arm).

Step 4 — Weighted rerank
    final_score = text_score * 0.7 + image_score * 0.3
    Sort descending, return top 6.

Fall-back
    If no image chunks are retrieved (all image_scores == 0), the weight is
    collapsed to text-only (text_score * 1.0).

Each returned chunk contains:
    chunkId, docId, orgId, modality, text, caption, storageKey, pageRef,
    sectionTitle, text_score, image_score, final_score
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

from qdrant_client import QdrantClient
from qdrant_client.http import models as qmodels

from app.core.config import settings
from app.services.qdrant_collections import (
    V2_COLLECTION,
    get_qdrant_client,
    ensure_v2_collection,
)

logger = logging.getLogger(__name__)

# ── Retrieval config ──────────────────────────────────────────────────────────
_TEXT_TOP_K = 5
_IMAGE_TOP_K = 3
_FINAL_TOP_K = 6
_TEXT_WEIGHT = 0.7
_IMAGE_WEIGHT = 0.3


class MultiModalRAGRetriever:
    """
    Stateful retriever that performs dual named-vector search on study_chunks_v2
    and merges results with weighted reranking.

    Instantiate once and reuse across requests (Qdrant client is pooled).
    """

    def __init__(self):
        self._qdrant: Optional[QdrantClient] = None
        self._embedding_service = None
        self._init_services()

    # ── Initialization ────────────────────────────────────────────────────────

    def _init_services(self):
        try:
            from app.services.qdrant_service import qdrant_service
            # Run collection setup on write client
            ensure_v2_collection(qdrant_service.get_write_client())
            # Use read client for search/query operations
            self._qdrant = qdrant_service.get_read_client()
        except Exception as exc:
            logger.error(f"MultiModalRAGRetriever: Qdrant init failed: {exc}")
            self._qdrant = None

        try:
            from app.services.embedding_service import EmbeddingService
            self._embedding_service = EmbeddingService()
        except Exception as exc:
            logger.error(f"MultiModalRAGRetriever: EmbeddingService init failed: {exc}")

    # ── Public API ────────────────────────────────────────────────────────────

    def search(
        self,
        query: str,
        org_id: Optional[str] = None,
        doc_ids: Optional[List[str]] = None,
        top_k: int = _FINAL_TOP_K,
    ) -> List[Dict[str, Any]]:
        """
        Execute the 4-step multimodal RAG retrieval pipeline.

        Args:
            query:   Natural-language search query.
            org_id:  Optional tenant filter (orgId payload field).
            doc_ids: Optional list of docId values to restrict search scope.
            top_k:   Number of results to return (default 6).

        Returns:
            List of chunk dicts sorted by weighted score (descending).
        """
        if not self._qdrant:
            logger.warning("MultiModalRAGRetriever: Qdrant unavailable — returning empty results.")
            return []

        # ── Step 1: Text vector search ────────────────────────────────────────
        text_results = self._text_search(query, org_id, doc_ids, top_k=_TEXT_TOP_K)
        logger.info(f"MultiModalRAGRetriever: text search returned {len(text_results)} hits.")

        # ── Step 2: Image vector search ───────────────────────────────────────
        image_results = self._image_search(query, org_id, doc_ids, top_k=_IMAGE_TOP_K)
        logger.info(f"MultiModalRAGRetriever: image search returned {len(image_results)} hits.")

        # ── Step 3: Merge + deduplicate ───────────────────────────────────────
        merged = self._merge(text_results, image_results)
        logger.info(f"MultiModalRAGRetriever: merged {len(merged)} unique chunks.")

        # ── Step 4: Weighted rerank ───────────────────────────────────────────
        ranked = self._rerank(merged)
        result = ranked[:top_k]

        logger.info(
            f"MultiModalRAGRetriever: returning top {len(result)} chunks "
            f"(text-only fallback={not any(c['image_score'] > 0 for c in result)})."
        )
        return result

    # ── Step 1: OpenAI text_vec search ───────────────────────────────────────

    def _text_search(
        self,
        query: str,
        org_id: Optional[str],
        doc_ids: Optional[List[str]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """Search study_chunks_v2 using the text_vec named vector."""
        if not self._embedding_service:
            return []

        try:
            text_vec = self._embedding_service.get_embeddings([query])[0]
        except Exception as exc:
            logger.error(f"Text embedding failed: {exc}")
            return []

        search_filter = self._build_filter(org_id, doc_ids)

        try:
            hits = self._qdrant.search(
                collection_name=V2_COLLECTION,
                query_vector=qmodels.NamedVector(name="text_vec", vector=text_vec),
                query_filter=search_filter,
                limit=top_k,
                with_payload=True,
            )
        except Exception as exc:
            logger.error(f"Qdrant text_vec search failed: {exc}")
            return []

        return [
            self._hit_to_dict(hit, text_score=hit.score, image_score=0.0)
            for hit in hits
        ]

    # ── Step 2: CLIP image_vec search ─────────────────────────────────────────

    def _image_search(
        self,
        query: str,
        org_id: Optional[str],
        doc_ids: Optional[List[str]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """Search study_chunks_v2 using the image_vec named vector (CLIP)."""
        try:
            from app.services.embedding_service import _clip_embed_bytes, _load_clip
            if not _load_clip():
                logger.warning("CLIP unavailable — skipping image_vec search.")
                return []

            # Encode the text query as an image-space vector using CLIP's text encoder
            image_vec = self._clip_encode_text(query)
            if not image_vec or all(v == 0.0 for v in image_vec):
                return []

        except Exception as exc:
            logger.warning(f"CLIP text encoding failed: {exc}")
            return []

        search_filter = self._build_filter(org_id, doc_ids)

        try:
            hits = self._qdrant.search(
                collection_name=V2_COLLECTION,
                query_vector=qmodels.NamedVector(name="image_vec", vector=image_vec),
                query_filter=search_filter,
                limit=top_k,
                with_payload=True,
            )
        except Exception as exc:
            logger.error(f"Qdrant image_vec search failed: {exc}")
            return []

        # Only retain chunks that actually have image/diagram content
        results = []
        for hit in hits:
            payload = hit.payload or {}
            modality = (payload.get("modality") or "TEXT").upper()
            if modality in ("IMAGE", "DIAGRAM"):
                results.append(
                    self._hit_to_dict(hit, text_score=0.0, image_score=hit.score)
                )
        return results

    def _clip_encode_text(self, text: str) -> List[float]:
        """
        Use CLIP's text encoder to embed the query into image space.
        This allows text→image cross-modal retrieval.
        """
        try:
            import torch
            import clip as openai_clip
            from app.services.embedding_service import _clip_model, _clip_device

            if _clip_model is None:
                return [0.0] * 512

            tokens = openai_clip.tokenize([text[:77]], truncate=True).to(_clip_device)
            with torch.no_grad():
                features = _clip_model.encode_text(tokens)
                features = features / features.norm(dim=-1, keepdim=True)
            return features[0].tolist()
        except Exception as exc:
            logger.error(f"CLIP text encode failed: {exc}")
            return [0.0] * 512

    # ── Step 3: Merge + deduplicate ───────────────────────────────────────────

    def _merge(
        self,
        text_results: List[Dict[str, Any]],
        image_results: List[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Union both lists by chunkId.
        If a chunk appears in both, accumulate the best score from each arm.
        """
        merged: Dict[str, Dict[str, Any]] = {}

        for chunk in text_results:
            cid = chunk["chunkId"]
            merged[cid] = chunk  # text_score already set; image_score = 0.0

        for chunk in image_results:
            cid = chunk["chunkId"]
            if cid in merged:
                # Chunk exists from text search — add image score
                merged[cid]["image_score"] = max(
                    merged[cid].get("image_score", 0.0), chunk["image_score"]
                )
            else:
                merged[cid] = chunk  # image-only hit; text_score = 0.0

        return list(merged.values())

    # ── Step 4: Weighted rerank ───────────────────────────────────────────────

    def _rerank(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Compute weighted final_score for each chunk.
        If no chunk has a non-zero image_score, collapse to text-only (weight=1.0).
        """
        has_image_scores = any(c.get("image_score", 0.0) > 0 for c in chunks)

        for chunk in chunks:
            text_s = chunk.get("text_score", 0.0)
            image_s = chunk.get("image_score", 0.0)

            if has_image_scores:
                chunk["final_score"] = text_s * _TEXT_WEIGHT + image_s * _IMAGE_WEIGHT
            else:
                # Pure text-only fallback
                chunk["final_score"] = text_s * 1.0

        return sorted(chunks, key=lambda c: c["final_score"], reverse=True)

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _build_filter(
        self,
        org_id: Optional[str],
        doc_ids: Optional[List[str]],
    ) -> Optional[qmodels.Filter]:
        """Build a Qdrant payload filter for optional orgId and docId scoping."""
        must: List[qmodels.Condition] = []

        if org_id:
            must.append(
                qmodels.FieldCondition(
                    key="orgId",
                    match=qmodels.MatchValue(value=org_id),
                )
            )

        if doc_ids:
            if len(doc_ids) == 1:
                must.append(
                    qmodels.FieldCondition(
                        key="docId",
                        match=qmodels.MatchValue(value=doc_ids[0]),
                    )
                )
            else:
                # OR across multiple docs
                doc_conditions = [
                    qmodels.FieldCondition(
                        key="docId", match=qmodels.MatchValue(value=did)
                    )
                    for did in doc_ids
                ]
                must.append(qmodels.Filter(should=doc_conditions))

        return qmodels.Filter(must=must) if must else None

    def _hit_to_dict(
        self,
        hit: Any,
        text_score: float,
        image_score: float,
    ) -> Dict[str, Any]:
        """Map a Qdrant ScoredPoint to a retrieval result dict."""
        payload = hit.payload or {}
        return {
            "chunkId":    payload.get("chunkId", str(hit.id)),
            "docId":      payload.get("docId", ""),
            "orgId":      payload.get("orgId", ""),
            "modality":   payload.get("modality", "TEXT"),
            "text":       payload.get("text", ""),
            "caption":    payload.get("caption", ""),
            "storageKey": payload.get("storageKey", ""),
            "pageRef":    payload.get("pageRef", 1),
            "sectionTitle": payload.get("sectionTitle", ""),
            "chunkIndex": payload.get("chunkIndex", 0),
            "text_score":  round(text_score, 6),
            "image_score": round(image_score, 6),
            "final_score": 0.0,  # filled in by _rerank
        }
