import os
import time
import logging
import asyncio
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from bullmq import Worker
from datetime import datetime

from app.core.config import settings
from app.db.models import DocumentChunk, Document
from app.services.vector_search import VectorSearchService

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("embedding_worker")

# PostgreSQL Database setup
db_url = os.getenv(
    "DATABASE_URL",
    f"postgresql://postgres:postgres_secure_pass@localhost:5432/study_assistant?schema=public"
)
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Initialize vector search service
vector_search_service = VectorSearchService()


async def process_embeddings_job(job, job_id):
    document_id = job.data.get("documentId")
    if not document_id:
        logger.error(f"Job {job_id} missing documentId")
        return {"success": False, "error": "Missing documentId"}

    logger.info(f"[Embedding Worker] Generating embeddings for document: {document_id}")
    db = SessionLocal()
    start_time = time.time()

    try:
        # 1. Fetch document and pending chunks
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            logger.error(f"Document {document_id} not found")
            return {"success": False, "error": "Document not found"}

        chunks = db.query(DocumentChunk).filter(
            DocumentChunk.documentId == document_id,
            DocumentChunk.embeddingStatus == "PENDING"
        ).order_by(DocumentChunk.chunkIndex.asc()).all()

        if not chunks:
            logger.info(f"No pending chunks found for document {document_id}")
            return {"success": True, "message": "No pending chunks"}

        logger.info(f"Found {len(chunks)} chunks to embed for document {document_id}")

        # 2. Package chunks for upsert
        chunks_payload = []
        for c in chunks:
            chunks_payload.append({
                "id": c.id,
                "documentId": c.documentId,
                "chunkIndex": c.chunkIndex,
                "content": c.content,
                "metadata": c.meta or {}
            })

        # 3. Generate embeddings & Upsert to Qdrant
        # This will query Gemini (or generate mock vectors if key is missing)
        success = vector_search_service.upsert_chunks(
            chunks=chunks_payload,
            userId=doc.userId,
            fileType=doc.fileType
        )

        if not success:
            raise Exception("Qdrant upsert returned unsuccessful state.")

        # 4. Update Database statuses to COMPLETED
        now = datetime.utcnow()
        for c in chunks:
            c.embeddingStatus = "COMPLETED"
            c.embeddingCreatedAt = now
        
        db.commit()
        duration = time.time() - start_time
        logger.info(f"[Embedding Worker] Completed embedding for {len(chunks)} chunks in {duration:.2f}s.")
        return {"success": True, "chunks_embedded": len(chunks), "duration_seconds": round(duration, 2)}

    except Exception as err:
        logger.error(f"[Embedding Worker] Failed to embed document {document_id}: {err}")
        db.rollback()
        
        # Set database statuses of pending chunks to FAILED
        try:
            db.query(DocumentChunk).filter(
                DocumentChunk.documentId == document_id,
                DocumentChunk.embeddingStatus == "PENDING"
            ).update({"embeddingStatus": "FAILED"})
            db.commit()
        except Exception as e:
            logger.error(f"Failed to set FAILED embedding status: {e}")

        return {"success": False, "error": str(err)}
    finally:
        db.close()


async def run_embedding_worker():
    redis_url = f"redis://{settings.AI_REDIS_HOST}:{settings.AI_REDIS_PORT}"
    logger.info(f"Starting BullMQ Python Embedding Worker connecting to Redis: {redis_url}")
    
    retry_count = 0
    while retry_count < 10:
        try:
            worker = Worker(
                "embedding-generation",
                process_embeddings_job,
                {
                    "connection": redis_url,
                    "concurrency": 1
                }
            )
            await worker.start()
            logger.info("BullMQ Worker listening to 'embedding-generation' queue.")
            while True:
                await asyncio.sleep(1)
        except Exception as e:
            retry_count += 1
            logger.warning(f"Failed to start embedding worker (attempt {retry_count}): {e}. Retrying in 3s...")
            await asyncio.sleep(3)
            
    logger.error("Failed to initialize BullMQ embedding worker after 10 attempts.")
