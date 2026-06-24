from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.core.config import settings
from app.core.stream_handler import StreamHandler

router = APIRouter()
stream_handler = StreamHandler(settings.GEMINI_API_KEY)

class StreamRequest(BaseModel):
    systemPrompt: str
    message: str
    history: List[Dict[str, Any]] = []
    citations: List[Dict[str, Any]] = []
    tools: Optional[List[Dict[str, Any]]] = None

@router.post("/chat/stream")
async def chat_stream_endpoint(req: StreamRequest):
    return StreamingResponse(
        stream_handler.stream_rag(
            system_prompt=req.systemPrompt,
            message=req.message,
            history=req.history,
            citations=req.citations,
            tools=req.tools
        ),
        media_type="text/event-stream"
    )
