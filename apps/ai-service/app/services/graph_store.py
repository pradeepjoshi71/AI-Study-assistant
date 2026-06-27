"""
Phase 2.1.9 – Knowledge Graph Store
Persists extracted concept nodes, typed edges, and chunk-concept mappings
to PostgreSQL using SQLAlchemy.

Storage strategy:
  Concepts       → upsert by (tenantId, name); update confidence if higher
  ConceptRelation→ upsert by (tenantId, fromConceptId, toConceptId, relationType); max weight wins
  ChunkConceptMap→ upsert by (chunkId, conceptId); update confidence if higher

All operations are idempotent — safe to call multiple times for the same chunk.
"""

import uuid
import logging
from typing import List, Dict, Any

from sqlalchemy.orm import Session

from app.db.models import Concept, ConceptRelation, ChunkConceptMap

logger = logging.getLogger(__name__)


# ── Types (matching knowledge_graph.py schemas) ───────────────────────────────

class _ConceptIn:
    def __init__(self, name: str, display_name: str, confidence: float):
        self.name = name
        self.display_name = display_name
        self.confidence = confidence


class _RelationIn:
    def __init__(self, from_concept: str, to_concept: str, relation_type: str, weight: float):
        self.from_concept = from_concept
        self.to_concept = to_concept
        self.relation_type = relation_type
        self.weight = weight


# ── Core persistence ──────────────────────────────────────────────────────────

def _upsert_concept(db: Session, tenant_id: str, name: str, display_name: str, confidence: float) -> str:
    """
    Insert concept if not existing; update confidence if the new value is higher.
    Returns the concept's UUID.
    """
    existing = (
        db.query(Concept)
        .filter(Concept.tenantId == tenant_id, Concept.name == name)
        .first()
    )
    if existing:
        if confidence > existing.confidence:
            existing.confidence = confidence
        return existing.id

    concept_id = str(uuid.uuid4())
    db.add(Concept(
        id=concept_id,
        tenantId=tenant_id,
        name=name,
        displayName=display_name,
        confidence=confidence,
    ))
    return concept_id


def _upsert_relation(
    db: Session,
    tenant_id: str,
    from_id: str,
    to_id: str,
    relation_type: str,
    weight: float,
) -> None:
    """
    Insert edge if not existing; take max weight if it does.
    """
    existing = (
        db.query(ConceptRelation)
        .filter(
            ConceptRelation.tenantId == tenant_id,
            ConceptRelation.fromConceptId == from_id,
            ConceptRelation.toConceptId == to_id,
            ConceptRelation.relationType == relation_type,
        )
        .first()
    )
    if existing:
        existing.weight = max(existing.weight, weight)
        return

    db.add(ConceptRelation(
        id=str(uuid.uuid4()),
        tenantId=tenant_id,
        fromConceptId=from_id,
        toConceptId=to_id,
        relationType=relation_type,
        weight=weight,
    ))


def _upsert_chunk_map(db: Session, chunk_id: str, concept_id: str, tenant_id: str, confidence: float) -> None:
    """
    Map chunk → concept if not already mapped; update confidence if higher.
    """
    existing = (
        db.query(ChunkConceptMap)
        .filter(ChunkConceptMap.chunkId == chunk_id, ChunkConceptMap.conceptId == concept_id)
        .first()
    )
    if existing:
        existing.confidence = max(existing.confidence, confidence)
        return

    db.add(ChunkConceptMap(
        id=str(uuid.uuid4()),
        chunkId=chunk_id,
        conceptId=concept_id,
        tenantId=tenant_id,
        confidence=confidence,
    ))


# ── Public API ────────────────────────────────────────────────────────────────

def persist_graph_results(
    db: Session,
    tenant_id: str,
    chunk_results: List[Dict[str, Any]],
) -> Dict[str, int]:
    """
    Persists a batch of chunk extraction results to PostgreSQL.

    Args:
        db:           SQLAlchemy session.
        tenant_id:    Tenant scoping key.
        chunk_results: List of dicts matching ChunkExtractionResult schema:
                       [{chunkId, concepts: [{name, displayName, confidence}],
                                  relations: [{fromConcept, toConcept, relationType, weight}]}]

    Returns:
        Summary dict: {concepts_upserted, relations_upserted, chunk_maps_upserted}
    """
    concepts_upserted = 0
    relations_upserted = 0
    chunk_maps_upserted = 0

    try:
        for result in chunk_results:
            chunk_id = result.get("chunkId", "")
            concepts = result.get("concepts", [])
            relations = result.get("relations", [])

            # 1. Upsert concept nodes; build name → id lookup for this chunk
            name_to_id: Dict[str, str] = {}
            for c in concepts:
                name = (c.get("name") or "").strip().lower()
                display = (c.get("displayName") or name).strip()
                conf = float(c.get("confidence", 1.0))
                if not name:
                    continue
                cid = _upsert_concept(db, tenant_id, name, display, conf)
                name_to_id[name] = cid
                concepts_upserted += 1

                # 2. Map chunk → concept
                if chunk_id:
                    _upsert_chunk_map(db, chunk_id, cid, tenant_id, conf)
                    chunk_maps_upserted += 1

            # 3. Upsert edges (only between concepts we just extracted)
            for rel in relations:
                from_name = (rel.get("fromConcept") or "").strip().lower()
                to_name   = (rel.get("toConcept") or "").strip().lower()
                rel_type  = rel.get("relationType", "RELATED_TO")
                weight    = float(rel.get("weight", 1.0))

                # Validate relation type
                if rel_type not in {"EXPLAINS", "RELATED_TO", "PREREQUISITE_OF", "PART_OF"}:
                    rel_type = "RELATED_TO"

                from_id = name_to_id.get(from_name)
                to_id   = name_to_id.get(to_name)
                if not from_id or not to_id or from_id == to_id:
                    continue

                _upsert_relation(db, tenant_id, from_id, to_id, rel_type, weight)
                relations_upserted += 1

        db.commit()
        logger.info(
            f"[graph_store] persisted for tenant={tenant_id}: "
            f"{concepts_upserted} concepts, {relations_upserted} relations, "
            f"{chunk_maps_upserted} chunk maps."
        )
    except Exception as e:
        db.rollback()
        logger.error(f"[graph_store] persist failed: {e}")
        raise

    return {
        "concepts_upserted": concepts_upserted,
        "relations_upserted": relations_upserted,
        "chunk_maps_upserted": chunk_maps_upserted,
    }


def get_concept_graph(
    db: Session,
    tenant_id: str,
    concept_name: str,
    depth: int = 1,
) -> Dict[str, Any]:
    """
    Returns the local subgraph around a concept up to `depth` hops.

    Args:
        db:           SQLAlchemy session.
        tenant_id:    Tenant scoping key.
        concept_name: Normalized lowercase concept name.
        depth:        Number of hops (1 = immediate neighbors only).

    Returns:
        {nodes: [{id, name, displayName, confidence}],
         edges: [{fromConceptId, toConceptId, relationType, weight}]}
    """
    root = (
        db.query(Concept)
        .filter(Concept.tenantId == tenant_id, Concept.name == concept_name)
        .first()
    )
    if not root:
        return {"nodes": [], "edges": []}

    visited_ids = {root.id}
    frontier = {root.id}
    nodes = [{"id": root.id, "name": root.name, "displayName": root.displayName, "confidence": root.confidence}]
    edges: List[Dict[str, Any]] = []

    for _ in range(depth):
        new_frontier = set()
        rels = (
            db.query(ConceptRelation)
            .filter(
                ConceptRelation.tenantId == tenant_id,
                ConceptRelation.fromConceptId.in_(frontier),
            )
            .all()
        )
        for rel in rels:
            edges.append({
                "fromConceptId": rel.fromConceptId,
                "toConceptId": rel.toConceptId,
                "relationType": rel.relationType,
                "weight": rel.weight,
            })
            if rel.toConceptId not in visited_ids:
                visited_ids.add(rel.toConceptId)
                new_frontier.add(rel.toConceptId)

        if new_frontier:
            neighbor_nodes = (
                db.query(Concept)
                .filter(Concept.id.in_(new_frontier))
                .all()
            )
            for n in neighbor_nodes:
                nodes.append({"id": n.id, "name": n.name, "displayName": n.displayName, "confidence": n.confidence})
        frontier = new_frontier

    return {"nodes": nodes, "edges": edges}
