import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from app.services.chunker_service import ChunkingService
from app.services.embedding_service import EmbeddingService

logger = logging.getLogger(__name__)
router = APIRouter()

chunking_service = ChunkingService()
embedding_service = EmbeddingService()

class SegmentInput(BaseModel):
    text: str
    pageRef: int
    sectionTitle: Optional[str] = None

class ChunkEmbedRequest(BaseModel):
    documentId: str
    segments: List[SegmentInput]

class ChunkOutput(BaseModel):
    chunkIndex: int
    content: str
    tokenCount: int
    pageRef: int
    sectionTitle: Optional[str] = None
    embedding: List[float]

class ChunkEmbedResponse(BaseModel):
    documentId: str
    chunks: List[ChunkOutput]
    chunkCount: int

@router.post("/pipeline/chunk-embed", response_model=ChunkEmbedResponse)
def chunk_and_embed_endpoint(req: ChunkEmbedRequest):
    """
    FastAPI Router Endpoint for chunking and embedding.
    - Receives parsed segment sections.
    - Applies semantic sentence-boundary chunking (max 512 tokens, 10% overlap).
    - Preserves pageRef.
    - Batches embeddings in groups of 20 using text-embedding-3-small (cached in Redis, TTL 7d).
    """
    logger.info(f"Received chunk-embed request for docId={req.documentId}, segment count={len(req.segments)}")
    try:
        # Convert Pydantic request models to dictionary list for service input
        segment_dicts = [
            {"text": seg.text, "pageRef": seg.pageRef, "sectionTitle": seg.sectionTitle}
            for seg in req.segments
        ]

        # 1. Chunking
        chunks = chunking_service.chunk_segments(segment_dicts)

        if not chunks:
            return ChunkEmbedResponse(documentId=req.documentId, chunks=[], chunkCount=0)

        # 2. Extract contents for batch embedding
        contents = [c["content"] for c in chunks]

        # 3. Generate embeddings
        vectors = embedding_service.get_embeddings(contents)

        # 4. Compile output
        output_chunks = []
        for idx, chunk in enumerate(chunks):
            # source_pages contains a list, extract the pageRef
            pages = chunk["metadata"].get("source_pages", [1])
            page_ref = pages[0] if pages else 1

            output_chunks.append(
                ChunkOutput(
                    chunkIndex=chunk["chunkIndex"],
                    content=chunk["content"],
                    tokenCount=chunk["tokenCount"],
                    pageRef=page_ref,
                    sectionTitle=chunk["metadata"].get("section_title"),
                    embedding=vectors[idx]
                )
            )

        return ChunkEmbedResponse(
            documentId=req.documentId,
            chunks=output_chunks,
            chunkCount=len(output_chunks)
        )

    except Exception as e:
        logger.error(f"Failed to chunk and embed for document {req.documentId}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Chunking and embedding pipeline failed: {str(e)}"
        )
