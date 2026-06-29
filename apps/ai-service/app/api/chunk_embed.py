"""
/ai/pipeline/chunk-embed
========================
Chunking + embedding endpoint.

For TEXT/TABLE segments  → applies semantic chunking then batch-embeds via
                           OpenAI text-embedding-3-small (EmbeddingService).
For IMAGE/DIAGRAM segments (produced by MultiModalParser) → no further
                           chunking; embed via CLIP ViT-B/32 and upsert
                           directly to study_chunks_v2 via MultiModalEmbedder.

Both paths produce a uniform ChunkOutput list returned to the NestJS caller.
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional, Dict, Any

from app.services.chunker_service import ChunkingService
from app.services.embedding_service import EmbeddingService
from app.services.multimodal_embedder import MultiModalEmbedder

logger = logging.getLogger(__name__)
router = APIRouter()

chunking_service = ChunkingService()
embedding_service = EmbeddingService()
multimodal_embedder = MultiModalEmbedder()

# ── Request / Response models ─────────────────────────────────────────────────

class SegmentInput(BaseModel):
    text: str
    pageRef: int
    sectionTitle: Optional[str] = None
    # Multimodal fields (set by MultiModalParser-aware pipeline callers)
    modality: Optional[str] = "TEXT"       # TEXT | TABLE | IMAGE | DIAGRAM
    storageKey: Optional[str] = None        # Minio key (for image/diagram chunks)
    imageHash: Optional[str] = None
    imageWidth: Optional[int] = None
    imageHeight: Optional[int] = None
    caption: Optional[str] = None           # GPT-4o generated caption

class ChunkEmbedRequest(BaseModel):
    documentId: str
    orgId: Optional[str] = None             # needed for Qdrant v2 upsert payload
    segments: List[SegmentInput]

class ChunkOutput(BaseModel):
    chunkIndex: int
    content: str
    tokenCount: int
    pageRef: int
    sectionTitle: Optional[str] = None
    embedding: List[float]
    modality: Optional[str] = "TEXT"
    storageKey: Optional[str] = None
    caption: Optional[str] = None

class ChunkEmbedResponse(BaseModel):
    documentId: str
    chunks: List[ChunkOutput]
    chunkCount: int

# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/pipeline/chunk-embed", response_model=ChunkEmbedResponse)
def chunk_and_embed_endpoint(req: ChunkEmbedRequest):
    """
    Chunking + embedding pipeline with multimodal routing.

    TEXT / TABLE segments:
      - Semantic chunking (max 512 tokens, 10 % overlap)
      - Batch OpenAI text-embedding-3-small (Redis-cached, TTL 7 d)
      - Table markdown serialisation before embedding

    IMAGE / DIAGRAM segments (from MultiModalParser):
      - No further chunking (they are already atomic visual units)
      - CLIP ViT-B/32 encoding
      - Immediate upsert to study_chunks_v2 via MultiModalEmbedder
    """
    logger.info(
        f"chunk-embed request: docId={req.documentId} orgId={req.orgId} "
        f"segments={len(req.segments)}"
    )

    try:
        # ── Partition segments by modality ────────────────────────────────────
        text_segments: List[Dict[str, Any]] = []
        visual_segments: List[Dict[str, Any]] = []

        for seg in req.segments:
            mod = (seg.modality or "TEXT").upper()
            seg_dict = {
                "text": seg.text,
                "pageRef": seg.pageRef,
                "sectionTitle": seg.sectionTitle,
                "modality": mod,
                "storageKey": seg.storageKey,
                "imageHash": seg.imageHash,
                "imageWidth": seg.imageWidth,
                "imageHeight": seg.imageHeight,
                "caption": seg.caption,
            }
            if mod in ("IMAGE", "DIAGRAM"):
                visual_segments.append(seg_dict)
            else:
                text_segments.append(seg_dict)

        output_chunks: List[ChunkOutput] = []
        chunk_index_counter = 0

        # ── TEXT / TABLE path ─────────────────────────────────────────────────
        if text_segments:
            # Chunking
            chunks = chunking_service.chunk_segments(text_segments)

            if chunks:
                # For TABLE modality, carry modality through chunker output
                contents = [c["content"] for c in chunks]
                vectors = embedding_service.get_embeddings(contents)

                for idx, chunk in enumerate(chunks):
                    pages = chunk["metadata"].get("source_pages", [1])
                    page_ref = pages[0] if pages else 1
                    # Carry modality from source segment if available
                    mod = chunk["metadata"].get("modality", "TEXT")

                    output_chunks.append(ChunkOutput(
                        chunkIndex=chunk_index_counter,
                        content=chunk["content"],
                        tokenCount=chunk["tokenCount"],
                        pageRef=page_ref,
                        sectionTitle=chunk["metadata"].get("section_title"),
                        embedding=vectors[idx],
                        modality=mod,
                        storageKey=None,
                        caption=None,
                    ))
                    chunk_index_counter += 1

        # ── IMAGE / DIAGRAM path ──────────────────────────────────────────────
        if visual_segments and req.orgId:
            try:
                # Prepare chunk dicts for MultiModalEmbedder
                # Note: image_bytes are not available at this HTTP layer;
                # the embedder will use zero image_vec (caption-only fallback).
                # For full CLIP fidelity, call embed_and_upsert from the worker
                # where raw bytes are available (see document-processing.processor.ts).
                embed_chunks = []
                for seg_dict in visual_segments:
                    embed_chunks.append({
                        "content": seg_dict.get("text") or seg_dict.get("caption") or "",
                        "text": seg_dict.get("text") or "",
                        "modality": seg_dict.get("modality", "IMAGE"),
                        "pageRef": seg_dict.get("pageRef", 1),
                        "sectionTitle": seg_dict.get("sectionTitle"),
                        "storageKey": seg_dict.get("storageKey"),
                        "imageHash": seg_dict.get("imageHash"),
                        "imageWidth": seg_dict.get("imageWidth"),
                        "imageHeight": seg_dict.get("imageHeight"),
                        "caption": seg_dict.get("caption"),
                        "chunkIndex": chunk_index_counter,
                        # image_bytes: not available via HTTP — zero-vec fallback used
                    })
                    chunk_index_counter += 1

                multimodal_embedder.embed_and_upsert(
                    org_id=req.orgId,
                    doc_id=req.documentId,
                    chunks=embed_chunks,
                )

                # Also include visual chunks in the HTTP response for NestJS
                for em_chunk in embed_chunks:
                    output_chunks.append(ChunkOutput(
                        chunkIndex=em_chunk["chunkIndex"],
                        content=em_chunk["content"],
                        tokenCount=len((em_chunk["content"] or "").split()),
                        pageRef=em_chunk.get("pageRef", 1),
                        sectionTitle=em_chunk.get("sectionTitle"),
                        embedding=[],  # already upserted to Qdrant directly
                        modality=em_chunk.get("modality"),
                        storageKey=em_chunk.get("storageKey"),
                        caption=em_chunk.get("caption"),
                    ))

            except Exception as vis_err:
                logger.error(f"Visual segment embedding failed (non-fatal): {vis_err}")

        elif visual_segments and not req.orgId:
            logger.warning(
                f"Skipping {len(visual_segments)} visual segments — orgId not provided. "
                "Cannot upsert to study_chunks_v2 without orgId."
            )

        return ChunkEmbedResponse(
            documentId=req.documentId,
            chunks=output_chunks,
            chunkCount=len(output_chunks),
        )

    except Exception as exc:
        logger.error(f"chunk-embed failed for doc {req.documentId}: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Chunking and embedding pipeline failed: {str(exc)}",
        )
