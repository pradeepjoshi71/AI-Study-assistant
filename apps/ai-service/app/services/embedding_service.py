import logging
import hashlib
import redis
from typing import List, Optional
from openai import OpenAI
from app.core.config import settings

logger = logging.getLogger(__name__)

class EmbeddingService:
    """
    EmbeddingService generates vector embeddings using OpenAI's text-embedding-3-small model.
    Batches input chunks in groups of 20.
    Caches vector embeddings by SHA256 of text in Redis (TTL 7d) to avoid redundant OpenAI API calls.
    """

    def __init__(self):
        self.openai_api_key = settings.OPENAI_API_KEY
        self.has_openai = bool(self.openai_api_key and self.openai_api_key.strip())
        
        if self.has_openai:
            self.client = OpenAI(api_key=self.openai_api_key)
            logger.info("OpenAI client initialized for EmbeddingService.")
        else:
            self.client = None
            logger.warning("OPENAI_API_KEY missing. EmbeddingService running in Mock Mode.")

        # Redis client setup for caching embeddings
        try:
            self.redis_client = redis.Redis(
                host=settings.AI_REDIS_HOST,
                port=settings.AI_REDIS_PORT,
                password=settings.AI_REDIS_PASSWORD,
                decode_responses=True
            )
            self.redis_client.ping()
            logger.info(f"Connected to Redis cache at {settings.AI_REDIS_HOST}:{settings.AI_REDIS_PORT}")
        except Exception as e:
            self.redis_client = None
            logger.warning(f"Could not connect to Redis for caching: {e}. Caching is disabled.")

    def get_embeddings(self, texts: List[str]) -> List[List[float]]:
        """
        Receives a list of string contents, checks Redis cache, batches remaining misses in groups of 20,
        requests OpenAI text-embedding-3-small, caches new results in Redis (TTL 7d), and returns vectors.
        """
        if not texts:
            return []

        results = [None] * len(texts)
        cache_miss_indices = []
        cache_miss_texts = []

        # 1. Check Redis Cache first
        for idx, text in enumerate(texts):
            # Clean text whitespace for consistent hashing
            clean_text = " ".join(text.split())
            sha = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
            cache_key = f"embed:sha256:{sha}"

            cached_vector = None
            if self.redis_client:
                try:
                    raw_val = self.redis_client.get(cache_key)
                    if raw_val:
                        # Convert comma-separated string back to list of floats
                        cached_vector = [float(x) for x in raw_val.split(",")]
                except Exception as cache_err:
                    logger.debug(f"Redis get failed: {cache_err}")

            if cached_vector:
                results[idx] = cached_vector
            else:
                cache_miss_indices.append(idx)
                cache_miss_texts.append(clean_text)

        if not cache_miss_texts:
            return results

        # 2. Batch misses in groups of 20 and call OpenAI
        batch_size = 20
        openai_vectors = []

        for i in range(0, len(cache_miss_texts), batch_size):
            batch = cache_miss_texts[i:i + batch_size]
            
            if self.client:
                try:
                    logger.info(f"Calling OpenAI embedding API for batch of {len(batch)} chunks...")
                    response = self.client.embeddings.create(
                        model="text-embedding-3-small",
                        input=batch,
                        encoding_format="float"
                    )
                    # Preserve API output order
                    batch_vectors = [data.embedding for data in response.data]
                    openai_vectors.extend(batch_vectors)
                except Exception as api_err:
                    logger.error(f"OpenAI embedding generation failed: {api_err}")
                    raise api_err
            else:
                # Return deterministic mock vector for local testing (dimension size 1536 for text-embedding-3-small)
                logger.warning(f"Mocking embeddings for batch of {len(batch)} chunks.")
                import random
                for t in batch:
                    random.seed(hash(t))
                    mock_vec = [random.uniform(-1.0, 1.0) for _ in range(1536)]
                    openai_vectors.append(mock_vec)

        # 3. Cache new embeddings in Redis (TTL 7d = 604800s) and fill results list
        for miss_idx, clean_text in enumerate(cache_miss_texts):
            original_idx = cache_miss_indices[miss_idx]
            vector = openai_vectors[miss_idx]
            results[original_idx] = vector

            if self.redis_client:
                try:
                    sha = hashlib.sha256(clean_text.encode("utf-8")).hexdigest()
                    cache_key = f"embed:sha256:{sha}"
                    # Store vector as comma-separated string to save space and make parse easy
                    vector_str = ",".join(map(str, vector))
                    self.redis_client.setex(cache_key, 604800, vector_str)
                except Exception as cache_err:
                    logger.debug(f"Redis set failed: {cache_err}")

        return results
