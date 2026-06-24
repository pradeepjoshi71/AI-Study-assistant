import logging
from typing import List, Dict, Any
from sqlalchemy.orm import Session
from app.db.models import Document

logger = logging.getLogger(__name__)

class ContextBuilderService:
    def __init__(self):
        pass

    def build_context(self, chunks: List[Dict[str, Any]], db_session: Session) -> Dict[str, Any]:
        """
        Deduplicates chunks, merges their text, resolves document titles from the database,
        and compiles list of source page numbers.
        """
        logger.info(f"Building RAG context package from {len(chunks)} chunks...")
        
        if not chunks:
            return {
                "context": "",
                "sources": [],
                "pages": []
            }

        # 1. Deduplicate chunks by ID
        seen_chunks = set()
        unique_chunks = []
        for chunk in chunks:
            cid = chunk["chunkId"]
            if cid not in seen_chunks:
                seen_chunks.add(cid)
                unique_chunks.append(chunk)

        # Sort chunks by documentId and chunkIndex to maintain reading flow if possible
        unique_chunks.sort(key=lambda x: (x["documentId"], x["chunkIndex"]))

        # 2. Merge chunk contents
        context_parts = []
        doc_ids = set()
        page_refs = set()

        for chunk in unique_chunks:
            context_parts.append(chunk["content"])
            doc_ids.add(chunk["documentId"])
            
            # Record page references
            page_num = chunk.get("pageNumber")
            if page_num:
                page_refs.add(page_num)

        merged_context = "\n\n---\n\n".join(context_parts)

        # 3. Resolve document original names from PostgreSQL
        sources = []
        if doc_ids:
            try:
                documents = db_session.query(Document).filter(Document.id.in_(list(doc_ids))).all()
                for doc in documents:
                    sources.append({
                        "documentId": doc.id,
                        "originalName": doc.originalName
                    })
            except Exception as e:
                logger.error(f"Failed to fetch document sources from DB: {e}")
                # Fallback to returning IDs if query fails
                for doc_id in doc_ids:
                    sources.append({
                        "documentId": doc_id,
                        "originalName": f"Document ID: {doc_id}"
                    })

        return {
            "context": merged_context,
            "sources": sources,
            "pages": sorted(list(page_refs))
        }
