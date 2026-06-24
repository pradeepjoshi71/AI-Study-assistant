import logging
import re
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()


# ─────────────────────────────────────────────
# Input / Output Schemas
# ─────────────────────────────────────────────

class ChunkInput(BaseModel):
    id: str
    content: str


class GraphExtractRequest(BaseModel):
    tenantId: str
    chunks: List[ChunkInput]


class ExtractedConcept(BaseModel):
    name: str          # normalized lowercase
    displayName: str   # original casing
    confidence: float = 1.0


class ExtractedRelation(BaseModel):
    fromConcept: str   # normalized name of source concept
    toConcept: str     # normalized name of target concept
    relationType: str  # EXPLAINS | RELATED_TO | PREREQUISITE_OF | PART_OF
    weight: float = 1.0


class ChunkExtractionResult(BaseModel):
    chunkId: str
    concepts: List[ExtractedConcept]
    relations: List[ExtractedRelation]


class GraphExtractResponse(BaseModel):
    results: List[ChunkExtractionResult]


# ── Explain endpoint ──

class GraphExplainRequest(BaseModel):
    concept: str
    relatedConcepts: List[str] = []
    tenantId: str


class GraphExplainResponse(BaseModel):
    explanation: str


# ─────────────────────────────────────────────
# Gemini structured output schemas (inner)
# ─────────────────────────────────────────────

class _GeminiConceptItem(BaseModel):
    name: str
    displayName: str
    confidence: float


class _GeminiRelationItem(BaseModel):
    fromConcept: str
    toConcept: str
    relationType: str
    weight: float


class _GeminiChunkResult(BaseModel):
    concepts: List[_GeminiConceptItem]
    relations: List[_GeminiRelationItem]


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _regex_fallback_extract(chunk_id: str, content: str) -> ChunkExtractionResult:
    """
    Lightweight regex-based concept extraction for environments without a Gemini key.
    Extracts capitalized multi-word phrases as concepts. No relation extraction.
    """
    capitalized = re.findall(r'\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)\b', content)
    seen: set = set()
    concepts: List[ExtractedConcept] = []
    for phrase in capitalized:
        norm = phrase.lower().strip()
        if norm and norm not in seen and len(norm) > 3:
            seen.add(norm)
            concepts.append(ExtractedConcept(
                name=norm,
                displayName=phrase.strip(),
                confidence=0.6,
            ))
            if len(concepts) >= 8:
                break
    return ChunkExtractionResult(chunkId=chunk_id, concepts=concepts, relations=[])


def _normalize(text: str) -> str:
    return text.strip().lower()


# ─────────────────────────────────────────────
# Endpoints
# ─────────────────────────────────────────────

@router.post("/graph/extract", response_model=GraphExtractResponse)
async def extract_concepts(req: GraphExtractRequest):
    """
    Extracts concepts and typed relationships from a batch of document chunks.
    Uses Gemini structured output; falls back to regex extraction if no API key.
    """
    logger.info(
        f"Graph extraction requested for tenant={req.tenantId} "
        f"with {len(req.chunks)} chunks."
    )

    has_gemini = bool(
        settings.GEMINI_API_KEY
        and settings.GEMINI_API_KEY.strip()
        and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    )

    results: List[ChunkExtractionResult] = []

    for chunk in req.chunks:
        if not has_gemini:
            results.append(_regex_fallback_extract(chunk.id, chunk.content))
            continue

        try:
            genai.configure(api_key=settings.GEMINI_API_KEY)
            model = genai.GenerativeModel("gemini-1.5-flash")

            prompt = f"""You are an expert educational knowledge graph builder.
Analyze the following educational text and extract:
1. Key educational concepts (nouns, named processes, theories, laws, formulas)
2. Typed relationships between those concepts

RULES:
- Normalize concept names to lowercase (store in 'name')
- Preserve original casing in 'displayName'
- Maximum 8 concepts per chunk
- Exclude stop-word-only phrases (e.g. "the fact", "this means")
- Confidence score: 1.0 = certain, 0.5 = inferred
- Relationship types allowed: EXPLAINS, RELATED_TO, PREREQUISITE_OF, PART_OF
- Weight: 1.0 = strong, 0.5 = weak
- Only include relations between concepts you extracted above
- Do NOT hallucinate concepts not present in the text

TEXT:
\"\"\"
{chunk.content[:2000]}
\"\"\"

Respond with JSON only: {{ "concepts": [...], "relations": [...] }}
"""

            import json
            response = model.generate_content(
                prompt,
                generation_config={
                    "response_mime_type": "application/json",
                    "response_schema": _GeminiChunkResult,
                },
            )

            raw = json.loads(response.text)

            concepts = [
                ExtractedConcept(
                    name=_normalize(c.get("name", "")),
                    displayName=c.get("displayName", c.get("name", "")).strip(),
                    confidence=float(c.get("confidence", 1.0)),
                )
                for c in raw.get("concepts", [])
                if c.get("name", "").strip()
            ]

            relations = [
                ExtractedRelation(
                    fromConcept=_normalize(r.get("fromConcept", "")),
                    toConcept=_normalize(r.get("toConcept", "")),
                    relationType=r.get("relationType", "RELATED_TO"),
                    weight=float(r.get("weight", 1.0)),
                )
                for r in raw.get("relations", [])
                if r.get("fromConcept") and r.get("toConcept")
            ]

            results.append(ChunkExtractionResult(
                chunkId=chunk.id,
                concepts=concepts,
                relations=relations,
            ))

        except Exception as e:
            logger.warning(
                f"Gemini extraction failed for chunk {chunk.id}: {e}. "
                f"Falling back to regex extraction."
            )
            results.append(_regex_fallback_extract(chunk.id, chunk.content))

    total_concepts = sum(len(r.concepts) for r in results)
    logger.info(
        f"Graph extraction complete for tenant={req.tenantId}: "
        f"{total_concepts} concepts extracted across {len(results)} chunks."
    )
    return GraphExtractResponse(results=results)


@router.post("/graph/explain", response_model=GraphExplainResponse)
async def explain_concept(req: GraphExplainRequest):
    """
    Generates a pedagogical AI explanation of a concept and its cluster.
    """
    logger.info(f"Explain concept requested: '{req.concept}' (tenant={req.tenantId})")

    has_gemini = bool(
        settings.GEMINI_API_KEY
        and settings.GEMINI_API_KEY.strip()
        and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    )

    if not has_gemini:
        related_str = ", ".join(req.relatedConcepts) if req.relatedConcepts else "none identified"
        return GraphExplainResponse(
            explanation=(
                f"'{req.concept.title()}' is a core concept in this subject area. "
                f"Related concepts include: {related_str}. "
                f"Study these together to build a comprehensive understanding."
            )
        )

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-1.5-flash")

        related_str = ", ".join(req.relatedConcepts) if req.relatedConcepts else "none identified"
        prompt = (
            f"You are an expert AI tutor. Explain the concept '{req.concept}' in 2-3 clear, "
            f"student-friendly sentences. Also briefly mention how it connects to these related "
            f"concepts: {related_str}. Be educational, concise, and avoid jargon where possible. "
            f"Write in plain prose without bullet points."
        )

        response = model.generate_content(prompt)
        return GraphExplainResponse(explanation=response.text.strip())

    except Exception as e:
        logger.error(f"Gemini concept explanation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Concept explanation failed: {str(e)}")
