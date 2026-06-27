from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import List, Dict, Any, Optional
from app.core.config import settings
from app.core.stream_handler import StreamHandler
from app.services.prompt_builder import build_system_prompt, build_user_message
from app.services.conversation_memory import (
    append_message, get_history, get_summary, save_summary, trim_to_window
)

router = APIRouter()
stream_handler = StreamHandler(settings.GEMINI_API_KEY)

class StreamRequest(BaseModel):
    systemPrompt: str
    message: str
    sessionId: Optional[str] = None        # Phase 2.1.5: session memory key
    history: List[Dict[str, Any]] = []     # caller-supplied fallback history
    citations: List[Dict[str, Any]] = []
    # RAG context fields populated by the caller after retrieval
    context: str = ""
    sources: List[Dict[str, Any]] = []
    pages: List[int] = []
    chunks: List[Dict[str, Any]] = []
    tools: Optional[List[Dict[str, Any]]] = None

@router.post("/chat/stream")
async def chat_stream_endpoint(req: StreamRequest):
    session_id = req.sessionId

    # ── Phase 2.1.5: load Redis session memory ──────────────────────────────
    if session_id:
        stored = get_history(session_id)
        # Merge stored history on top of caller-supplied history
        merged_history = stored if stored else req.history
        # Trim to 12 000-char context window before sending to LLM
        history_window = trim_to_window(merged_history, max_chars=12_000)
        summary = get_summary(session_id)
    else:
        history_window = req.history
        summary = ""

    # Build structured system prompt via Prompt Engine (Phase 2.1.2)
    system_prompt = build_system_prompt(
        context=req.context,
        sources=req.sources,
        pages=req.pages,
        chunks=req.chunks,
    ) if req.context else req.systemPrompt

    # Prepend running summary as a SYSTEM turn so the LLM has long-term context
    if summary:
        history_window = [{"role": "system", "content": f"[Session Summary] {summary}"}] + history_window

    user_message = build_user_message(query=req.message, pages=req.pages)

    # ── Persist the user turn before streaming ───────────────────────────────
    if session_id:
        append_message(session_id, "user", req.message)

    async def _stream_and_persist():
        """Wraps stream_rag to collect the assistant reply and persist it."""
        collected_tokens: List[str] = []
        async for event in stream_handler.stream_rag(
            system_prompt=system_prompt,
            message=user_message,
            history=history_window,
            citations=req.citations,
            tools=req.tools,
        ):
            # Collect token events to reconstruct the assistant reply
            if session_id and event.startswith("event: token"):
                # Extract data portion: "event: token\ndata: <text>\n\n"
                try:
                    data_line = event.split("\ndata: ", 1)[1].rstrip()
                    collected_tokens.append(data_line)
                except IndexError:
                    pass
            yield event

        # ── Persist assistant reply after stream completes ────────────────────
        if session_id and collected_tokens:
            assistant_reply = "".join(collected_tokens)
            append_message(session_id, "assistant", assistant_reply)

    return StreamingResponse(
        _stream_and_persist(),
        media_type="text/event-stream"
    )
