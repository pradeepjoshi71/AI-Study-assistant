"""
Voice Speech Services API Endpoint
==================================
Exposes STT and voice status handling.
"""
import logging
from fastapi import APIRouter, Depends, File, Form, UploadFile, HTTPException
from sqlalchemy.orm import Session
from typing import Dict, Any

from app.db.models import VoiceSession
from sqlalchemy.orm import Session
from app.services.voice_service import VoiceService

logger = logging.getLogger(__name__)
router = APIRouter()

voice_service = VoiceService()

def get_db():
    from app.main import SessionLocal
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

@router.post("/voice/stt")
async def speech_to_text_endpoint(
    sessionId: str = Form(...),
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    """
    Transcribes audio files to text.
    Steps:
      - Reads upload audio file bytes
      - Delegates to VoiceService for ffmpeg audio normalization
      - Calls faster-whisper transcribing text context
      - Updates database VoiceSession sttText and status fields
    """
    logger.info(f"Received speech-to-text request for sessionId: {sessionId}")
    try:
        audio_bytes = await file.read()
        if not audio_bytes:
            raise HTTPException(status_code=400, detail="Empty audio file uploaded.")

        result = voice_service.transcribe(
            audio_bytes=audio_bytes,
            session_id=sessionId,
            db_session=db,
        )

        return {
            "success": True,
            "sessionId": sessionId,
            "text": result.get("text", ""),
            "language": result.get("language", "auto"),
            "confidence": result.get("confidence", 0.0),
            "segments": result.get("segments", []),
        }

    except ValueError as val_err:
        logger.error(f"STT normalization error: {val_err}")
        raise HTTPException(status_code=400, detail=str(val_err))
    except Exception as exc:
        logger.error(f"Speech transcription request failed: {exc}")
        raise HTTPException(
            status_code=500,
            detail=f"Whisper transcription failed: {str(exc)}",
        )
