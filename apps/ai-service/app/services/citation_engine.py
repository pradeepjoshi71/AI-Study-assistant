"""
Phase 2.1.4 – Citation Engine
Maps reranked RAG chunks → structured citation objects.

Each citation contains:
- document_id   : UUID of the source document
- chunk_id      : UUID of the specific chunk
- page          : page number within the document
- score         : combined relevance score from the reranker

Supports multi-document citations (one entry per chunk, grouped by document).
"""

from typing import List, Dict, Any

def build_citations(reranked_chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Converts reranked chunk dicts into structured citation objects.

    Deduplication rule: if the same (document_id, page) pair appears more
    than once, only the highest-scoring entry is kept.

    Args:
        reranked_chunks: Output list from RerankerService.rerank(), each dict
                         containing at minimum: chunkId, documentId, pageNumber,
                         combinedScore (or score as fallback).

    Returns:
        List of citation dicts sorted by score descending, one per unique
        (document_id, chunk_id) pair.
    """
    seen: Dict[str, float] = {}   # chunk_id -> best score seen
    citations: Dict[str, Dict[str, Any]] = {}

    for chunk in reranked_chunks:
        chunk_id   = chunk.get("chunkId", "")
        doc_id     = chunk.get("documentId", "")
        page       = chunk.get("pageNumber")
        score      = chunk.get("combinedScore") or chunk.get("score") or 0.0

        if not chunk_id or not doc_id:
            continue

        # Keep only the best score for each chunk_id
        if chunk_id in seen and seen[chunk_id] >= score:
            continue

        seen[chunk_id] = score
        citations[chunk_id] = {
            "document_id": doc_id,
            "chunk_id":    chunk_id,
            "page":        page,
            "score":       round(score, 6),
        }

    # Sort by score descending (highest-relevance citations first)
    return sorted(citations.values(), key=lambda c: c["score"], reverse=True)


def group_citations_by_document(
    citations: List[Dict[str, Any]],
) -> Dict[str, List[Dict[str, Any]]]:
    """
    Groups a flat citation list by document_id.

    Useful for rendering multi-document footnote panels in the frontend.

    Returns:
        Dict mapping document_id -> list of citations for that document.
    """
    grouped: Dict[str, List[Dict[str, Any]]] = {}
    for cite in citations:
        doc_id = cite["document_id"]
        grouped.setdefault(doc_id, []).append(cite)
    return grouped
