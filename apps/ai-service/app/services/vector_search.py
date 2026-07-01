import logging
import random
from typing import List, Dict, Any, Optional
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, MatchText
import google.generativeai as genai
from app.core.config import settings
from app.services.qdrant_service import qdrant_service

logger = logging.getLogger(__name__)

class VectorSearchService:
    def __init__(self):
        self.qdrant_host = settings.QDRANT_HOST
        self.qdrant_port = settings.QDRANT_PORT
        self.collection_name = "study_chunks"

        # Initialize Qdrant Client
        try:
            self.write_client = qdrant_service.get_write_client()
            self.read_client = qdrant_service.get_read_client()
            self._init_collection()
        except Exception as e:
            logger.error(f"Failed to connect to Qdrant - {e}")
            self.write_client = None
            self.read_client = None

        # Configure Gemini Embeddings
        api_key = settings.GEMINI_API_KEY
        self.has_gemini = bool(api_key and api_key != "your_gemini_api_key_here" and api_key.strip() != "")
        if self.has_gemini:
            genai.configure(api_key=api_key)
            logger.info("Gemini API Key configured for Embeddings.")
        else:
            logger.warning("GEMINI_API_KEY missing or placeholder. VectorSearchService running in Mock Vector Mode.")

    def _init_collection(self):
        """
        Creates the study_chunks collection in Qdrant if it does not exist,
        and sets up payload indexes for filtering and text search.
        """
        if not self.write_client:
            return

        collections = self.write_client.get_collections().collections
        exists = any(c.name == self.collection_name for c in collections)

        if not exists:
            logger.info(f"Creating Qdrant collection: '{self.collection_name}'")
            # OpenAI text-embedding-3-small returns 1536-dimensional vectors
            self.write_client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=1536, distance=Distance.COSINE),
                replication_factor=2,
                write_consistency_factor=1,
            )

            # Create payload indexes for fast metadata filtering
            self.write_client.create_payload_index(
                collection_name=self.collection_name,
                field_name="documentId",
                field_schema="keyword",
            )
            self.write_client.create_payload_index(
                collection_name=self.collection_name,
                field_name="userId",
                field_schema="keyword",
            )
            self.write_client.create_payload_index(
                collection_name=self.collection_name,
                field_name="fileType",
                field_schema="keyword",
            )
            self.write_client.create_payload_index(
                collection_name=self.collection_name,
                field_name="pageNumber",
                field_schema="integer",
            )
            # Create full-text index on content for keyword search matching
            self.write_client.create_payload_index(
                collection_name=self.collection_name,
                field_name="content",
                field_schema="text",
            )
            logger.info("Qdrant collection and payload indexes created successfully.")

    def get_embedding(self, text: str, is_query: bool = False) -> List[float]:
        """
        Generates 1536-dimensional vector embedding for the input text using OpenAI text-embedding-3-small.
        Delegates to EmbeddingService to reuse cache and OpenAI client.
        """
        from app.services.embedding_service import EmbeddingService
        service = EmbeddingService()
        result = service.get_embeddings([text])
        return result[0]

    def upsert_chunks(self, chunks: List[Dict[str, Any]], userId: str, fileType: str) -> bool:
        """
        Pushes a list of semantic chunks with their vector embeddings into Qdrant.
        """
        if not self.write_client:
            logger.warning("Skipping Qdrant upsert: Qdrant Client not initialized.")
            return False

        points = []
        for chunk in chunks:
            chunk_content = chunk["content"]
            vector = self.get_embedding(chunk_content)

            # Map page metadata (since source_pages can contain multiple elements, use first page as primary or store list)
            pages = chunk["metadata"].get("source_pages", [1])
            page_num = pages[0] if pages else 1

            points.append(
                PointStruct(
                    id=chunk["id"],
                    vector=vector,
                    payload={
                        "chunkId": chunk["id"],
                        "documentId": chunk["documentId"],
                        "userId": userId,
                        "pageNumber": page_num,
                        "chunkIndex": chunk["chunkIndex"],
                        "fileType": fileType,
                        "content": chunk_content,
                    }
                )
            )

        try:
            self.write_client.upsert(
                collection_name=self.collection_name,
                points=points
            )
            logger.info(f"Successfully upserted {len(points)} vectors into Qdrant.")
            return True
        except Exception as e:
            logger.error(f"Qdrant upsert failed: {e}")
            raise e

    def hybrid_search(self, userId: str, query: str, documentIds: List[str] = None, fileType: str = None, pageNumber: int = None, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Performs hybrid retrieval: Combines Semantic (Vector) Search and Keyword (Text payload match) Search,
        applies metadata filters, and merges outputs using Reciprocal Rank Fusion (RRF).
        """
        if not self.read_client:
            logger.warning("Hybrid search bypassed: Qdrant client offline.")
            return []

        # 1. Build Metadata filters
        must_conditions = [FieldCondition(key="userId", match=MatchValue(value=userId))]

        if documentIds:
            # If search is bounded to specific documents
            doc_conditions = []
            for doc_id in documentIds:
                doc_conditions.append(FieldCondition(key="documentId", match=MatchValue(value=doc_id)))
            
            # Match any of the selected documentIds (OR match)
            if len(doc_conditions) == 1:
                must_conditions.append(doc_conditions[0])
            elif len(doc_conditions) > 1:
                # Add inner OR condition using Qdrant's filter matching
                must_conditions.append(Filter(should=doc_conditions))

        if fileType:
            must_conditions.append(FieldCondition(key="fileType", match=MatchValue(value=fileType)))
        if pageNumber:
            must_conditions.append(FieldCondition(key="pageNumber", match=MatchValue(value=pageNumber)))

        search_filter = Filter(must=must_conditions)

        # 2. Semantic Search (Vector)
        query_vector = self.get_embedding(query, is_query=True)
        try:
            search_request = models.SearchRequest(
                vector=query_vector,
                filter=search_filter,
                limit=limit,
                with_payload=True
            )
            response = self.read_client.http.search_api.search_points(
                collection_name=self.collection_name,
                search_request=search_request
            )
            semantic_results = response.result
        except Exception as e:
            logger.error(f"Semantic search failed: {e}")
            semantic_results = []

        # 3. Keyword Search (Text Payload Match)
        keyword_filter = Filter(
            must=must_conditions + [FieldCondition(key="content", match=MatchText(text=query))]
        )
        keyword_results = self.read_client.scroll(
            collection_name=self.collection_name,
            scroll_filter=keyword_filter,
            limit=limit,
            with_payload=True,
            with_vectors=False
        )[0]

        # 4. Reciprocal Rank Fusion (RRF) to merge lists
        rrf_scores = {}
        payload_map = {}
        constant_k = 60 # RRF parameter

        # Process Semantic Rank
        for rank, hit in enumerate(semantic_results):
            chunk_id = hit.payload["chunkId"]
            rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0.0) + (1.0 / (constant_k + rank + 1))
            payload_map[chunk_id] = hit.payload

        # Process Keyword Rank
        for rank, record in enumerate(keyword_results):
            chunk_id = record.payload["chunkId"]
            rrf_scores[chunk_id] = rrf_scores.get(chunk_id, 0.0) + (1.0 / (constant_k + rank + 1))
            payload_map[chunk_id] = record.payload

        # 5. Sort by RRF score and return
        sorted_chunk_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)
        
        results = []
        for cid in sorted_chunk_ids[:limit]:
            results.append({
                "chunkId": cid,
                "documentId": payload_map[cid]["documentId"],
                "userId": payload_map[cid]["userId"],
                "pageNumber": payload_map[cid]["pageNumber"],
                "chunkIndex": payload_map[cid]["chunkIndex"],
                "fileType": payload_map[cid]["fileType"],
                "content": payload_map[cid]["content"],
                "score": rrf_scores[cid]
            })

        return results
