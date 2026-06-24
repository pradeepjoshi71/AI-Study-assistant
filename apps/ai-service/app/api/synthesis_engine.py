import logging
from typing import List, Dict, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

class ChunkItem(BaseModel):
    chunkId: str
    text: str
    score: float
    documentId: str
    pageNumber: int
    documentTitle: str

class SynthesizeRequest(BaseModel):
    query: str
    groupedChunks: Dict[str, List[ChunkItem]]

class SynthesisAnalysis(BaseModel):
    synthesizedContext: str
    conflicts: str

@router.post("/synthesis/synthesize", response_model=SynthesisAnalysis)
async def synthesize_documents(req: SynthesizeRequest):
    logger.info("Multi-document synthesis engine invoked.")
    
    if not req.groupedChunks:
        return SynthesisAnalysis(synthesizedContext="", conflicts="")

    # 1. Format the source documents and chunks into a readable text representation for the LLM
    formatted_docs = []
    for doc_id, chunks in req.groupedChunks.items():
        if not chunks:
            continue
        doc_title = chunks[0].documentTitle
        formatted_chunks = []
        for c in chunks:
            formatted_chunks.append(f"  - [{c.chunkId}] (Page {c.pageNumber}): {c.text}")
        formatted_docs.append(f"Document: {doc_title} (ID: {doc_id})\n" + "\n".join(formatted_chunks))
    
    sources_text = "\n\n".join(formatted_docs)

    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")

    if not has_gemini:
        # Mock Synthesis logic for testing / fallback mode
        logger.info("GEMINI_API_KEY is missing. Running in Mock Synthesis Mode.")
        
        # Merge all chunks into synthesized context
        merged_parts = []
        for doc_id, chunks in req.groupedChunks.items():
            for c in chunks:
                merged_parts.append(f"[Mock Synthesized] {c.text} (from {c.documentTitle} [chunk_{c.chunkId}])")
        
        mock_context = "\n\n".join(merged_parts)
        
        # Check if we have multiple documents to mock a contradiction comparison
        doc_titles = [chunks[0].documentTitle for chunks in req.groupedChunks.values() if chunks]
        mock_conflicts = "None"
        if len(doc_titles) >= 2:
            mock_conflicts = (
                f"[Mock Conflict Warning]: Document '{doc_titles[0]}' and Document '{doc_titles[1]}' "
                f"contain slight variations in explanations regarding: '{req.query}'."
            )

        return SynthesisAnalysis(
            synthesizedContext=mock_context,
            conflicts=mock_conflicts
        )

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)

        # 2. Compile prompt for Gemini
        prompt = f"""You are an advanced AI Synthesis Engine for a study assistant. Your job is to process retrieved document excerpts, consolidate them into a clean synthesized explanation, and identify any contradictions, conflicts, or variations in facts (such as different statistics, contradictory definitions, or conflicting instructions) across different source documents.

User Query: {req.query}

Source Documents and Excerpts:
{sources_text}

Task:
1. Synthesize the context: Merge the facts and details from the excerpts into a cohesive, non-redundant reference context (stored in 'synthesizedContext'). Ensure every merged claim includes its chunk ID source citation (e.g. "[chunk_123]").
2. Detect contradictions: Compare statements across different documents. If Document A says X and Document B says Y (which conflicts or shows variations), explain this discrepancy clearly (stored in 'conflicts'). If there are no contradictions or conflicting information, set 'conflicts' to "None".

You must output a JSON object matching the requested schema.
"""

        # Use gemini-1.5-flash for structured JSON response
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": SynthesisAnalysis
            }
        )

        # The SDK automatically handles structured parsing, so response.text is valid JSON
        import json
        result_data = json.loads(response.text)
        
        logger.info("Successfully completed multi-document synthesis via Gemini.")
        return SynthesisAnalysis(
            synthesizedContext=result_data.get("synthesizedContext", ""),
            conflicts=result_data.get("conflicts", "None")
        )

    except Exception as e:
        logger.error(f"Gemini multi-document synthesis failed: {e}")
        # Return fallback flat context
        flat_parts = []
        for doc_id, chunks in req.groupedChunks.items():
            for c in chunks:
                flat_parts.append(f"[{c.chunkId}] ({c.documentTitle}): {c.text}")
        fallback_context = "\n\n".join(flat_parts)
        
        return SynthesisAnalysis(
            synthesizedContext=fallback_context,
            conflicts="None"
        )
