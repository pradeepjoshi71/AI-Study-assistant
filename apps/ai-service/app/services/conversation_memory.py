"""
Phase 2.1.5 – Conversation Memory
Session-based chat memory backed by Redis.

Storage layout (per session):
  Key: chat:memory:{session_id}
  Type: Redis List  (RPUSH to append, LRANGE to read)
  Each element: JSON-encoded message {role, content, timestamp}

  Key: chat:summary:{session_id}
  Type: Redis String
  Value: running context summary text

Context window trimming:
  MAX_MESSAGES = 40  (keep the last 40 messages per session)
  If list length exceeds MAX_MESSAGES after append, the oldest entry is popped.

TTL:
  SESSION_TTL_SECONDS = 86400  (24 hours of inactivity before Redis evicts the session)
"""

import json
import logging
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

import redis

from app.core.config import settings

logger = logging.getLogger(__name__)

MAX_MESSAGES = 40          # context window: max stored messages
SESSION_TTL_SECONDS = 86400  # 24 h


def _redis_client() -> redis.Redis:
    return redis.Redis(
        host=settings.AI_REDIS_HOST,
        port=int(settings.AI_REDIS_PORT),
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
        socket_timeout=3,
    )


def _msg_key(session_id: str) -> str:
    return f"chat:memory:{session_id}"


def _summary_key(session_id: str) -> str:
    return f"chat:summary:{session_id}"


# ── Public API ────────────────────────────────────────────────────────────────

def append_message(session_id: str, role: str, content: str) -> None:
    """
    Appends a message to the session memory list and trims to MAX_MESSAGES.

    Args:
        session_id: Unique chat session identifier.
        role:       "user" | "assistant" | "system"
        content:    Message text.
    """
    try:
        r = _redis_client()
        key = _msg_key(session_id)
        entry = json.dumps({
            "role": role,
            "content": content,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        })
        r.rpush(key, entry)
        # Trim: keep only the most recent MAX_MESSAGES entries
        r.ltrim(key, -MAX_MESSAGES, -1)
        r.expire(key, SESSION_TTL_SECONDS)
        logger.debug(f"[memory] appended {role} message to session {session_id}")
    except Exception as e:
        logger.warning(f"[memory] append_message failed (session={session_id}): {e}")


def get_history(session_id: str) -> List[Dict[str, Any]]:
    """
    Returns the full message history for the session (oldest → newest).

    Returns an empty list if the session does not exist or Redis is unavailable.
    """
    try:
        r = _redis_client()
        raw = r.lrange(_msg_key(session_id), 0, -1)
        return [json.loads(item) for item in raw]
    except Exception as e:
        logger.warning(f"[memory] get_history failed (session={session_id}): {e}")
        return []


def save_summary(session_id: str, summary: str) -> None:
    """
    Persists an LLM-generated context summary for the session.

    Args:
        session_id: Unique chat session identifier.
        summary:    Summary text produced by the memory summarizer.
    """
    try:
        r = _redis_client()
        key = _summary_key(session_id)
        r.set(key, summary, ex=SESSION_TTL_SECONDS)
        logger.debug(f"[memory] saved summary for session {session_id}")
    except Exception as e:
        logger.warning(f"[memory] save_summary failed (session={session_id}): {e}")


def get_summary(session_id: str) -> str:
    """
    Retrieves the stored context summary for the session.

    Returns an empty string if no summary exists or Redis is unavailable.
    """
    try:
        r = _redis_client()
        val = r.get(_summary_key(session_id))
        return val or ""
    except Exception as e:
        logger.warning(f"[memory] get_summary failed (session={session_id}): {e}")
        return ""


def clear_session(session_id: str) -> None:
    """Deletes all memory keys for the given session."""
    try:
        r = _redis_client()
        r.delete(_msg_key(session_id), _summary_key(session_id))
        logger.info(f"[memory] cleared session {session_id}")
    except Exception as e:
        logger.warning(f"[memory] clear_session failed (session={session_id}): {e}")


def trim_to_window(
    history: List[Dict[str, Any]],
    max_chars: int = 12_000,
) -> List[Dict[str, Any]]:
    """
    Returns the most-recent subset of history that fits within max_chars.
    Newest messages are preferred; oldest are dropped first.

    Args:
        history:   Full message list from get_history().
        max_chars: Approximate character budget for the trimmed window.

    Returns:
        Trimmed list (oldest → newest) within the character budget.
    """
    total = 0
    kept: List[Dict[str, Any]] = []
    for msg in reversed(history):
        chunk_size = len(msg.get("content", ""))
        if total + chunk_size > max_chars:
            break
        kept.append(msg)
        total += chunk_size
    return list(reversed(kept))
