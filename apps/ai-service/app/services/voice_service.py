"""
Faster-Whisper Speech-to-Text Service
=====================================
Initialises and caches the faster-whisper 'medium' model at startup.
Handles mono WAV audio normalization to 16kHz mono, transcribes with
beam_size=5, and caches outputs to Redis. Updates PostgreSQL VoiceSession
once transcription completes.
"""
from __future__ import annotations

import base64
import hashlib
import io
import logging
import os
import subprocess
import tempfile
from typing import Any, Dict, Optional, Tuple

from app.core.config import settings
from app.db.models import VoiceSession
from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Model singleton reference
_whisper_model: Any = None


def load_whisper_model() -> Any:
    """Lazy loader for faster-whisper medium model."""
    global _whisper_model
    if _whisper_model is None:
        try:
            from faster_whisper import WhisperModel
            model_size = os.getenv("WHISPER_MODEL_SIZE", "medium")
            # Enforce CPU execution default to ensure cross-platform compatibility
            device = os.getenv("WHISPER_DEVICE", "cpu")
            compute_type = os.getenv("WHISPER_COMPUTE_TYPE", "int8")

            logger.info(
                f"Loading faster-whisper model '{model_size}' (device={device}, compute={compute_type})..."
            )
            _whisper_model = WhisperModel(
                model_size,
                device=device,
                compute_type=compute_type,
            )
            logger.info("faster-whisper speech model loaded successfully.")
        except Exception as exc:
            logger.error(f"Failed to load faster-whisper speech model: {exc}")
            raise
    return _whisper_model


class VoiceService:
    """
    Speech transcription and normalization service utilizing faster-whisper.
    Cache layer caches raw audio SHA256 hashes to Redis for 24 hours.
    """

    def __init__(self):
        # Redis client reference for caching
        self._redis = None
        self._init_redis()

    def _init_redis(self):
        try:
            import redis
            self._redis = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                password=settings.REDIS_PASSWORD or None,
                decode_responses=True,
            )
        except Exception as e:
            logger.warning(f"VoiceService: Redis cache unavailable: {e}")

    # ── Speech-to-Text ────────────────────────────────────────────────────────

    def transcribe(
        self,
        audio_bytes: bytes,
        session_id: str,
        db_session: Session,
    ) -> Dict[str, Any]:
        """
        Main transcription worker method:
        - Checks transcription cache
        - Normalizes input file to 16kHz mono WAV via ffmpeg
        - Runs faster-whisper transcription
        - Writes cache and updates database status to STT
        """
        # 1. Check SHA256 audio hash cache
        audio_hash = hashlib.sha256(audio_bytes).hexdigest()
        cache_key = f"stt:sha256:{audio_hash}"

        if self._redis:
            try:
                import json
                cached = self._redis.get(cache_key)
                if cached:
                    logger.info(f"STT: cache HIT for hash={audio_hash[:12]}...")
                    res = json.loads(cached)
                    # Sync database status
                    self._update_db_status(session_id, "STT", res["text"], db_session)
                    return res
            except Exception as e:
                logger.warning(f"STT cache fetch error: {e}")

        # 2. Normalize audio to 16kHz mono WAV via ffmpeg subprocess
        normalized = self._normalize_audio(audio_bytes)
        if not normalized:
            logger.error("Audio normalization failed.")
            self._update_db_status(session_id, "FAILED", None, db_session)
            raise ValueError("Failed to process audio bytes via ffmpeg.")

        # 3. Transcribe audio using faster-whisper model
        try:
            model = load_whisper_model()
            
            # Write normalized bytes to temp file because whisper works with file paths/streams
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as tmp_wav:
                tmp_wav.write(normalized)
                tmp_wav_path = tmp_wav.name

            try:
                segments, info = model.transcribe(
                    tmp_wav_path,
                    beam_size=5,
                    language=None,  # auto language detection
                )
                
                # Consume segments generator
                segments_list = []
                full_text = ""
                for s in segments:
                    segments_list.append({
                        "start": round(s.start, 2),
                        "end": round(s.end, 2),
                        "text": s.text.strip(),
                    })
                    full_text += s.text.strip() + " "

                full_text = full_text.strip()
                result = {
                    "text": full_text,
                    "language": info.language,
                    "confidence": round(info.language_probability, 4),
                    "segments": segments_list,
                }
            finally:
                if os.path.exists(tmp_wav_path):
                    os.remove(tmp_wav_path)

        except Exception as transcribe_err:
            logger.error(f"Whisper transcription failed: {transcribe_err}")
            self._update_db_status(session_id, "FAILED", None, db_session)
            raise

        # 4. Cache output results
        if self._redis:
            try:
                self._redis.setex(
                    cache_key,
                    86400,  # 24 hour TTL
                    json.dumps(result),
                )
            except Exception as cache_err:
                logger.warning(f"STT cache write failed: {cache_err}")

        # 5. Update Postgres VoiceSession table
        self._update_db_status(session_id, "STT", result["text"], db_session)
        return result

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _normalize_audio(self, audio_bytes: bytes) -> Optional[bytes]:
        """
        Invokes ffmpeg in a subprocess to convert audio container formats
        (webm, mp3, mp4) to a standard 16kHz mono 16-bit WAV PCM.
        """
        try:
            # -y: overwrite output; -i pipe:0: read from stdin;
            # -ar 16000: 16kHz; -ac 1: 1 channel mono; -f wav: output format WAV PCM
            cmd = ["ffmpeg", "-y", "-i", "pipe:0", "-ar", "16000", "-ac", "1", "-f", "wav", "pipe:1"]
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
            )
            stdout, stderr = proc.communicate(input=audio_bytes)
            if proc.returncode != 0:
                logger.error(f"ffmpeg conversion failed: {stderr.decode('utf-8', errors='ignore')}")
                return None
            return stdout
        except Exception as exc:
            logger.error(f"ffmpeg subprocess execution failed: {exc}")
            return None

    def _update_db_status(
        self,
        session_id: str,
        status: str,
        stt_text: Optional[str],
        db_session: Session,
    ):
        """Helper to safely write transcription status back to PostgreSQL."""
        try:
            session = db_session.query(VoiceSession).filter(VoiceSession.sessionId == session_id).first()
            if session:
                session.status = status
                if stt_text is not None:
                    session.sttText = stt_text
                db_session.commit()
                logger.info(f"Database sync: VoiceSession {session_id} updated to status={status}.")
            else:
                logger.warning(f"VoiceSession {session_id} not found in database. Skipping DB update.")
        except Exception as db_err:
            logger.error(f"Failed to update VoiceSession in DB: {db_err}")
            db_session.rollback()
