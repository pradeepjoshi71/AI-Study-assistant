"""
Minio image storage service.

Images are stored using the key pattern:
    orgs/{orgId}/docs/{docId}/images/{imageId}.png

Provides:
  - get_client()      — returns a configured Minio client
  - upload_image()    — uploads raw bytes, returns the storage key
  - get_presigned_url() — returns a temporary signed URL for download
"""
import io
import logging
import uuid
from typing import Optional

from minio import Minio
from minio.error import S3Error

from app.core.config import settings

logger = logging.getLogger(__name__)

# Key template matching the specified Minio image path convention
IMAGE_KEY_TEMPLATE = "orgs/{org_id}/docs/{doc_id}/images/{image_id}.png"


def get_minio_client() -> Minio:
    """Returns a configured Minio client."""
    return Minio(
        endpoint=settings.MINIO_ENDPOINT,
        access_key=settings.MINIO_ACCESS_KEY,
        secret_key=settings.MINIO_SECRET_KEY,
        secure=settings.MINIO_SECURE,
    )


def build_image_key(org_id: str, doc_id: str, image_id: Optional[str] = None) -> str:
    """
    Builds the canonical Minio object key for a chunk image.
    Generates a UUID image_id if not supplied.
    """
    image_id = image_id or str(uuid.uuid4())
    return IMAGE_KEY_TEMPLATE.format(org_id=org_id, doc_id=doc_id, image_id=image_id)


def ensure_bucket(client: Minio, bucket: str = settings.MINIO_BUCKET) -> None:
    """Creates the Minio bucket if it does not exist."""
    try:
        if not client.bucket_exists(bucket):
            client.make_bucket(bucket)
            logger.info(f"Created Minio bucket: {bucket}")
        else:
            logger.debug(f"Minio bucket '{bucket}' already exists.")
    except S3Error as e:
        logger.error(f"Failed to ensure Minio bucket '{bucket}': {e}")
        raise


def upload_image(
    image_bytes: bytes,
    org_id: str,
    doc_id: str,
    image_id: Optional[str] = None,
    content_type: str = "image/png",
    bucket: Optional[str] = None,
) -> str:
    """
    Uploads raw image bytes to Minio under the canonical key:
        orgs/{orgId}/docs/{docId}/images/{imageId}.png

    Returns the storage key (not a full URL) for persistence in ChunkImage.storageKey.
    """
    bucket = bucket or settings.MINIO_BUCKET
    storage_key = build_image_key(org_id, doc_id, image_id)

    try:
        client = get_minio_client()
        ensure_bucket(client, bucket)

        data = io.BytesIO(image_bytes)
        client.put_object(
            bucket_name=bucket,
            object_name=storage_key,
            data=data,
            length=len(image_bytes),
            content_type=content_type,
        )
        logger.info(f"Uploaded image to Minio: {bucket}/{storage_key}")
        return storage_key

    except S3Error as e:
        logger.error(f"Minio upload failed for key '{storage_key}': {e}")
        raise


def get_presigned_url(
    storage_key: str,
    expires_seconds: int = 3600,
    bucket: Optional[str] = None,
) -> str:
    """
    Returns a pre-signed GET URL for the given Minio storage key.
    Default expiry: 1 hour.
    """
    from datetime import timedelta

    bucket = bucket or settings.MINIO_BUCKET
    try:
        client = get_minio_client()
        url = client.presigned_get_object(
            bucket_name=bucket,
            object_name=storage_key,
            expires=timedelta(seconds=expires_seconds),
        )
        return url
    except S3Error as e:
        logger.error(f"Failed to generate presigned URL for '{storage_key}': {e}")
        raise
