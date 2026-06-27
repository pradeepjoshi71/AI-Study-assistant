"""
Phase 2.1.7 – Study Analytics Service
Tracks user activity, quiz results, chat usage, and document engagement.
Computes: progress score, learning streak, weak topics.
All data is stored in PostgreSQL via SQLAlchemy.
"""

import uuid
import logging
from datetime import datetime, timezone, timedelta
from typing import List, Dict, Any, Optional

from sqlalchemy.orm import Session
from sqlalchemy import func

from app.db.models import (
    AnalyticsEvent,
    QuizAttempt,
    FlashcardReview,
    MasteryScore,
)

logger = logging.getLogger(__name__)

# ── Event type constants ───────────────────────────────────────────────────────
EVENT_CHAT_MESSAGE    = "chat.message"
EVENT_RAG_SEARCH      = "rag.search"
EVENT_QUIZ_ATTEMPT    = "quiz.attempt"
EVENT_FLASHCARD_REVIEW = "flashcard.review"
EVENT_DOCUMENT_OPEN   = "document.open"


# ── Activity tracking ──────────────────────────────────────────────────────────

def track_event(
    db: Session,
    user_id: str,
    event_type: str,
    tokens_in: int = 0,
    tokens_out: int = 0,
    latency_ms: int = 0,
    model: Optional[str] = None,
    tenant_id: str = "default",
) -> str:
    """
    Records a raw analytics event to the usage_metrics table.
    Returns the new event ID.
    """
    event_id = str(uuid.uuid4())
    try:
        db.add(AnalyticsEvent(
            id=event_id,
            userId=user_id,
            tenantId=tenant_id,
            endpoint=event_type,
            tokensIn=tokens_in,
            tokensOut=tokens_out,
            latencyMs=latency_ms,
            model=model,
        ))
        db.commit()
        logger.debug(f"[analytics] tracked {event_type} for user={user_id}")
    except Exception as e:
        db.rollback()
        logger.warning(f"[analytics] track_event failed: {e}")
    return event_id


def record_quiz_attempt(
    db: Session,
    user_id: str,
    quiz_id: str,
    correct: int,
    wrong: int,
    tenant_id: str = "default",
) -> str:
    """
    Persists a quiz attempt result and triggers mastery recalculation.
    Returns the attempt ID.
    """
    total = correct + wrong
    score = (correct / total * 100.0) if total > 0 else 0.0
    attempt_id = str(uuid.uuid4())
    try:
        db.add(QuizAttempt(
            id=attempt_id,
            userId=user_id,
            tenantId=tenant_id,
            quizId=quiz_id,
            score=round(score, 2),
            correctAnswers=correct,
            wrongAnswers=wrong,
        ))
        db.commit()
        logger.info(f"[analytics] quiz attempt {attempt_id}: score={score:.1f}% ({correct}/{total})")
    except Exception as e:
        db.rollback()
        logger.warning(f"[analytics] record_quiz_attempt failed: {e}")
    return attempt_id


def record_flashcard_review(
    db: Session,
    user_id: str,
    flashcard_id: str,
    recall_status: str,               # easy | hard | fail
    tenant_id: str = "default",
) -> str:
    """Persists a single flashcard review outcome."""
    review_id = str(uuid.uuid4())
    try:
        db.add(FlashcardReview(
            id=review_id,
            userId=user_id,
            tenantId=tenant_id,
            flashcardId=flashcard_id,
            recallStatus=recall_status,
        ))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[analytics] record_flashcard_review failed: {e}")
    return review_id


def upsert_mastery(
    db: Session,
    user_id: str,
    topic: str,
    score: float,
    document_id: Optional[str] = None,
    tenant_id: str = "default",
) -> None:
    """
    Inserts or updates a topic mastery score for the user.
    Uses a simple upsert: update if (userId, topic) exists, else insert.
    """
    try:
        existing = (
            db.query(MasteryScore)
            .filter(MasteryScore.userId == user_id, MasteryScore.topic == topic)
            .first()
        )
        if existing:
            existing.score = round(score, 2)
            existing.updatedAt = datetime.now(timezone.utc)
        else:
            db.add(MasteryScore(
                id=str(uuid.uuid4()),
                userId=user_id,
                tenantId=tenant_id,
                topic=topic,
                documentId=document_id,
                score=round(score, 2),
            ))
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"[analytics] upsert_mastery failed: {e}")


# ── Computed analytics ─────────────────────────────────────────────────────────

def compute_progress_score(db: Session, user_id: str) -> float:
    """
    Weighted progress score (0–100):
      40% average quiz score (last 30 attempts)
      30% flashcard recall rate (easy / total, last 100 reviews)
      30% activity consistency (events in last 7 days / 7, capped at 1.0)
    """
    # Quiz component
    attempts = (
        db.query(QuizAttempt.score)
        .filter(QuizAttempt.userId == user_id)
        .order_by(QuizAttempt.createdAt.desc())
        .limit(30)
        .all()
    )
    avg_quiz = (sum(a.score for a in attempts) / len(attempts)) if attempts else 0.0

    # Flashcard recall component
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)
    reviews = (
        db.query(FlashcardReview.recallStatus)
        .filter(FlashcardReview.userId == user_id, FlashcardReview.createdAt >= cutoff)
        .limit(100)
        .all()
    )
    if reviews:
        easy_count = sum(1 for r in reviews if r.recallStatus == "easy")
        recall_rate = easy_count / len(reviews) * 100.0
    else:
        recall_rate = 0.0

    # Activity consistency component (events in last 7 days)
    week_ago = datetime.now(timezone.utc) - timedelta(days=7)
    active_days = (
        db.query(func.count(func.distinct(func.date(AnalyticsEvent.createdAt))))
        .filter(AnalyticsEvent.userId == user_id, AnalyticsEvent.createdAt >= week_ago)
        .scalar() or 0
    )
    activity_pct = min(active_days / 7.0, 1.0) * 100.0

    progress = 0.4 * avg_quiz + 0.3 * recall_rate + 0.3 * activity_pct
    return round(progress, 2)


def compute_learning_streak(db: Session, user_id: str) -> int:
    """
    Returns the current consecutive-day learning streak.
    A day counts if the user has at least one analytics event that day.
    """
    today = datetime.now(timezone.utc).date()
    streak = 0
    check_date = today

    while True:
        start = datetime.combine(check_date, datetime.min.time()).replace(tzinfo=timezone.utc)
        end   = datetime.combine(check_date, datetime.max.time()).replace(tzinfo=timezone.utc)
        count = (
            db.query(func.count(AnalyticsEvent.id))
            .filter(
                AnalyticsEvent.userId == user_id,
                AnalyticsEvent.createdAt >= start,
                AnalyticsEvent.createdAt <= end,
            )
            .scalar() or 0
        )
        if count == 0:
            break
        streak += 1
        check_date -= timedelta(days=1)

    return streak


def get_weak_topics(db: Session, user_id: str, threshold: float = 60.0) -> List[Dict[str, Any]]:
    """
    Returns topics where the user's mastery score is below `threshold`.
    Sorted by score ascending (weakest first).
    """
    rows = (
        db.query(MasteryScore)
        .filter(MasteryScore.userId == user_id, MasteryScore.score < threshold)
        .order_by(MasteryScore.score.asc())
        .all()
    )
    return [
        {
            "topic":      r.topic,
            "score":      r.score,
            "documentId": r.documentId,
            "status":     "weak" if r.score < 40 else "medium",
        }
        for r in rows
    ]


def build_summary(db: Session, user_id: str) -> Dict[str, Any]:
    """
    Assembles the full analytics summary for a user:
    - progress_score
    - streak_days
    - weak_topics
    - chat_messages (last 30 days)
    - quiz_attempts_count + average_score
    - flashcard_reviews_count
    - document_opens_count
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=30)

    progress = compute_progress_score(db, user_id)
    streak   = compute_learning_streak(db, user_id)
    weak     = get_weak_topics(db, user_id)

    # Chat usage
    chats = (
        db.query(func.count(AnalyticsEvent.id))
        .filter(
            AnalyticsEvent.userId == user_id,
            AnalyticsEvent.endpoint == EVENT_CHAT_MESSAGE,
            AnalyticsEvent.createdAt >= cutoff,
        )
        .scalar() or 0
    )

    # Document opens
    doc_opens = (
        db.query(func.count(AnalyticsEvent.id))
        .filter(
            AnalyticsEvent.userId == user_id,
            AnalyticsEvent.endpoint == EVENT_DOCUMENT_OPEN,
            AnalyticsEvent.createdAt >= cutoff,
        )
        .scalar() or 0
    )

    # Quiz stats
    attempts = (
        db.query(QuizAttempt)
        .filter(QuizAttempt.userId == user_id, QuizAttempt.createdAt >= cutoff)
        .all()
    )
    avg_quiz = round(sum(a.score for a in attempts) / len(attempts), 2) if attempts else 0.0

    # Flashcard reviews
    fc_reviews = (
        db.query(func.count(FlashcardReview.id))
        .filter(FlashcardReview.userId == user_id, FlashcardReview.createdAt >= cutoff)
        .scalar() or 0
    )

    return {
        "userId":                user_id,
        "progressScore":         progress,
        "streakDays":            streak,
        "weakTopics":            weak,
        "chatMessages30d":       chats,
        "documentOpens30d":      doc_opens,
        "quizAttempts30d":       len(attempts),
        "averageQuizScore30d":   avg_quiz,
        "flashcardReviews30d":   fc_reviews,
    }
