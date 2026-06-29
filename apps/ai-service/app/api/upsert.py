import logging
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from app.core.config import settings
from app.services.qdrant_collections import (
    ensure_legacy_collection,
    ensure_v2_collection,
    LEGACY_COLLECTION,
    V2_COLLECTION,
    IMAGE_VEC_DIM,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# Setup Qdrant Client — shared for both collections
qdrant_client = None
try:
    qdrant_client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
    ensure_legacy_collection(qdrant_client)
    ensure_v2_collection(qdrant_client)
except Exception as e:
    logger.error(f"Failed to connect/initialize Qdrant in upsert router: {e}")


class ChunkInput(BaseModel):
    chunkIndex: int
    content: str
    tokenCount: int
    pageRef: int
    sectionTitle: Optional[str] = None
    embedding: List[float]
    modality: Optional[str] = "TEXT"   # ChunkModality: TEXT | IMAGE | TABLE | DIAGRAM
    imageEmbedding: Optional[List[float]] = None  # 512-dim for image_vec (None for text-only chunks)


class UpsertRequest(BaseModel):
    documentId: str
    orgId: str
    chunks: List[ChunkInput]


class UpsertResponse(BaseModel):
    success: bool
    upsertedCount: int


@router.post("/pipeline/upsert", response_model=UpsertResponse)
def upsert_chunks_endpoint(req: UpsertRequest):
    """
    Dual-writes chunks to both the legacy study_chunks and the new study_chunks_v2
    (named-vector) Qdrant collections for safe transition.

    study_chunks (legacy):
      - Single flat vector (text embedding only)
      - Preserved for backward compat during migration

    study_chunks_v2 (new):
      - Named vectors: text_vec (1536-dim) + image_vec (512-dim, optional)
      - Carries modality field in payload
    """
    if not qdrant_client:
        raise HTTPException(status_code=500, detail="Qdrant client is not initialized")

    logger.info(
        f"Upserting {len(req.chunks)} chunks for doc {req.documentId} "
        f"into both '{LEGACY_COLLECTION}' and '{V2_COLLECTION}'."
    )

    try:
        # ── 1. Delete stale points in both collections ──────────────────────
        for collection in [LEGACY_COLLECTION, V2_COLLECTION]:
            qdrant_client.delete(
                collection_name=collection,
                points_selector=models.Filter(
                    must=[
                        models.FieldCondition(
                            key="docId",
                            match=models.MatchValue(value=req.documentId)
                        )
                    ]
                )
            )
        logger.info(f"Cleaned up existing points for docId={req.documentId}")

        if not req.chunks:
            return UpsertResponse(success=True, upsertedCount=0)

        legacy_points: List[PointStruct] = []
        v2_points: List[PointStruct] = []

        for chunk in req.chunks:
            point_id = str(uuid.uuid4())
            base_payload = {
                "orgId": req.orgId,
                "docId": req.documentId,
                "chunkIndex": chunk.chunkIndex,
                "text": chunk.content,
                "pageRef": chunk.pageRef,
                "sectionTitle": chunk.sectionTitle,
                "modality": chunk.modality or "TEXT",
            }

            # ── Legacy point: single flat vector ──
            legacy_points.append(
                PointStruct(
                    id=point_id,
                    vector=chunk.embedding,
                    payload=base_payload,
                )
            )

            # ── v2 point: named vectors ──
            named_vectors: dict = {"text_vec": chunk.embedding}
            if chunk.imageEmbedding and len(chunk.imageEmbedding) == IMAGE_VEC_DIM:
                named_vectors["image_vec"] = chunk.imageEmbedding
            # If no image embedding supplied, use a zero vector as placeholder
            # (Qdrant named-vector collections allow sparse per-point population
            # only in sparse-vector mode; dense collections need all named vecs present)
            else:
                named_vectors["image_vec"] = [0.0] * IMAGE_VEC_DIM

            v2_points.append(
                PointStruct(
                    id=point_id,
                    vector=named_vectors,
                    payload=base_payload,
                )
            )

        # ── 2. Batch upsert legacy ──────────────────────────────────────────
        qdrant_client.upsert(collection_name=LEGACY_COLLECTION, points=legacy_points)
        logger.info(f"Upserted {len(legacy_points)} points to '{LEGACY_COLLECTION}'.")

        # ── 3. Batch upsert v2 ──────────────────────────────────────────────
        qdrant_client.upsert(collection_name=V2_COLLECTION, points=v2_points)
        logger.info(f"Upserted {len(v2_points)} points to '{V2_COLLECTION}'.")

        return UpsertResponse(success=True, upsertedCount=len(v2_points))

    except Exception as e:
        logger.error(f"Failed Qdrant upsert pipeline: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Qdrant pipeline execution failed: {str(e)}"
        )
