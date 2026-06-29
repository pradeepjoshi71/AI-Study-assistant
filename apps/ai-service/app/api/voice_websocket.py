"""
Speech-to-Text WebSocket Gateway
================================
FastAPI WebSocket mount accepting connections on /ai/voice/ws, subscribing users,
and streaming TTS chunks base64 blocks via WebSocket voice:audio_chunk events.
"""
import json
import logging
from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.services.tts_service import TTSService

logger = logging.getLogger(__name__)
router = APIRouter()

tts_service = TTSService()

@router.websocket("/voice/ws")
async def voice_websocket_endpoint(websocket: WebSocket):
    """
    Accepts WebSocket connections.
    Listens for client triggers:
      - voice:tts {text, planTier, sessionId, orgId}
    Emits events:
      - voice:audio_chunk {seq, base64}
      - voice:done {sessionId, isTruncated}
      - voice:error {code, message}
    """
    await websocket.accept()
    logger.info("Voice WebSocket connection established.")

    try:
        while True:
            # Load incoming payload messages
            data = await websocket.receive_text()
            try:
                payload = json.loads(data)
                event = payload.get("event")
                msg_data = payload.get("data", {})

                if event == "voice:tts":
                    text = msg_data.get("text", "")
                    plan_tier = msg_data.get("planTier", "FREE")
                    session_id = msg_data.get("sessionId", "")
                    org_id = msg_data.get("orgId")

                    if not text or not session_id:
                        await websocket.send_text(json.dumps({
                            "event": "voice:error",
                            "data": {"code": "INVALID_PARAMS", "message": "Missing text or sessionId."}
                        }))
                        continue

                    # Define callback to stream base64 audio chunks back directly
                    def emit_chunk(seq: int, b64_str: str):
                        import asyncio
                        # WebSocket write operations must be run in the loop thread context safely.
                        # Since emit_chunk is called synchronously by tts_service,
                        # schedule send_text inside the active running loop.
                        coro = websocket.send_text(json.dumps({
                            "event": "voice:audio_chunk",
                            "data": {
                                "sessionId": session_id,
                                "seq": seq,
                                "base64": b64_str
                            }
                        }))
                        asyncio.run_coroutine_threadsafe(coro, asyncio.get_event_loop())

                    # Invoke synthesis
                    result = await tts_service.synthesize(
                        text=text,
                        plan_tier=plan_tier,
                        session_id=session_id,
                        org_id=org_id,
                        on_chunk_generated=emit_chunk
                    )

                    # Emit done status event
                    await websocket.send_text(json.dumps({
                        "event": "voice:done",
                        "data": {
                            "sessionId": session_id,
                            "isTruncated": result.get("isTruncated", False),
                            "destinationKey": result.get("destinationKey", "")
                        }
                    }))

            except json.JSONDecodeError:
                await websocket.send_text(json.dumps({
                    "event": "voice:error",
                    "data": {"code": "JSON_PARSE_ERROR", "message": "Invalid JSON format."}
                }))
            except Exception as service_err:
                logger.error(f"WebSocket synthesis task processing failed: {service_err}")
                await websocket.send_text(json.dumps({
                    "event": "voice:error",
                    "data": {"code": "SYNTHESIS_FAILED", "message": str(service_err)}
                }))

    except WebSocketDisconnect:
        logger.info("Voice WebSocket connection disconnected by client.")
    except Exception as ws_err:
        logger.warning(f"Voice WebSocket closed with error: {ws_err}")
