"""
weakness_detector.py — FastAPI router for topic weakness classification.

Pipeline (POST /ai/exam/weakness):
  1. Receive ExamResult.topicBreakdown (list of {topicId, scorePercent, difficultyWeight}).
  2. Classify each topic:
       < 40%   → CRITICAL   (recommendedAction: IMMEDIATE_REVIEW)
       40-70%  → REVIEW     (recommendedAction: SCHEDULED_PRACTICE)
       > 70%   → MASTERED   (recommendedAction: MAINTAIN)
  3. Return weakTopics[] = [{topicId, score, classification, recommendedAction}].
  4. Update ExamResult.weakTopics in PostgreSQL (only CRITICAL + REVIEW topic IDs).
  5. Dispatch BullMQ 'exam-mastery-update' job → NestJS processor will:
       - Apply weighted mastery update: 0.4 × examScore + 0.6 × ongoingEMA
       - Trigger AdaptiveEngine recommendations per weak topic.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Dict, List, Literal, Optional

import redis as redis_lib
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# ── DB session ────────────────────────────────────────────────────────────────

_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

# ── Redis ─────────────────────────────────────────────────────────────────────

def _get_redis() -> redis_lib.Redis:
    return redis_lib.Redis(
        host=settings.AI_REDIS_HOST,
        port=int(settings.AI_REDIS_PORT),
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
    )

# ── Classification thresholds ─────────────────────────────────────────────────

CRITICAL_THRESHOLD = 40.0   # below → CRITICAL
MASTERED_THRESHOLD = 70.0   # above → MASTERED
# between → REVIEW

ClassificationLabel = Literal["CRITICAL", "REVIEW", "MASTERED"]
RecommendedAction   = Literal["IMMEDIATE_REVIEW", "SCHEDULED_PRACTICE", "MAINTAIN"]

CLASSIFICATION_MAP: Dict[ClassificationLabel, RecommendedAction] = {
    "CRITICAL": "IMMEDIATE_REVIEW",
    "REVIEW":   "SCHEDULED_PRACTICE",
    "MASTERED": "MAINTAIN",
}

# ── Schemas ───────────────────────────────────────────────────────────────────

class TopicBreakdownItem(BaseModel):
    topicId: str
    scorePercent: float
    difficultyWeight: float = 0.5

class WeaknessDetectRequest(BaseModel):
    attemptId: str
    userId: str
    examId: str
    topicBreakdown: List[TopicBreakdownItem]

class WeakTopicResult(BaseModel):
    topicId: str
    score: float                        # scorePercent 0-100
    classification: ClassificationLabel
    recommendedAction: RecommendedAction

class WeaknessDetectResponse(BaseModel):
    attemptId: str
    weakTopics: List[WeakTopicResult]   # only CRITICAL + REVIEW
    allTopics: List[WeakTopicResult]    # full classification for every topic

# ── Classify ──────────────────────────────────────────────────────────────────

def _classify(score_pct: float) -> ClassificationLabel:
    if score_pct < CRITICAL_THRESHOLD:
        return "CRITICAL"
    if score_pct <= MASTERED_THRESHOLD:
        return "REVIEW"
    return "MASTERED"

# ── DB helpers ────────────────────────────────────────────────────────────────

def _update_exam_result_weak_topics(
    db,
    attempt_id: str,
    weak_topic_ids: List[str],
) -> None:
    """Overwrite ExamResult.weakTopics with the freshly classified IDs."""
    db.execute(
        text("""
            UPDATE exam_results
            SET "weakTopics" = CAST(:ids AS jsonb)
            WHERE "attemptId" = :aid
        """),
        {"ids": json.dumps(weak_topic_ids), "aid": attempt_id},
    )

# ── BullMQ dispatch ───────────────────────────────────────────────────────────

def _dispatch_mastery_update_job(
    attempt_id: str,
    user_id: str,
    exam_id: str,
    classified_topics: List[WeakTopicResult],
) -> None:
    """
    Push an 'exam-mastery-update' job onto the NestJS BullMQ queue.

    The NestJS WeaknessDetectionProcessor will:
      - Apply weighted mastery: 0.4 × examScore + 0.6 × ongoingEMA
      - Call AdaptiveEngine for each CRITICAL/REVIEW topic.

    Payload includes every classified topic so the processor can
    distinguish CRITICAL vs REVIEW vs MASTERED handling.
    """
    try:
        r = _get_redis()
        job_payload = json.dumps(
            {
                "name": "exam-mastery-update",
                "data": {
                    "attemptId": attempt_id,
                    "userId":    user_id,
                    "examId":    exam_id,
                    "classifiedTopics": [
                        {
                            "topicId":           t.topicId,
                            "score":             t.score,
                            "classification":    t.classification,
                            "recommendedAction": t.recommendedAction,
                        }
                        for t in classified_topics
                    ],
                },
                "opts": {"attempts": 3, "backoff": {"type": "exponential", "delay": 3000}},
            }
        )
        # BullMQ reads from bull:<queue>:wait
        r.lpush("bull:weakness-detection:wait", job_payload)
        logger.info(
            f"Dispatched exam-mastery-update job: attempt={attempt_id} "
            f"topics={len(classified_topics)}"
        )
    except Exception as exc:
        logger.warning(f"Failed to dispatch exam-mastery-update job: {exc}")

# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/exam/weakness", response_model=WeaknessDetectResponse)
def detect_weakness(req: WeaknessDetectRequest):
    logger.info(
        f"Weakness detection: attempt={req.attemptId} "
        f"topics={len(req.topicBreakdown)}"
    )

    if not req.topicBreakdown:
        return WeaknessDetectResponse(
            attemptId=req.attemptId,
            weakTopics=[],
            allTopics=[],
        )

    # ── 1. Classify every topic ────────────────────────────────────────────────
    all_topics: List[WeakTopicResult] = []
    weak_topics: List[WeakTopicResult] = []

    for item in req.topicBreakdown:
        label = _classify(item.scorePercent)
        action = CLASSIFICATION_MAP[label]
        result = WeakTopicResult(
            topicId=item.topicId,
            score=round(item.scorePercent, 2),
            classification=label,
            recommendedAction=action,
        )
        all_topics.append(result)
        if label in ("CRITICAL", "REVIEW"):
            weak_topics.append(result)

    weak_topic_ids = [t.topicId for t in weak_topics]

    logger.info(
        f"Classification complete: CRITICAL={sum(1 for t in all_topics if t.classification=='CRITICAL')} "
        f"REVIEW={sum(1 for t in all_topics if t.classification=='REVIEW')} "
        f"MASTERED={sum(1 for t in all_topics if t.classification=='MASTERED')}"
    )

    # ── 2. Update ExamResult.weakTopics in DB ──────────────────────────────────
    db = _Session()
    try:
        _update_exam_result_weak_topics(db, req.attemptId, weak_topic_ids)
        db.commit()
        logger.info(f"Updated ExamResult.weakTopics for attempt={req.attemptId}")
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to update ExamResult.weakTopics: {exc}")
        # Non-fatal — continue to dispatch job
    finally:
        db.close()

    # ── 3. Dispatch BullMQ mastery-update job ──────────────────────────────────
    _dispatch_mastery_update_job(
        attempt_id=req.attemptId,
        user_id=req.userId,
        exam_id=req.examId,
        classified_topics=all_topics,   # pass all so processor can weight MASTERED boost too
    )

    return WeaknessDetectResponse(
        attemptId=req.attemptId,
        weakTopics=weak_topics,
        allTopics=all_topics,
    )
