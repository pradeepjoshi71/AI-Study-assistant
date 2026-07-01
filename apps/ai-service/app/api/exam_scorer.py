"""
exam_scorer.py — FastAPI router for AI-powered exam scoring.

Pipeline (POST /ai/exam/score):
  1. Fetch all AttemptAnswers + their ExamQuestions for the attempt.
  2. Score per question type:
       MCQ / TRUE_FALSE  → exact string match (case-insensitive, stripped)
       FILL              → normalize to lowercase + strip, then exact match
       SHORT             → call Gemini with {question, correctAnswer, userAnswer}
                           → returns float 0.0-1.0, multiplied by question.points
  3. Persist AttemptAnswer.isCorrect + .pointsAwarded (UPDATE).
  4. Aggregate totals:
       totalScore / maxScore
       per-topic { correct, total, scorePercent, difficultyWeight }
  5. Compute percentile vs all SUBMITTED ExamAttempts for same examId.
  6. Write ExamResult row (upsert).
  7. Update ExamAttempt.score + .percentile + .status = SUBMITTED.
  8. Dispatch 'weakness-detection' BullMQ job via Redis list push.
"""

from __future__ import annotations

import json
import logging
import uuid
from typing import Any, Dict, List, Optional, Tuple

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

# ── Gemini ────────────────────────────────────────────────────────────────────

_HAS_GEMINI = bool(
    settings.GEMINI_API_KEY
    and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    and settings.GEMINI_API_KEY.strip()
)

# ── Redis ─────────────────────────────────────────────────────────────────────

def _get_redis() -> redis_lib.Redis:
    return redis_lib.Redis(
        host=settings.AI_REDIS_HOST,
        port=int(settings.AI_REDIS_PORT),
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
    )

# ── Schemas ───────────────────────────────────────────────────────────────────

class ScoreRequest(BaseModel):
    attemptId: str

class TopicBreakdown(BaseModel):
    topicId: str
    correct: int
    total: int
    scorePercent: float
    difficultyWeight: float   # avg difficulty of questions in this topic

class ScoreResponse(BaseModel):
    attemptId: str
    totalScore: float
    maxScore: float
    percentile: float
    topicBreakdown: List[TopicBreakdown]
    weakTopics: List[str]
    timingAnalysis: Dict[str, Any]

# ── Scoring helpers ───────────────────────────────────────────────────────────

def _normalize(s: str) -> str:
    """Lowercase + strip — used for FILL match."""
    return s.lower().strip()


def _score_short_answer_mock(
    question_text: str,
    correct_answer: str,
    user_answer: str,
) -> float:
    """
    Fallback when no Gemini key: keyword-overlap heuristic.
    Returns 0.0, 0.5, or 1.0.
    """
    if not user_answer.strip():
        return 0.0
    correct_words = set(_normalize(correct_answer).split())
    user_words    = set(_normalize(user_answer).split())
    if not correct_words:
        return 0.5
    overlap = len(correct_words & user_words) / len(correct_words)
    if overlap >= 0.8:
        return 1.0
    if overlap >= 0.4:
        return 0.5
    return 0.0


def _score_short_answer_gemini(
    question_text: str,
    correct_answer: str,
    user_answer: str,
) -> float:
    """
    Call Gemini to evaluate a short-answer response.
    Returns a float in [0.0, 1.0].
    """
    import google.generativeai as genai

    genai.configure(api_key=settings.GEMINI_API_KEY)

    prompt = f"""You are an exam grader. Evaluate the student's answer against the model answer.
Return ONLY a JSON object with a single key "score" (float from 0.0 to 1.0).
  1.0 = fully correct and complete
  0.5 = partially correct or missing key detail
  0.0 = incorrect or irrelevant

Question: {question_text}
Model Answer: {correct_answer}
Student Answer: {user_answer}

Respond with: {{"score": <float>}}"""

    try:
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json"},
        )
        result = json.loads(response.text)
        raw_score = float(result.get("score", 0.0))
        return max(0.0, min(1.0, raw_score))
    except Exception as exc:
        logger.warning(f"Gemini SHORT grading failed: {exc}. Using mock fallback.")
        return _score_short_answer_mock(question_text, correct_answer, user_answer)


def _score_answer(q_type: str, correct: str, user_ans: str, q_text: str) -> float:
    """
    Returns a ratio in [0.0, 1.0] representing correctness.
    Caller multiplies by question.points to get pointsAwarded.
    """
    if q_type in ("MCQ", "TRUE_FALSE"):
        return 1.0 if correct.strip().lower() == user_ans.strip().lower() else 0.0

    if q_type == "FILL":
        return 1.0 if _normalize(correct) == _normalize(user_ans) else 0.0

    if q_type == "SHORT":
        if _HAS_GEMINI:
            return _score_short_answer_gemini(q_text, correct, user_ans)
        return _score_short_answer_mock(q_text, correct, user_ans)

    # Unknown type — fall back to exact match
    return 1.0 if correct.strip().lower() == user_ans.strip().lower() else 0.0


# ── DB helpers ────────────────────────────────────────────────────────────────

def _fetch_attempt_data(db, attempt_id: str) -> Tuple[Dict, List[Dict], List[Dict]]:
    """
    Returns (attempt_row, answer_rows, question_rows).
    Raises ValueError if attempt not found.
    """
    attempt_row = db.execute(
        text("""
            SELECT id, "examId", "userId", status, "startedAt", "submittedAt"
            FROM exam_attempts
            WHERE id = :id
        """),
        {"id": attempt_id},
    ).mappings().fetchone()

    if not attempt_row:
        raise ValueError(f"ExamAttempt not found: {attempt_id}")

    answer_rows = db.execute(
        text("""
            SELECT "attemptId", "questionId", "userAnswer",
                   "isCorrect", "timeTakenMs", "pointsAwarded"
            FROM attempt_answers
            WHERE "attemptId" = :aid
        """),
        {"aid": attempt_id},
    ).mappings().fetchall()

    if not answer_rows:
        raise ValueError(f"No AttemptAnswers found for attempt: {attempt_id}")

    q_ids = [r["questionId"] for r in answer_rows]
    placeholders = ", ".join(f":q{i}" for i in range(len(q_ids)))
    params = {f"q{i}": qid for i, qid in enumerate(q_ids)}

    question_rows = db.execute(
        text(f"""
            SELECT id, "examId", "questionText", type, "correctAnswer",
                   "topicId", difficulty, points
            FROM exam_questions
            WHERE id IN ({placeholders})
        """),
        params,
    ).mappings().fetchall()

    return dict(attempt_row), [dict(r) for r in answer_rows], [dict(r) for r in question_rows]


def _update_attempt_answers(db, scored: List[Dict]) -> None:
    """Persist isCorrect + pointsAwarded back to AttemptAnswer rows."""
    for s in scored:
        db.execute(
            text("""
                UPDATE attempt_answers
                SET "isCorrect" = :correct, "pointsAwarded" = :pts
                WHERE "attemptId" = :aid AND "questionId" = :qid
            """),
            {
                "correct": s["isCorrect"],
                "pts":     s["pointsAwarded"],
                "aid":     s["attemptId"],
                "qid":     s["questionId"],
            },
        )


def _upsert_exam_result(
    db,
    attempt_id: str,
    total_score: float,
    max_score: float,
    topic_breakdown: List[Dict],
    weak_topics: List[str],
    timing_analysis: Dict,
) -> None:
    db.execute(
        text("""
            INSERT INTO exam_results
                ("attemptId", "totalScore", "maxScore",
                 "topicBreakdown", "weakTopics", "timingAnalysis")
            VALUES
                (:aid, :ts, :ms,
                 CAST(:tb AS jsonb), CAST(:wt AS jsonb), CAST(:ta AS jsonb))
            ON CONFLICT ("attemptId") DO UPDATE
                SET "totalScore"     = EXCLUDED."totalScore",
                    "maxScore"       = EXCLUDED."maxScore",
                    "topicBreakdown" = EXCLUDED."topicBreakdown",
                    "weakTopics"     = EXCLUDED."weakTopics",
                    "timingAnalysis" = EXCLUDED."timingAnalysis"
        """),
        {
            "aid": attempt_id,
            "ts":  total_score,
            "ms":  max_score,
            "tb":  json.dumps(topic_breakdown),
            "wt":  json.dumps(weak_topics),
            "ta":  json.dumps(timing_analysis),
        },
    )


def _update_exam_attempt(
    db,
    attempt_id: str,
    score: float,
    percentile: float,
) -> None:
    db.execute(
        text("""
            UPDATE exam_attempts
            SET score = :score,
                percentile = :pct,
                status = 'SUBMITTED',
                "submittedAt" = NOW()
            WHERE id = :id
        """),
        {"score": score, "pct": percentile, "id": attempt_id},
    )


def _compute_percentile(db, attempt_id: str, exam_id: str, score: float) -> float:
    """
    Percentile = fraction of SUBMITTED attempts for the same exam that scored
    strictly below this attempt's score, expressed as 0-100.
    Includes the current attempt implicitly (ties count as equal rank).
    """
    rows = db.execute(
        text("""
            SELECT score FROM exam_attempts
            WHERE "examId" = :eid
              AND status = 'SUBMITTED'
              AND id != :aid
        """),
        {"eid": exam_id, "aid": attempt_id},
    ).scalars().fetchall()

    all_scores = list(rows) + [score]
    n = len(all_scores)
    below = sum(1 for s in all_scores if s < score)
    return round((below / n) * 100, 2)


# ── Weakness + timing analytics ───────────────────────────────────────────────

def _build_topic_breakdown(
    scored: List[Dict],
    questions: Dict[str, Dict],
) -> Tuple[List[Dict], List[str]]:
    """
    Returns (topic_breakdown_list, weak_topics_list).
    A topic is 'weak' when scorePercent < 60.
    """
    topic_stats: Dict[str, Dict] = {}

    for s in scored:
        q = questions.get(s["questionId"])
        if not q:
            continue
        tid = q.get("topicId") or "unknown"
        if tid not in topic_stats:
            topic_stats[tid] = {
                "correct": 0,
                "total": 0,
                "earnedPoints": 0.0,
                "maxPoints": 0.0,
                "difficultySum": 0.0,
            }
        st = topic_stats[tid]
        st["total"] += 1
        st["maxPoints"] += float(q["points"])
        st["difficultySum"] += float(q["difficulty"])
        if s["isCorrect"]:
            st["correct"] += 1
            st["earnedPoints"] += float(s["pointsAwarded"])

    breakdown: List[Dict] = []
    weak: List[str] = []

    for tid, st in topic_stats.items():
        score_pct = round(
            (st["earnedPoints"] / st["maxPoints"] * 100) if st["maxPoints"] > 0 else 0.0, 2
        )
        avg_diff = round(st["difficultySum"] / st["total"] if st["total"] > 0 else 0.5, 4)
        breakdown.append(
            {
                "topicId": tid,
                "correct": st["correct"],
                "total": st["total"],
                "scorePercent": score_pct,
                "difficultyWeight": avg_diff,
            }
        )
        if score_pct < 60:
            weak.append(tid)

    return breakdown, weak


def _build_timing_analysis(scored: List[Dict], questions: Dict[str, Dict]) -> Dict:
    """
    Returns aggregate timing stats: avg, min, max per-question ms,
    plus per-type averages and slow question ids.
    """
    times = [s["timeTakenMs"] for s in scored if s["timeTakenMs"] is not None]
    if not times:
        return {"avgMs": 0, "minMs": 0, "maxMs": 0, "byType": {}, "slowQuestions": []}

    by_type: Dict[str, List[int]] = {}
    slow_threshold = (sum(times) / len(times)) * 2  # 2× average = slow
    slow_questions: List[str] = []

    for s in scored:
        q = questions.get(s["questionId"])
        q_type = q["type"] if q else "UNKNOWN"
        ms = s["timeTakenMs"] or 0
        by_type.setdefault(q_type, []).append(ms)
        if ms > slow_threshold:
            slow_questions.append(s["questionId"])

    return {
        "avgMs": round(sum(times) / len(times)),
        "minMs": min(times),
        "maxMs": max(times),
        "totalMs": sum(times),
        "byType": {k: round(sum(v) / len(v)) for k, v in by_type.items()},
        "slowQuestions": slow_questions,
    }


def _call_weakness_detector(
    attempt_id: str,
    user_id: str,
    exam_id: str,
    topic_breakdown: List[Dict],
) -> None:
    """
    Call the weakness_detector endpoint in-process so the full
    classification + weighted mastery-update pipeline runs immediately.
    Imports inline to avoid circular dependency at module load.
    """
    try:
        from app.api.weakness_detector import detect_weakness, WeaknessDetectRequest, TopicBreakdownItem
        detect_weakness(
            WeaknessDetectRequest(
                attemptId=attempt_id,
                userId=user_id,
                examId=exam_id,
                topicBreakdown=[
                    TopicBreakdownItem(
                        topicId=t["topicId"],
                        scorePercent=t["scorePercent"],
                        difficultyWeight=t.get("difficultyWeight", 0.5),
                    )
                    for t in topic_breakdown
                ],
            )
        )
        logger.info(f"WeaknessDetector invoked for attempt={attempt_id}")
    except Exception as exc:
        # Non-fatal — scoring result is already committed
        logger.warning(f"WeaknessDetector call failed for attempt={attempt_id}: {exc}")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/exam/score", response_model=ScoreResponse)
def score_exam(req: ScoreRequest):
    logger.info(f"Scoring attempt: attemptId={req.attemptId}")

    db = _Session()
    try:
        # ── 1. Fetch attempt data ──────────────────────────────────────────────
        attempt, answer_rows, question_rows = _fetch_attempt_data(db, req.attemptId)

        exam_id = attempt["examId"]
        q_map: Dict[str, Dict] = {q["id"]: q for q in question_rows}

        # ── 2. Score each answer ──────────────────────────────────────────────
        scored: List[Dict] = []
        for ans in answer_rows:
            qid = ans["questionId"]
            q = q_map.get(qid)
            if not q:
                logger.warning(f"Question {qid} not found — skipping")
                continue

            ratio = _score_answer(
                q_type=q["type"],
                correct=q["correctAnswer"],
                user_ans=ans["userAnswer"],
                q_text=q["questionText"],
            )
            points_awarded = round(ratio * float(q["points"]), 4)
            is_correct = ratio >= 1.0  # strict: only full marks = correct

            scored.append(
                {
                    "attemptId":    ans["attemptId"],
                    "questionId":   qid,
                    "isCorrect":    is_correct,
                    "pointsAwarded": points_awarded,
                    "timeTakenMs":  ans["timeTakenMs"],
                    "ratio":        ratio,
                }
            )

        # ── 3. Persist scored answers ─────────────────────────────────────────
        _update_attempt_answers(db, scored)

        # ── 4. Aggregate totals ───────────────────────────────────────────────
        total_score = round(sum(s["pointsAwarded"] for s in scored), 4)
        max_score   = round(sum(float(q["points"]) for q in question_rows), 4)

        # ── 5. Topic breakdown + weak topics ─────────────────────────────────
        topic_breakdown, weak_topics = _build_topic_breakdown(scored, q_map)

        # ── 6. Timing analysis ────────────────────────────────────────────────
        timing_analysis = _build_timing_analysis(scored, q_map)

        # ── 7. Compute percentile ─────────────────────────────────────────────
        score_pct = round((total_score / max_score * 100) if max_score > 0 else 0.0, 2)
        percentile = _compute_percentile(db, req.attemptId, exam_id, score_pct)

        # ── 8. Upsert ExamResult ──────────────────────────────────────────────
        _upsert_exam_result(
            db,
            attempt_id=req.attemptId,
            total_score=total_score,
            max_score=max_score,
            topic_breakdown=topic_breakdown,
            weak_topics=weak_topics,
            timing_analysis=timing_analysis,
        )

        # ── 9. Update ExamAttempt status → SUBMITTED ──────────────────────────
        _update_exam_attempt(db, req.attemptId, score_pct, percentile)

        db.commit()

        logger.info(
            f"Scoring complete: attempt={req.attemptId} "
            f"score={total_score}/{max_score} ({score_pct}%) "
            f"percentile={percentile} weakTopics={weak_topics}"
        )

    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=404, detail=str(exc))
    except Exception as exc:
        db.rollback()
        logger.error(f"Scoring failed for attempt={req.attemptId}: {exc}")
        raise HTTPException(status_code=500, detail=f"Scoring failed: {exc}")
    finally:
        db.close()

    # ── 10. Invoke WeaknessDetector pipeline (outside DB tx) ──────────────────
    # Passes full topicBreakdown so detector can classify + dispatch mastery update.
    user_id = attempt.get("userId", "unknown")
    _call_weakness_detector(req.attemptId, user_id, exam_id, topic_breakdown)

    return ScoreResponse(
        attemptId=req.attemptId,
        totalScore=total_score,
        maxScore=max_score,
        percentile=percentile,
        topicBreakdown=[TopicBreakdown(**t) for t in topic_breakdown],
        weakTopics=weak_topics,
        timingAnalysis=timing_analysis,
    )
