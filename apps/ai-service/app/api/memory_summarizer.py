import logging
from typing import List, Dict, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

class MessageItem(BaseModel):
    role: str
    content: str

class SummarizeMemoryRequest(BaseModel):
    previousSummary: Optional[str] = ""
    newMessages: List[MessageItem]

@router.post("/memory/summarize")
async def summarize_memory(req: SummarizeMemoryRequest):
    logger.info("Memory summarizer endpoint invoked.")
    
    if not req.newMessages:
        return {"summary": req.previousSummary or ""}

    # 1. Format the new messages batch into a text transcript
    new_messages_text = "\n".join([f"{msg.role.upper()}: {msg.content}" for msg in req.newMessages])
    
    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")
    
    if not has_gemini:
        # Mock Summarization logic for testing / fallback
        logger.info("GEMINI_API_KEY is missing. Returning a mock summary update.")
        mock_summary = f"[Mock Summary] The student reviewed study concepts. Recent topics discussed: "
        # Extract keywords or snippet from new messages
        snippets = []
        for msg in req.newMessages[:3]:
            snippets.append(msg.content[:50])
        mock_summary += " | ".join(snippets)
        if req.previousSummary:
            return {"summary": f"{req.previousSummary.strip()} Also, {mock_summary.strip()}"}
        return {"summary": mock_summary}

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        
        # 2. Build the summarization prompt combining previous summary and new messages
        if req.previousSummary and req.previousSummary.strip():
            prompt = f"""You are an expert Study Assistant tasked with updating a running summary of a study session.

Existing Summary:
{req.previousSummary}

New Messages to incorporate:
{new_messages_text}

Task:
Review the new messages and integrate their key concepts, discussions, and topics into the existing summary. 
The updated summary must:
- Be concise (strictly between 2 to 4 sentences).
- Preserve the overall meaning, core concepts, and progression of the study session.
- Avoid repeating raw conversation text.
- Be cohesive and written in the third person.

Updated Summary:"""
        else:
            prompt = f"""You are an expert Study Assistant tasked with creating a summary of a study session.

New Messages to summarize:
{new_messages_text}

Task:
Summarize the key concepts, discussions, and topics discussed in these messages.
The summary must:
- Be concise (strictly between 2 to 4 sentences).
- Preserve the overall meaning and core concepts of the study session.
- Avoid repeating raw conversation text.
- Be written in the third person.

Summary:"""

        # Use gemini-1.5-flash for fast and efficient text operations
        model = genai.GenerativeModel("gemini-1.5-flash")
        
        response = model.generate_content(prompt)
        summary_text = response.text.strip() if response.text else ""
        
        logger.info("Successfully generated updated summary using Gemini.")
        return {"summary": summary_text}
        
    except Exception as e:
        logger.error(f"Gemini memory summarization failed: {e}")
        # Fallback to appending a short snippet of the messages to previous summary
        fallback_snippet = " ".join([m.content[:40] for m in req.newMessages if m.role == "user"][:2])
        fallback_summary = f"{req.previousSummary or ''} [Update: Discussed {fallback_snippet}]"
        return {"summary": fallback_summary.strip()}
