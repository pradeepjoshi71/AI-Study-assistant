import logging
import random
from typing import List, Dict, Any, Optional
from qdrant_client import QdrantClient
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue, MatchText
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)

class VectorSearchService:
    def __init__(self):
        self.qdrant_host = settings.QDRANT_HOST
        self.qdrant_port = settings.QDRANT_PORT
        self.collection_name = "document_chunks"

        # Initialize Qdrant Client
        try:
            self.client = QdrantClient(host=self.qdrant_host, port=self.qdrant_port)
            self._init_collection()
        except Exception as e:
            logger.error(f"Failed to connect to Qdrant at {self.qdrant_host}:{self.qdrant_port} - {e}")
            self.client = None

        # Configure Gemini Embeddings
        if settings.GEMINI_API_KEY:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            self.has_gemini = True
            logger.info("Gemini API Key configured for Embeddings.")
        else:
            self.has_gemini = False
            logger.warning("GEMINI_API_KEY missing. VectorSearchService running in Mock Vector Mode.")

    def _init_collection(self):
        """
        Creates the document_chunks collection in Qdrant if it does not exist,
        and sets up payload indexes for filtering and text search.
        """
        if not self.client:
            return

        collections = self.client.get_collections().collections
        exists = any(c.name == self.collection_name for c in collections)

        if not exists:
            logger.info(f"Creating Qdrant collection: '{self.collection_name}'")
            # text-embedding-004 returns 768-dimensional vectors
            self.client.create_collection(
                collection_name=self.collection_name,
                vectors_config=VectorParams(size=768, distance=Distance.COSINE),
            )

            # Create payload indexes for fast metadata filtering
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="documentId",
                field_schema="keyword",
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="userId",
                field_schema="keyword",
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="fileType",
                field_schema="keyword",
            )
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="pageNumber",
                field_schema="integer",
            )
            # Create full-text index on content for keyword search matching
            self.client.create_payload_index(
                collection_name=self.collection_name,
                field_name="content",
                field_schema="text",
            )
            logger.info("Qdrant collection and payload indexes created successfully.")

    def get_embedding(self, text: str, is_query: bool = False) -> List[float]:
        """
        Generates 768-dimensional vector embedding for the input text using Gemini text-embedding-004.
        Falls back to generating mock random vectors if Gemini API credentials are not set.
        """
        if not self.has_gemini:
            # Return deterministic mock vector for local testing
            random.seed(hash(text))
            return [random.uniform(-1.0, 1.0) for _ in range(768)]

        try:
            task_type = "retrieval_query" if is_query else "retrieval_document"
            result = genai.embed_content(
                model="models/text-embedding-004",
                content=text,
                task_type=task_type
            )
            return result["embedding"]
        except Exception as e:
            logger.error(f"Gemini embedding generation failed: {e}")
            raise e

    def upsert_chunks(self, chunks: List[Dict[str, Any]], userId: str, fileType: str) -> bool:
        """
        Pushes a list of semantic chunks with their vector embeddings into Qdrant.
        """
        if not self.client:
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
            self.client.upsert(
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
        if not self.client:
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
        semantic_results = self.client.search(
            collection_name=self.collection_name,
            query_vector=query_vector,
            query_filter=search_filter,
            limit=limit
        )

        # 3. Keyword Search (Text Payload Match)
        keyword_filter = Filter(
            must=must_conditions + [FieldCondition(key="content", match=MatchText(text=query))]
        )
        keyword_results = self.client.scroll(
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
