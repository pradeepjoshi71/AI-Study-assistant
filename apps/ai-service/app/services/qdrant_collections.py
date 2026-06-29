"""
Manages the study_chunks_v2 Qdrant collection with named vectors:
  - text_vec: 1536-dim cosine (text embeddings from OpenAI/Gemini)
  - image_vec: 512-dim cosine (image embeddings, e.g. CLIP)

The legacy study_chunks collection remains active during the transition.
Both collections coexist; new ingestion paths target study_chunks_v2.
"""
import logging
from qdrant_client import QdrantClient
from qdrant_client.http.models import (
    Distance,
    VectorParams,
    NamedVectors,
)
from app.core.config import settings

logger = logging.getLogger(__name__)

# Collection names
LEGACY_COLLECTION = "study_chunks"
V2_COLLECTION = "study_chunks_v2"

# Named vector dimensions
TEXT_VEC_DIM = 1536   # OpenAI text-embedding-3-small / Gemini embedding
IMAGE_VEC_DIM = 512   # CLIP ViT-B/32 or similar image embedding


def get_qdrant_client() -> QdrantClient:
    """Returns a configured QdrantClient instance."""
    return QdrantClient(host=settings.QDRANT_HOST, port=settings.QDRANT_PORT)


def ensure_v2_collection(client: QdrantClient) -> bool:
    """
    Creates study_chunks_v2 with named vectors if it does not already exist.
    Also creates payload indexes for efficient filtering.
    Leaves study_chunks (legacy) collection untouched.

    Returns True if already existed or was created successfully.
    """
    try:
        collections = [c.name for c in client.get_collections().collections]

        if V2_COLLECTION in collections:
            logger.info(f"Qdrant collection '{V2_COLLECTION}' already exists. Skipping creation.")
            return True

        logger.info(f"Creating Qdrant collection '{V2_COLLECTION}' with named vectors...")
        client.create_collection(
            collection_name=V2_COLLECTION,
            vectors_config={
                "text_vec": VectorParams(
                    size=TEXT_VEC_DIM,
                    distance=Distance.COSINE,
                ),
                "image_vec": VectorParams(
                    size=IMAGE_VEC_DIM,
                    distance=Distance.COSINE,
                ),
            },
        )
        logger.info(f"'{V2_COLLECTION}' collection created with text_vec ({TEXT_VEC_DIM}-dim) and image_vec ({IMAGE_VEC_DIM}-dim).")

        # Payload indexes for metadata filtering
        for field, schema in [
            ("orgId", "keyword"),
            ("docId", "keyword"),
            ("userId", "keyword"),
            ("chunkId", "keyword"),
            ("pageRef", "integer"),
            ("modality", "keyword"),
            ("chunkIndex", "integer"),
        ]:
            client.create_payload_index(
                collection_name=V2_COLLECTION,
                field_name=field,
                field_schema=schema,
            )

        # Full-text index on text content for hybrid search
        client.create_payload_index(
            collection_name=V2_COLLECTION,
            field_name="text",
            field_schema="text",
        )

        logger.info(f"Payload indexes created for '{V2_COLLECTION}'.")
        return True

    except Exception as e:
        logger.error(f"Failed to ensure Qdrant collection '{V2_COLLECTION}': {e}")
        return False


def ensure_legacy_collection(client: QdrantClient) -> bool:
    """
    Ensures the legacy study_chunks collection still exists.
    Called on startup to guarantee backward compat during transition.
    """
    try:
        collections = [c.name for c in client.get_collections().collections]
        if LEGACY_COLLECTION not in collections:
            from qdrant_client.http.models import VectorParams, Distance
            logger.warning(f"Legacy collection '{LEGACY_COLLECTION}' missing — re-creating...")
            client.create_collection(
                collection_name=LEGACY_COLLECTION,
                vectors_config=VectorParams(size=TEXT_VEC_DIM, distance=Distance.COSINE),
            )
        logger.info(f"Legacy collection '{LEGACY_COLLECTION}' is active.")
        return True
    except Exception as e:
        logger.error(f"Failed to verify legacy collection: {e}")
        return False
