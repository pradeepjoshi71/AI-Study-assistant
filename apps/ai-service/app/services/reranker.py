import math
import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class RerankerService:
    def __init__(self):
        pass

    def _dot_product(self, v1: List[float], v2: List[float]) -> float:
        return sum(x * y for x, y in zip(v1, v2))

    def _magnitude(self, v: List[float]) -> float:
        return math.sqrt(sum(x * x for x in v))

    def _cosine_similarity(self, v1: List[float], v2: List[float]) -> float:
        mag1 = self._magnitude(v1)
        mag2 = self._magnitude(v2)
        if not mag1 or not mag2:
            return 0.0
        return self._dot_product(v1, v2) / (mag1 * mag2)

    def rerank(self, query_vector: List[float], chunks: List[Dict[str, Any]], vector_search_service: Any, limit: int = 5) -> List[Dict[str, Any]]:
        """
        Reranks the top chunks by generating embeddings on the fly (or checking Qdrant results),
        calculating cosine similarity against the query vector, and returning the top `limit` results.
        """
        logger.info(f"Rerank request: scoring {len(chunks)} chunks...")
        
        scored_chunks = []
        for chunk in chunks:
            try:
                # Generate vector for the chunk content to perform high-fidelity reranking
                chunk_vector = vector_search_service.get_embedding(chunk["content"])
                similarity = self._cosine_similarity(query_vector, chunk_vector)
                
                # Combine similarity score with the retrieval RRF score
                combined_score = 0.7 * similarity + 0.3 * chunk.get("score", 0.0)
                
                scored_chunks.append({
                    **chunk,
                    "relevanceScore": round(similarity, 4),
                    "combinedScore": round(combined_score, 4)
                })
            except Exception as e:
                logger.warning(f"Failed to score chunk {chunk.get('chunkId')}: {e}")
                # Fallback to initial score if embedding fails
                scored_chunks.append({
                    **chunk,
                    "relevanceScore": chunk.get("score", 0.0),
                    "combinedScore": chunk.get("score", 0.0)
                })

        # Sort by combined score descending
        scored_chunks.sort(key=lambda x: x["combinedScore"], reverse=True)
        
        logger.info(f"Reranker completed. Returning top {limit} scored chunks.")
        return scored_chunks[:limit]
