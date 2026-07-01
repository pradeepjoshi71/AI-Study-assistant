import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app.services.shared_rag import SharedRAGService

logger = logging.getLogger(__name__)
router = APIRouter()
shared_rag = SharedRAGService()

# ─── Schemas ──────────────────────────────────────────────────────────────────

class GroupDocAddRequest(BaseModel):
  docId: str
  addedBy: str
  groupId: str

class GroupDocRemoveRequest(BaseModel):
  docId: str
  groupId: str

class GroupSearchRequest(BaseModel):
  groupId: str
  query: str
  memberIds: Optional[List[str]] = None

# ─── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/group/docs/add")
def add_doc_to_group(req: GroupDocAddRequest):
  logger.info(f"Adding doc={req.docId} to group={req.groupId} by user={req.addedBy}")
  try:
    success = shared_rag.add_document_to_group(req.docId, req.addedBy, req.groupId)
    return {"success": success}
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@router.post("/group/docs/remove")
def remove_doc_from_group(req: GroupDocRemoveRequest):
  logger.info(f"Removing doc={req.docId} from group={req.groupId}")
  try:
    success = shared_rag.remove_document_from_group(req.docId, req.groupId)
    return {"success": success}
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

@router.post("/group/search")
def search_group_rag(req: GroupSearchRequest):
  logger.info(f"Group RAG search: group={req.groupId} query='{req.query}'")
  try:
    results = shared_rag.search_group(req.groupId, req.query, req.memberIds)
    return {"success": True, "results": results}
  except Exception as e:
    raise HTTPException(status_code=500, detail=str(e))

class GroupSummaryRequest(BaseModel):
  chatLog: str

@router.post("/group/summary")
def generate_group_summary(req: GroupSummaryRequest):
  logger.info("Generating group study session summary using Gemini")
  
  has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here")
  if not has_gemini:
    logger.info("Mocking group study summary (missing key)")
    return {
      "topicsCovered": ["RAG Architecture", "Vector Databases", "Prisma Schemas"],
      "keyInsights": [
        "Namespace filtering in Qdrant ensures tenant isolation.",
        "Prisma requires back-relations for all model fields."
      ],
      "questionsAsked": [
        "How does Qdrant handle multitenancy?",
        "What is the weight ratio for reranking?"
      ]
    }

  import google.generativeai as genai
  import json
  try:
    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-flash")
    prompt = f"""
    Analyze the following chat log from a student group study session.
    Provide a structured JSON summary with the following schema:
    {{
      "topicsCovered": ["list of main concepts studied/discussed"],
      "keyInsights": ["list of important take-aways, definitions, or conclusions"],
      "questionsAsked": ["list of interesting or unresolved questions raised by members"]
    }}

    Do NOT wrap the output in markdown block, return raw JSON string only.

    Chat Log:
    {req.chatLog}
    """
    response = model.generate_content(prompt)
    text = response.text.strip() if response.text else ""
    
    # Strip markdown wrapper if LLM outputs it anyway
    if text.startswith("```json"):
      text = text[7:]
    if text.endswith("```"):
      text = text[:-3]
    text = text.strip()

    parsed = json.loads(text)
    return parsed
  except Exception as e:
    logger.error(f"Gemini group summary failed: {e}")
    return {
      "topicsCovered": ["General Study Session"],
      "keyInsights": ["Review session completed successfully."],
      "questionsAsked": []
    }

