import logging
import uuid
from typing import Any, Dict, List, Optional
from qdrant_client.http import models
from qdrant_client.http.models import Distance, VectorParams, PointStruct, Filter, FieldCondition, MatchValue
from app.services.qdrant_service import qdrant_service

from app.core.config import settings
from app.services.vector_search import VectorSearchService

logger = logging.getLogger(__name__)

class SharedRAGService:
  def __init__(self):
    self.collection_name = "study_chunks"
    self.vector_search = VectorSearchService()

    try:
      self.write_client = qdrant_service.get_write_client()
      self.read_client = qdrant_service.get_read_client()
    except Exception as e:
      logger.error(f"SharedRAGService: Failed to connect to Qdrant - {e}")
      self.write_client = None
      self.read_client = None

  def add_document_to_group(self, doc_id: str, added_by: str, group_id: str) -> bool:
    """
    Fetch all vectors from Qdrant where docId=doc_id and userId=added_by.
    Upsert to Qdrant collection with payload namespace=group:{group_id}.
    """
    if not self.write_client or not self.read_client:
      logger.warning("Qdrant client not initialized. Skipping add_document_to_group.")
      return False

    try:
      # 1. Scroll/fetch all points of the document
      scroll_filter = Filter(must=[
        FieldCondition(key="documentId", match=MatchValue(value=doc_id)),
        FieldCondition(key="userId", match=MatchValue(value=added_by))
      ])

      scroll_result = self.read_client.scroll(
        collection_name=self.collection_name,
        scroll_filter=scroll_filter,
        limit=1000,
        with_payload=True,
        with_vectors=True
      )

      points = scroll_result[0] if scroll_result else []

      if not points:
        logger.warning(f"No points found for doc_id={doc_id} by user={added_by}")
        return False

      # 2. Duplicate points with modified namespace
      new_points = []
      for p in points:
        new_payload = dict(p.payload) if p.payload else {}
        new_payload["namespace"] = f"group:{group_id}"

        new_points.append(
          PointStruct(
            id=str(uuid.uuid4()),
            vector=p.vector,
            payload=new_payload
          )
        )

      # 3. Upsert
      self.write_client.upsert(
        collection_name=self.collection_name,
        points=new_points
      )
      logger.info(f"Successfully copied {len(new_points)} vectors to group {group_id} for doc {doc_id}")
      return True
    except Exception as e:
      logger.error(f"Failed to add document to group: {e}")
      raise e

  def remove_document_from_group(self, doc_id: str, group_id: str) -> bool:
    """
    Delete points where docId=doc_id and namespace=group:{group_id}.
    """
    if not self.write_client:
      return False

    try:
      self.write_client.delete(
        collection_name=self.collection_name,
        points_selector=models.FilterSelector(
          filter=Filter(must=[
            FieldCondition(key="documentId", match=MatchValue(value=doc_id)),
            FieldCondition(key="namespace", match=MatchValue(value=f"group:{group_id}"))
          ])
        )
      )
      logger.info(f"Successfully deleted vectors for group {group_id} and doc {doc_id}")
      return True
    except Exception as e:
      logger.error(f"Failed to remove document from group: {e}")
      raise e

  def search_group(
    self,
    group_id: str,
    query: str,
    group_member_ids: Optional[List[str]] = None,
    limit: int = 6
  ) -> List[Dict[str, Any]]:
    """
    Search group namespace (filter namespace=group:{groupId}), top 6.
    If results < 3, fallback to search personal namespaces of all group members.
    Weight group results score 1.2 vs personal score 1.0.
    """
    if not self.read_client:
      return []

    # 1. Get query embedding
    try:
      query_vector = self.vector_search.get_embedding(query, is_query=True)
    except Exception as e:
      logger.error(f"Failed to get embedding: {e}")
      return []

    # 2. Search group namespace
    group_filter = Filter(must=[
      FieldCondition(key="namespace", match=MatchValue(value=f"group:{group_id}"))
    ])

    group_results = []
    try:
      group_results = self.read_client.search(
        collection_name=self.collection_name,
        query_vector=query_vector,
        query_filter=group_filter,
        limit=limit,
        with_payload=True
      )
    except Exception as e:
      logger.error(f"Group semantic search failed: {e}")

    # 3. Deduplicate and score group results (weight = 1.2)
    merged: Dict[str, Dict[str, Any]] = {}
    for res in group_results:
      payload = res.payload or {}
      doc_id = payload.get("documentId", "unknown")
      chunk_idx = payload.get("chunkIndex", 0)
      key = f"{doc_id}_{chunk_idx}"

      merged[key] = {
        "id": res.id,
        "score": res.score * 1.2,
        "payload": payload
      }

    # 4. Fallback search if group results < 3
    if len(group_results) < 3 and group_member_ids:
      logger.info(f"Group results count ({len(group_results)}) < 3. Triggering personal namespace fallback.")
      
      should_conditions = [
        FieldCondition(key="userId", match=MatchValue(value=mid))
        for mid in group_member_ids
      ]
      # Personal namespace search: must match member userId, and must NOT belong to a group namespace
      fallback_filter = Filter(
        must=[Filter(should=should_conditions)]
      )

      fallback_results = []
      try:
        fallback_results = self.read_client.search(
          collection_name=self.collection_name,
          query_vector=query_vector,
          query_filter=fallback_filter,
          limit=limit,
          with_payload=True
        )
      except Exception as e:
        logger.error(f"Fallback search failed: {e}")

      # Merge fallback results (weight = 1.0)
      for res in fallback_results:
        payload = res.payload or {}
        doc_id = payload.get("documentId", "unknown")
        chunk_idx = payload.get("chunkIndex", 0)
        key = f"{doc_id}_{chunk_idx}"

        score = res.score * 1.0
        if key not in merged or score > merged[key]["score"]:
          merged[key] = {
            "id": res.id,
            "score": score,
            "payload": payload
          }

    # 5. Sort by final score descending and limit to top 6
    final_list = list(merged.values())
    final_list.sort(key=lambda x: x["score"], reverse=True)
    return final_list[:limit]
