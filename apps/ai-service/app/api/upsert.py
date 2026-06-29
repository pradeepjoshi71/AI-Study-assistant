import logging
import uuid
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from qdrant_client import QdrantClient
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# Setup Qdrant Client matching VectorSearchService
qdrant_client = None
try:
    qdrant_client = QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)
    # Ensure collection exists
    collections = qdrant_client.get_collections().collections
    if not any(c.name == "study_chunks" for c in collections):
        qdrant_client.create_collection(
            collection_name="study_chunks",
            vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
        )
except Exception as e:
    logger.error(f"Failed to connect/initialize Qdrant in upsert router: {e}")

class ChunkInput(BaseModel):
    chunkIndex: int
    content: str
    tokenCount: int
    pageRef: int
    sectionTitle: Optional[str] = None
    embedding: List[float]

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
    FastAPI Router Endpoint for deleting old points by docId and upserting chunks to study_chunks.
    Payload per point:
      - orgId
      - docId
      - chunkIndex
      - text
      - pageRef
    """
    if not qdrant_client:
        raise HTTPException(status_code=500, detail="Qdrant client is not initialized")

    logger.info(f"Upserting chunks for document {req.documentId} into study_chunks. Count={len(req.chunks)}")

    try:
        # 1. Delete existing points by docId filter (re-index cleanup)
        qdrant_client.delete(
            collection_name="study_chunks",
            points_selector=models.Filter(
                must=[
                    models.FieldCondition(
                        key="docId",
                        match=models.MatchValue(value=req.documentId)
                    )
                ]
            )
        )
        logger.info(f"Cleaned up any existing points for docId={req.documentId}")

        if not req.chunks:
            return UpsertResponse(success=True, upsertedCount=0)

        # 2. Build points for Qdrant
        points = []
        for chunk in req.chunks:
            point_id = str(uuid.uuid4())
            points.append(
                PointStruct(
                    id=point_id,
                    vector=chunk.embedding,
                    payload={
                        "orgId": req.orgId,
                        "docId": req.documentId,
                        "chunkIndex": chunk.chunkIndex,
                        "text": chunk.content,
                        "pageRef": chunk.pageRef,
                        "sectionTitle": chunk.sectionTitle
                    }
                )
            )

        # 3. Batch upsert
        qdrant_client.upsert(
            collection_name="study_chunks",
            points=points
        )

        logger.info(f"Upserted {len(points)} points to study_chunks collection successfully.")
        return UpsertResponse(success=True, upsertedCount=len(points))

    except Exception as e:
        logger.error(f"Failed Qdrant upsert pipeline: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Qdrant pipeline execution failed: {str(e)}"
        )
