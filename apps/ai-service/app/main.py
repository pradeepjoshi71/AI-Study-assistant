import logging
from fastapi import FastAPI, Response, status
from fastapi.middleware.cors import CORSMiddleware
import redis
from app.core.config import settings
from app.middleware.observability import ObservabilityMiddleware

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

# Structured JSON request logging + X-Correlation-ID propagation
app.add_middleware(ObservabilityMiddleware)


@app.get("/health", tags=["Health"])
async def health_check():
    """FastAPI health check — polled by NestJS HealthController"""
    return {"status": "ok", "service": settings.PROJECT_NAME}

from app.api.chat_stream import router as chat_stream_router
from app.api.memory_summarizer import router as memory_summarizer_router
from app.api.synthesis_engine import router as synthesis_engine_router
from app.api.study_engine import router as study_engine_router
from app.api.analytics_insights import router as analytics_insights_router
from app.api.tutor_agent import router as tutor_agent_router
from app.api.knowledge_graph import router as knowledge_graph_router
app.include_router(chat_stream_router, prefix="/ai")
app.include_router(memory_summarizer_router, prefix="/ai")
app.include_router(synthesis_engine_router, prefix="/ai")
app.include_router(study_engine_router, prefix="/ai")
app.include_router(analytics_insights_router, prefix="/ai")
app.include_router(tutor_agent_router, prefix="/ai")
app.include_router(knowledge_graph_router, prefix="/ai")

@app.on_event("startup")
async def startup_event():
    logger.info("FastAPI starting: launching background BullMQ processing worker...")
    asyncio.create_task(run_worker())
    logger.info("FastAPI starting: launching background BullMQ embedding worker...")
    asyncio.create_task(run_embedding_worker())

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

db_url = os.getenv("DATABASE_URL", "postgresql://postgres:postgres_secure_pass@localhost:5432/study_assistant?schema=public")
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Initialize RAG Services
vector_search = VectorSearchService()
reranker = RerankerService()
context_builder = ContextBuilderService()
llm_orchestrator = LLMOrchestrator()

class RagSearchRequest(BaseModel):
    userId: str
    query: str
    documentIds: Optional[List[str]] = None

@app.post("/ai/rag/search")
def ai_rag_search(req: RagSearchRequest):
    logger.info(f"RAG search query received: '{req.query}' for user: {req.userId}")
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

        return {
            "chunks": reranked_chunks,
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

from fastapi.responses import StreamingResponse

class ChatStreamRequest(BaseModel):
    systemPrompt: str
    message: str
    history: List[Dict[str, str]] = []

@app.post("/ai/chat/stream")
async def ai_chat_stream(req: ChatStreamRequest):
    logger.info("AI chat stream request received.")
    
    async def event_generator():
        try:
            async for token in llm_orchestrator.stream_chat(
                system_prompt=req.systemPrompt,
                message=req.message,
                history=req.history
            ):
                # Yield SSE event format
                yield f"event: token\ndata: {token}\n\n"
            yield "event: done\ndata: {}\n\n"
        except Exception as e:
            logger.error(f"Error in event_generator: {e}")
            yield f"event: error\ndata: {str(e)}\n\n"

    return StreamingResponse(event_generator(), media_type="text/event-stream")

class SummarizeRequest(BaseModel):
    messages: List[Dict[str, str]]

@app.post("/ai/chat/summarize")
async def ai_chat_summarize(req: SummarizeRequest):
    logger.info("AI chat summarize request received.")
    summary = await llm_orchestrator.summarize(req.messages)
    return {"summary": summary}

@app.get("/")
def read_root():
    return {
        "service": settings.PROJECT_NAME,
        "status": "online",
        "documentation": "/docs"
    }

@app.get("/health")
def health_check(response: Response):
    redis_connection_status = "disconnected"
    try:
        r = redis.Redis(
            host=settings.AI_REDIS_HOST,
            port=int(settings.AI_REDIS_PORT),
            password=settings.AI_REDIS_PASSWORD or None,
            socket_timeout=2
        )
        if r.ping():
            redis_connection_status = "connected"
    except Exception as err:
        logger.warning(f"Redis Connection Failure: {err}")
        redis_connection_status = f"error: {str(err)}"

    if redis_connection_status != "connected":
        response.status_code = status.HTTP_200_OK # Return 200 so web dashboard can read status object details cleanly
        return {
            "status": "degraded",
            "redis_connection": redis_connection_status,
            "message": "AI service is active but unable to connect to Redis cache broker"
        }

    return {
        "status": "ok",
        "redis_connection": redis_connection_status
    }
