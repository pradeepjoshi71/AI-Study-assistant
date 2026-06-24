import os
import time
import logging
import asyncio
import tempfile
import uuid
import boto3
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from bullmq import Worker, Queue

from app.core.config import settings
from app.db.models import Document, DocumentChunk
from app.services.extractor import extract_document
from app.services.chunker import generate_chunks

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("worker")

# PostgreSQL Database setup
db_url = os.getenv(
    "DATABASE_URL",
    f"postgresql://postgres:postgres_secure_pass@localhost:5432/study_assistant?schema=public"
)
# Convert postgresql:// to postgresql+psycopg2:// if needed for SQLAlchemy
if db_url.startswith("postgresql://"):
    db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

engine = create_engine(db_url, pool_pre_ping=True)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# S3 Setup
s3_client = None
if settings.AI_REDIS_HOST:  # Check configs
    access_key = os.getenv("AWS_ACCESS_KEY_ID")
    secret_key = os.getenv("AWS_SECRET_ACCESS_KEY")
    region = os.getenv("AWS_REGION", "us-east-1")
    bucket_name = os.getenv("AWS_S3_BUCKET", "study-assistant-bucket")

    if access_key and secret_key:
        s3_client = boto3.client(
            "s3",
            aws_access_key_id=access_key,
            aws_secret_access_key=secret_key,
            region_name=region
        )
        logger.info("Worker S3 Client initialized successfully.")
    else:
        logger.warning("Worker running in Mock S3 Mode (No S3 credentials found).")


async def process_document_job(job, job_id):
    document_id = job.data.get("documentId")
    if not document_id:
        logger.error(f"Job {job_id} missing documentId")
        return {"success": False, "error": "Missing documentId"}

    logger.info(f"Worker processing document {document_id}")
    db = SessionLocal()
    start_time = datetime_now_utc()

    try:
        # 1. Fetch document metadata
        doc = db.query(Document).filter(Document.id == document_id).first()
        if not doc:
            logger.error(f"Document {document_id} not found in database")
            return {"success": False, "error": "Document not found"}

        # Update status to PROCESSING
        doc.status = "PROCESSING"
        doc.processingStartedAt = start_time
        db.commit()

        # 2. Download file from S3
        temp_dir = tempfile.gettempdir()
        file_ext = doc.originalName.split(".")[-1] if "." in doc.originalName else "txt"
        local_file_path = os.path.join(temp_dir, f"{document_id}.{file_ext}")

        if s3_client:
            logger.info(f"Downloading file from S3: {doc.storageKey}")
            s3_client.download_file(bucket_name, doc.storageKey, local_file_path)
        else:
            # Mock download: Write a temporary text/scanned content file depending on type
            logger.info(f"[Mock S3 Download] Simulating file download to {local_file_path}")
            with open(local_file_path, "w", encoding="utf-8") as f:
                if file_ext.lower() in ("png", "jpg", "jpeg"):
                    f.write("Scanned text simulated for OCR engine extraction tests.")
                else:
                    f.write(
                        "AI Study Assistant. This is a production grade test text file representing downloaded content. "
                        "We will split this text into semantic chunks of 1000 characters to test the chunking pipeline. "
                        "Make sure overlap size of 200 characters functions correctly without offsets."
                    )

        # 3. Extract Text & Metadata
        extraction_start = time.time()
        result = extract_document(local_file_path, doc.mimeType or file_ext)
        extraction_time = time.time() - extraction_start
        logger.info(f"Extracted document in {extraction_time:.2f} seconds.")

        # Clean up local file
        if os.path.exists(local_file_path):
            os.remove(local_file_path)

        # 4. Generate Semantic Chunks
        chunks = generate_chunks(result["pages"])
        
        # 5. Clear old chunks (in case of reprocessing)
        db.query(DocumentChunk).filter(DocumentChunk.documentId == document_id).delete()

        # 6. Save chunks to database
        full_extracted_text = " ".join([p["text"] for p in result["pages"]])
        for chunk_data in chunks:
            chunk = DocumentChunk(
                id=str(uuid.uuid4()),
                documentId=document_id,
                chunkIndex=chunk_data["chunkIndex"],
                content=chunk_data["content"],
                tokenCount=chunk_data["tokenCount"],
                meta=chunk_data["metadata"]
            )
            db.add(chunk)

        # 7. Update document status to READY
        doc.status = "READY"
        doc.pageCount = result["page_count"]
        doc.extractedTextLength = len(full_extracted_text)
        doc.processingCompletedAt = datetime_now_utc()
        
        # Log performance metrics to console
        total_processing_time = (doc.processingCompletedAt - doc.processingStartedAt).total_seconds()
        logger.info(
            f"Extraction time: {extraction_time:.2f}s. "
            f"Total processing time: {total_processing_time:.2f}s. "
            f"Generated chunks: {len(chunks)}"
        )
        db.commit()

        # Dispatch embedding-generation background job
        try:
            redis_url = f"redis://{settings.AI_REDIS_HOST}:{settings.AI_REDIS_PORT}"
            embedding_queue = Queue("embedding-generation", {"connection": redis_url})
            await embedding_queue.add("generate-embeddings", {"documentId": document_id})
            await embedding_queue.close()
            logger.info(f"Dispatched embedding-generation job for document: {document_id}")
        except Exception as q_err:
            logger.error(f"Failed to dispatch embedding job for document {document_id}: {q_err}")

        logger.info(f"Document {document_id} processed successfully. Chunks: {len(chunks)}")
        return {"success": True, "chunks": len(chunks)}

    except Exception as err:
        logger.error(f"Failed to process document {document_id}: {err}")
        db.rollback()
        
        # Update document status to FAILED
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.status = "FAILED"
            doc.processingError = str(err)
            doc.processingCompletedAt = datetime_now_utc()
            db.commit()
            
        return {"success": False, "error": str(err)}
    finally:
        db.close()


def datetime_now_utc():
    # Helper to return aware UTC datetime compatible with SQLAlchemy
    import datetime
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


async def run_worker():
    redis_url = f"redis://{settings.AI_REDIS_HOST}:{settings.AI_REDIS_PORT}"
    logger.info(f"Starting BullMQ Python Worker connecting to Redis: {redis_url}")
    
    # We must retry connection since Redis might boot after FastAPI on compose init
    retry_count = 0
    while retry_count < 10:
        try:
            worker = Worker(
                "document-processing",
                process_document_job,
                {
                    "connection": redis_url,
                    "concurrency": 2
                }
            )
            await worker.start()
            logger.info("BullMQ Worker started listening to 'document-processing' queue.")
            # Keep worker running
            while True:
                await asyncio.sleep(1)
        except Exception as e:
            retry_count += 1
            logger.warning(f"Failed to start BullMQ worker (attempt {retry_count}): {e}. Retrying in 3s...")
            await asyncio.sleep(3)
            
    logger.error("Failed to initialize BullMQ worker after 10 attempts.")
