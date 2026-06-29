import logging
from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import boto3

from app.services.pipeline import PipelineService

logger = logging.getLogger(__name__)
router = APIRouter()

# Setup S3 Client fallback matching worker config
s3_client = None
access_key = os.getenv("AWS_ACCESS_KEY_ID") or os.getenv("MINIO_ACCESS_KEY")
secret_key = os.getenv("AWS_SECRET_ACCESS_KEY") or os.getenv("MINIO_SECRET_KEY")
region = os.getenv("AWS_REGION") or os.getenv("MINIO_REGION", "us-east-1")
bucket_name = os.getenv("AWS_S3_BUCKET") or os.getenv("MINIO_BUCKET", "study-assistant")
endpoint_url = os.getenv("MINIO_ENDPOINT") # MinIO custom endpoint

if access_key and secret_key:
    client_kwargs = {
        "aws_access_key_id": access_key,
        "aws_secret_access_key": secret_key,
        "region_name": region
    }
    if endpoint_url:
        client_kwargs["endpoint_url"] = endpoint_url
        # Required for path style access with MinIO
        from botocore.client import Config
        client_kwargs["config"] = Config(signature_version='s3v4')
        logger.info(f"Pipeline S3 client using MinIO endpoint: {endpoint_url}")

    s3_client = boto3.client("s3", **client_kwargs)
    logger.info("Pipeline S3 Client initialized successfully.")
else:
    logger.warning("Pipeline service running in Mock S3 Mode (No credentials found).")

# Instantiate service instance
pipeline_service = PipelineService(s3_client=s3_client, bucket_name=bucket_name)

class IngestPipelineRequest(BaseModel):
    documentId: str
    storageKey: str
    mimeType: str

class ParsedSegment(BaseModel):
    text: str
    pageRef: int
    sectionTitle: Optional[str] = None

class IngestPipelineResponse(BaseModel):
    documentId: str
    segments: List[ParsedSegment]
    segmentCount: int

@router.post("/pipeline/parse", response_model=IngestPipelineResponse)
def parse_document_endpoint(req: IngestPipelineRequest):
    """
    FastAPI Router Endpoint for parsing documents.
    Routes document extraction based on type:
    - PyMuPDF for text PDF
    - Tesseract for scanned PDF/images
    - python-docx for DOCX
    - python-pptx for PPTX
    - plain read for TXT/MD
    - yt-dlp+faster-whisper for YouTube URLs
    - Playwright+readability for web URLs
    """
    logger.info(f"Received parse request for docId={req.documentId}, key={req.storageKey}")
    try:
        results = pipeline_service.parse_document(
            doc_id=req.documentId,
            storage_key=req.storageKey,
            mime_type=req.mimeType
        )
        
        segments = [
            ParsedSegment(
                text=r["text"],
                pageRef=r["pageRef"],
                sectionTitle=r["sectionTitle"]
            )
            for r in results
        ]

        return IngestPipelineResponse(
            documentId=req.documentId,
            segments=segments,
            segmentCount=len(segments)
        )
    except Exception as e:
        logger.error(f"Failed parsing document {req.documentId}: {e}")
        raise HTTPException(
            status_code=500,
            detail=f"Ingestion extraction pipeline failed: {str(e)}"
        )
