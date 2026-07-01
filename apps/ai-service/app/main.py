import httpx
import logging
from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
import redis
from app.core.config import settings
from app.middleware.observability import ObservabilityMiddleware
from app.middleware.token_budget import TokenBudgetMiddleware

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title=settings.PROJECT_NAME)

import asyncio
from app.worker import run_worker
from app.embedding_worker import run_embedding_worker

# Configure CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Observability and Token Budgeting Middlewares
app.add_middleware(ObservabilityMiddleware)
app.add_middleware(TokenBudgetMiddleware)


@app.get("/health", tags=["Health"])
def health_check(response: Response):
    """FastAPI health check returns status, model_loaded, and Qdrant health."""
    import datetime
    from qdrant_client import QdrantClient
    
    qdrant_status = "UP"
    qdrant_details = {}
    try:
        from app.services.qdrant_service import qdrant_service
        client = qdrant_service.get_write_client()
        if hasattr(client, "health"):
            qdrant_details = client.health()
        else:
            client.get_collections()
            qdrant_details = {"status": "green"}
    except Exception as e:
        qdrant_status = "DOWN"
        qdrant_details = {"error": str(e)}

    # Model loaded indicator (FastAPI service loaded dependencies successfully)
    model_loaded = True
    
    all_ok = qdrant_status == "UP"
    
    payload = {
        "status": "ok" if all_ok else "degraded",
        "model_loaded": model_loaded,
        "qdrant": qdrant_details,
        "timestamp": datetime.datetime.utcnow().isoformat() + "Z"
    }
    
    if not all_ok:
        response.status_code = status.HTTP_503_SERVICE_UNAVAILABLE
        
    return payload


from app.api.chat_stream import router as chat_stream_router
from app.api.memory_summarizer import router as memory_summarizer_router
from app.api.synthesis_engine import router as synthesis_engine_router
from app.api.study_engine import router as study_engine_router
from app.api.analytics_insights import router as analytics_insights_router
from app.api.tutor_agent import router as tutor_agent_router
from app.api.knowledge_graph import router as knowledge_graph_router
from app.api.pipeline import router as pipeline_router
from app.api.chunk_embed import router as chunk_embed_router
from app.api.upsert import router as upsert_router
from app.api.voice import router as voice_router
from app.api.voice_websocket import router as voice_websocket_router
from app.api.adaptive import router as adaptive_router
from app.api.recommender import router as recommender_router
from app.api.exam_engine import router as exam_engine_router
from app.api.exam_scorer import router as exam_scorer_router
from app.api.weakness_detector import router as weakness_detector_router
from app.api.group_rag import router as group_rag_router
app.include_router(chat_stream_router, prefix="/ai")
app.include_router(memory_summarizer_router, prefix="/ai")
app.include_router(synthesis_engine_router, prefix="/ai")
app.include_router(study_engine_router, prefix="/ai")
app.include_router(analytics_insights_router, prefix="/ai")
app.include_router(tutor_agent_router, prefix="/ai")
app.include_router(knowledge_graph_router, prefix="/ai")
app.include_router(pipeline_router, prefix="/ai")
app.include_router(chunk_embed_router, prefix="/ai")
app.include_router(upsert_router, prefix="/ai")
app.include_router(voice_router, prefix="/ai")
app.include_router(voice_websocket_router, prefix="/ai")
app.include_router(adaptive_router, prefix="/ai")
app.include_router(recommender_router, prefix="/ai")
app.include_router(exam_engine_router, prefix="/ai")
app.include_router(exam_scorer_router, prefix="/ai")
app.include_router(weakness_detector_router, prefix="/ai")
app.include_router(group_rag_router, prefix="/ai")



@app.post("/internal/audit")
async def forward_internal_audit(request: Request):
    try:
        payload = await request.json()
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid JSON payload")

    # Forward to NestJS internal audit endpoint
    url = f"{settings.NESTJS_API_URL}/internal/audit"
    try:
        async with httpx.AsyncClient() as client:
            response = await client.post(url, json=payload, timeout=5.0)
            if response.status_code != 200:
                logger.error(f"Failed forwarding audit log to NestJS: Status {response.status_code}, Body {response.text}")
                raise HTTPException(
                    status_code=response.status_code,
                    detail=f"NestJS internal API error: {response.text}"
                )
    except httpx.RequestError as exc:
        logger.error(f"HTTP Request failed while forwarding audit log: {exc}")
        raise HTTPException(
            status_code=520,
            detail=f"Cannot reach NestJS internal audit API: {exc}"
        )

    return {"success": True}

async def daily_qdrant_backup_loop():
    logger.info("Starting background daily Qdrant backup loop...")
    while True:
        # Wait 24 hours (86400 seconds)
        await asyncio.sleep(86400)
        logger.info("Daily Qdrant backup loop: Triggering backup_collections...")
        try:
            from app.services.qdrant_service import backup_collections
            backup_collections()
        except Exception as e:
            logger.error(f"Error in daily Qdrant backup loop: {e}")

@app.on_event("startup")
async def startup_event():
    import os
    if os.getenv("RUN_BACKGROUND_WORKERS", "true").lower() == "true":
        logger.info("FastAPI starting: launching background BullMQ processing worker...")
        asyncio.create_task(run_worker())
        logger.info("FastAPI starting: launching background BullMQ embedding worker...")
        asyncio.create_task(run_embedding_worker())
    else:
        logger.info("RUN_BACKGROUND_WORKERS is set to false. Skipping background worker tasks in web server.")

    # Bootstrap Qdrant collections (legacy + v2 named-vector)
    try:
        from app.services.qdrant_collections import (
            get_qdrant_client,
            ensure_legacy_collection,
            ensure_v2_collection,
        )
        qdrant = get_qdrant_client()
        ensure_legacy_collection(qdrant)
        ensure_v2_collection(qdrant)
    except Exception as e:
        logger.error(f"Qdrant collection bootstrap failed (non-fatal): {e}")

    # Bootstrap Minio bucket
    try:
        from app.services.minio_storage import get_minio_client, ensure_bucket
        minio = get_minio_client()
        ensure_bucket(minio)
    except Exception as e:
        logger.warning(f"Minio bucket bootstrap failed (non-fatal — likely not configured): {e}")

    # Secondary region restore check
    if getattr(settings, "SECONDARY_REGION", False) or os.getenv("SECONDARY_REGION", "false").lower() == "true":
        try:
            logger.info("Secondary region detected. Checking/restoring Qdrant collections from latest Minio snapshots...")
            from app.services.qdrant_service import restore_collections_if_empty
            restore_collections_if_empty()
        except Exception as e:
            logger.error(f"Secondary region Qdrant restore failed: {e}")

    # Start daily Qdrant backup loop
    asyncio.create_task(daily_qdrant_backup_loop())


    # Pre-load CLIP ViT-B/32 to amortise first-request latency
    try:
        from app.services.embedding_service import _load_clip
        _load_clip()
        logger.info("CLIP model startup pre-load complete.")
    except Exception as e:
        logger.warning(f"CLIP pre-load failed (non-fatal): {e}")

    # Pre-load faster-whisper speech model to amortise first-request latency
    try:
        from app.services.voice_service import load_whisper_model
        load_whisper_model()
        logger.info("faster-whisper medium model startup pre-load complete.")
    except Exception as e:
        logger.warning(f"faster-whisper model pre-load failed (non-fatal): {e}")

# Database setup for API handlers
import os
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from pydantic import BaseModel
from typing import List, Optional, Dict
from app.services.vector_search import VectorSearchService
from app.services.reranker import RerankerService
from app.services.context_builder import ContextBuilderService
from app.services.llm import LLMOrchestrator
from app.services.citation_engine import build_citations
from app.services.multimodal_retriever import MultiModalRAGRetriever

db_url = settings.DATABASE_URL
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Initialize RAG Services
vector_search = VectorSearchService()
reranker = RerankerService()
context_builder = ContextBuilderService()
llm_orchestrator = LLMOrchestrator()
multimodal_retriever = MultiModalRAGRetriever()

class RagSearchRequest(BaseModel):
    userId: str
    query: str
    documentIds: Optional[List[str]] = None
    orgId: Optional[str] = None   # Required for multimodal v2 retrieval

@app.post("/ai/rag/search")
def ai_rag_search(req: RagSearchRequest):
    logger.info(f"RAG search query received: '{req.query}' for user: {req.userId}")
    import time
    start_time = time.time()
    db = SessionLocal()
    try:
        # 1. Generate query embedding
        query_vector = vector_search.get_embedding(req.query, is_query=True)

        # 2. Retrieve top chunks from Qdrant via Hybrid Search
        retrieved_chunks = vector_search.hybrid_search(
            userId=req.userId,
            query=req.query,
            documentIds=req.documentIds,
            limit=20
        )

        # 3. Rerank top 20 chunks using cosine similarity down to top 5
        reranked_chunks = reranker.rerank(
            query_vector=query_vector,
            chunks=retrieved_chunks,
            vector_search_service=vector_search,
            limit=5
        )

        # 4. Compile merged context, unique sources and page references
        context_package = context_builder.build_context(reranked_chunks, db)

        # 5. Build structured citations from reranked chunks
        citations = build_citations(reranked_chunks)

        latency_ms = (time.time() - start_time) * 1000
        token_estimate = len(context_package["context"]) // 4
        logger.info(f"RAG Search: {latency_ms:.2f}ms | retrieved={len(retrieved_chunks)} reranked={len(reranked_chunks)} tokens≈{token_estimate} citations={len(citations)}")

        return {
            "chunks": reranked_chunks,
            "citations": citations,
            "context": context_package["context"],
            "sources": context_package["sources"],
            "pages": context_package["pages"]
        }
    except Exception as e:
        logger.error(f"RAG search processing failed: {e}")
        return {
            "chunks": [],
            "context": "",
            "sources": [],
            "pages": [],
            "error": str(e)
        }
    finally:
        db.close()


class MultiModalRagRequest(BaseModel):
    query: str
    orgId: Optional[str] = None
    documentIds: Optional[List[str]] = None
    topK: Optional[int] = 6


@app.post("/ai/rag/search/multimodal")
def ai_rag_search_multimodal(req: MultiModalRagRequest):
    """
    4-step multimodal RAG pipeline against study_chunks_v2.

    Step 1: text_vec search (top 5) with OpenAI text-embedding-3-small.
    Step 2: image_vec search (top 3) with CLIP ViT-B/32 text→image encoding.
    Step 3: merge results by chunkId, deduplicate.
    Step 4: weighted rerank — text_score×0.7 + image_score×0.3 → top 6.

    Falls back to text-only scoring if no image chunks are returned.
    """
    import time
    start_time = time.time()
    logger.info(
        f"Multimodal RAG search: query='{req.query}' "
        f"orgId={req.orgId} docIds={req.documentIds}"
    )

    try:
        results = multimodal_retriever.search(
            query=req.query,
            org_id=req.orgId,
            doc_ids=req.documentIds,
            top_k=req.topK or 6,
        )

        latency_ms = (time.time() - start_time) * 1000
        image_count = sum(1 for r in results if r.get("modality") in ("IMAGE", "DIAGRAM"))
        logger.info(
            f"Multimodal RAG: {latency_ms:.2f}ms | "
            f"total={len(results)} image_chunks={image_count}"
        )

        return {
            "chunks": results,
            "chunkCount": len(results),
            "hasImageResults": image_count > 0,
            "latencyMs": round(latency_ms, 2),
        }

    except Exception as exc:
        logger.error(f"Multimodal RAG search failed: {exc}")
        return {
            "chunks": [],
            "chunkCount": 0,
            "hasImageResults": False,
            "error": str(exc),
        }

class SummarizeRequest(BaseModel):
    messages: List[Dict[str, str]]

@app.post("/ai/chat/summarize")
async def ai_chat_summarize(req: SummarizeRequest):
    logger.info("AI chat summarize request received.")
    summary = await llm_orchestrator.summarize(req.messages)
    return {"summary": summary}

@app.post("/collections/{name}/snapshots", tags=["Qdrant"])
def create_collection_snapshot(name: str):
    """Trigger collection snapshot backup to Minio."""
    try:
        import tempfile
        import os
        import io
        from app.services.qdrant_service import qdrant_service
        from app.services.minio_storage import get_minio_client, ensure_bucket
        
        client = qdrant_service.get_write_client()
        minio = get_minio_client()
        ensure_bucket(minio)
        
        logger.info(f"Triggering manual snapshot for collection: {name}...")
        snapshot_meta = client.create_snapshot(collection_name=name)
        snapshot_name = snapshot_meta.name
        
        with tempfile.TemporaryDirectory() as tmpdir:
            local_path = os.path.join(tmpdir, snapshot_name)
            client.download_snapshot(
                collection_name=name,
                snapshot_name=snapshot_name,
                location=local_path
            )
            
            object_name = f"qdrant-snapshots/{name}/{snapshot_name}"
            with open(local_path, "rb") as f:
                data = f.read()
                minio.put_object(
                    bucket_name=settings.MINIO_BUCKET,
                    object_name=object_name,
                    data=io.BytesIO(data),
                    length=len(data),
                    content_type="application/octet-stream"
                )
            logger.info(f"Uploaded Qdrant snapshot to Minio: {object_name}")
            return {"status": "success", "snapshot": snapshot_name, "path": object_name}
    except Exception as e:
        logger.error(f"Manual Qdrant snapshot failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/")
def read_root():
    return {
        "service": settings.PROJECT_NAME,
        "status": "online",
        "documentation": "/docs"
    }


