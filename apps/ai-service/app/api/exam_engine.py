"""
exam_engine.py — FastAPI router for AI-powered exam generation.

Pipeline per exam:
  1. For each topicId → RAG fetch top-10 chunks from Qdrant.
  2. Build question batch per (type, difficulty-bucket) using Gemini.
  3. Deduplicate: embed each question text and drop cosine-similarity > 0.95.
  4. Persist ExamQuestion rows to PostgreSQL.
  5. Update Exam.status = READY.
  6. Cache full question list in Redis (TTL 24 h) keyed by examId.
"""

from __future__ import annotations

import json
import logging
import math
import uuid
from typing import Any, Dict, List, Optional, Tuple

import redis as redis_lib
import numpy as np
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings
from app.services.vector_search import VectorSearchService

logger = logging.getLogger(__name__)
router = APIRouter()

# ── DB session ────────────────────────────────────────────────────────────────

_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

# ── Redis client ──────────────────────────────────────────────────────────────

def _get_redis() -> redis_lib.Redis:
    return redis_lib.Redis(
        host=settings.AI_REDIS_HOST,
        port=int(settings.AI_REDIS_PORT),
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
    )

# ── Gemini ────────────────────────────────────────────────────────────────────

_HAS_GEMINI = bool(
    settings.GEMINI_API_KEY
    and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    and settings.GEMINI_API_KEY.strip()
)

# ── Schemas ───────────────────────────────────────────────────────────────────

class DifficultyMix(BaseModel):
    easy: float    # 0-100 percentage
    medium: float
    hard: float

class ExamGenerateRequest(BaseModel):
    examId: str
    orgId: str
    createdBy: str
    docIds: List[str]
    topicIds: List[str]
    totalQuestions: int
    durationMinutes: int
    difficultyMix: DifficultyMix
    questionTypes: List[str]   # MCQ | TRUE_FALSE | SHORT | FILL
    type: str                  # PRACTICE | MOCK | TIMED

class ExamGenerateResponse(BaseModel):
    examId: str
    questionCount: int
    status: str

# ── Helpers ───────────────────────────────────────────────────────────────────

_vector_search = VectorSearchService()

def _cosine(a: List[float], b: List[float]) -> float:
    """Pure-python cosine similarity — used only for deduplication."""
    va, vb = np.array(a, dtype=np.float32), np.array(b, dtype=np.float32)
    norm_a, norm_b = np.linalg.norm(va), np.linalg.norm(vb)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(va, vb) / (norm_a * norm_b))


def _difficulty_float(bucket: str) -> float:
    return {"easy": 0.25, "medium": 0.5, "hard": 1.0}.get(bucket, 0.5)


def _build_question_plan(
    total: int,
    mix: DifficultyMix,
    types: List[str],
) -> List[Tuple[str, str]]:
    """Returns list of (questionType, difficultyBucket) pairs."""
    counts = {
        "easy":   round(total * mix.easy   / 100),
        "medium": round(total * mix.medium / 100),
        "hard":   round(total * mix.hard   / 100),
    }
    # Fix rounding drift
    delta = total - sum(counts.values())
    counts["medium"] += delta

    plan: List[Tuple[str, str]] = []
    type_cycle = types * math.ceil(total / max(len(types), 1))
    idx = 0
    for bucket, n in counts.items():
        for _ in range(n):
            plan.append((type_cycle[idx % len(type_cycle)], bucket))
            idx += 1
    return plan


def _fetch_chunks_for_topic(topic_id: str, org_id: str, limit: int = 10) -> List[Dict]:
    """RAG retrieval: top-`limit` chunks for a topic name via vector search."""
    try:
        chunks = _vector_search.hybrid_search(
            userId="system",
            query=topic_id,   # topic_id used as query; improves when topic name is stored
            documentIds=None,
            limit=limit,
        )
        return chunks[:limit]
    except Exception as exc:
        logger.warning(f"RAG fetch failed for topic={topic_id}: {exc}")
        return []


def _generate_question_gemini(
    q_type: str,
    difficulty: str,
    topic_id: str,
    chunks: List[Dict],
) -> Optional[Dict]:
    """Call Gemini to generate a single question dict."""
    import google.generativeai as genai  # lazy import — only when key present

    excerpts = "\n\n".join(
        f"[Chunk {i+1}]: {c.get('text', c.get('content', ''))[:600]}"
        for i, c in enumerate(chunks[:5])
    )

    type_instructions = {
        "MCQ":        "Generate an MCQ with exactly 4 options (A-D). Mark the correct answer.",
        "TRUE_FALSE": "Generate a True/False statement. Answer is 'True' or 'False'.",
        "SHORT":      "Generate a short-answer question expecting a 1-3 sentence response.",
        "FILL":       "Generate a fill-in-the-blank sentence. Use ___ for the blank.",
    }
    type_hint = type_instructions.get(q_type, type_instructions["MCQ"])

    prompt = f"""You are an expert exam designer. Generate ONE {difficulty}-level exam question
about topic '{topic_id}' using ONLY the source excerpts below.

Type instruction: {type_hint}

Difficulty guide:
  easy   → direct factual recall (definitions, dates, names)
  medium → conceptual understanding (why, how, relationships)
  hard   → application / multi-step inference across excerpts

Source Excerpts:
{excerpts}

Return valid JSON with this schema:
{{
  "questionText": "...",
  "type": "{q_type}",
  "options": {{"A": "...", "B": "...", "C": "...", "D": "..."}} or null for SHORT/FILL,
  "correctAnswer": "...",
  "explanation": "..."
}}"""

    genai.configure(api_key=settings.GEMINI_API_KEY)
    model = genai.GenerativeModel("gemini-1.5-flash")
    response = model.generate_content(
        prompt,
        generation_config={"response_mime_type": "application/json"},
    )
    raw = json.loads(response.text)
    return raw


def _generate_question_mock(
    q_type: str,
    difficulty: str,
    topic_id: str,
    chunks: List[Dict],
    idx: int,
) -> Dict:
    """Fallback mock generation when no Gemini key is configured."""
    text_snippet = ""
    if chunks:
        text_snippet = chunks[0].get("text", chunks[0].get("content", ""))[:120]
    return {
        "questionText": f"[MOCK {q_type}/{difficulty}] Describe the main concept from topic '{topic_id}'. (q{idx})",
        "type": q_type,
        "options": {"A": text_snippet, "B": "Option B", "C": "Option C", "D": "Option D"}
        if q_type == "MCQ"
        else ({"A": "True", "B": "False"} if q_type == "TRUE_FALSE" else None),
        "correctAnswer": "A" if q_type in ("MCQ", "TRUE_FALSE") else text_snippet[:60],
        "explanation": f"Based on: '{text_snippet}'",
    }


def _deduplicate(
    questions: List[Dict],
    threshold: float = 0.95,
) -> List[Dict]:
    """Drop semantically near-duplicate questions (cosine > threshold)."""
    if not questions:
        return questions

    embeddings: List[List[float]] = []
    kept: List[Dict] = []

    for q in questions:
        try:
            emb = _vector_search.get_embedding(q["questionText"], is_query=True)
        except Exception:
            emb = []

        is_dup = False
        for prev_emb in embeddings:
            if emb and prev_emb and _cosine(emb, prev_emb) > threshold:
                is_dup = True
                break

        if not is_dup:
            kept.append(q)
            embeddings.append(emb)

    logger.info(f"Dedup: {len(questions)} → {len(kept)} questions (threshold={threshold})")
    return kept


def _persist_questions(exam_id: str, questions: List[Dict], topic_map: Dict[int, str]) -> int:
    """Insert ExamQuestion rows and return count inserted."""
    db = _Session()
    try:
        for i, q in enumerate(questions):
            qid = str(uuid.uuid4())
            topic_id = topic_map.get(i)
            options_json = json.dumps(q.get("options") or {})
            db.execute(
                text("""
                    INSERT INTO exam_questions
                        (id, "examId", "questionText", type, options,
                         "correctAnswer", explanation, "topicId",
                         difficulty, points)
                    VALUES
                        (:id, :examId, :questionText, :type, CAST(:options AS jsonb),
                         :correctAnswer, :explanation, :topicId,
                         :difficulty, :points)
                """),
                {
                    "id": qid,
                    "examId": exam_id,
                    "questionText": q["questionText"],
                    "type": q["type"],
                    "options": options_json,
                    "correctAnswer": q.get("correctAnswer", ""),
                    "explanation": q.get("explanation", ""),
                    "topicId": topic_id,
                    "difficulty": _difficulty_float(q.get("difficultyBucket", "medium")),
                    "points": {"easy": 1, "medium": 2, "hard": 3}.get(
                        q.get("difficultyBucket", "medium"), 1
                    ),
                },
            )
        db.commit()
        logger.info(f"Persisted {len(questions)} exam questions for exam={exam_id}")
        return len(questions)
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to persist exam questions: {exc}")
        raise
    finally:
        db.close()


def _update_exam_status(exam_id: str, status: str) -> None:
    db = _Session()
    try:
        db.execute(
            text('UPDATE exams SET status = :status WHERE id = :id'),
            {"status": status, "id": exam_id},
        )
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to update exam status: {exc}")
    finally:
        db.close()


def _cache_exam(exam_id: str, questions: List[Dict]) -> None:
    """Store generated questions in Redis for 24 h."""
    try:
        r = _get_redis()
        r.set(
            f"exam:questions:{exam_id}",
            json.dumps(questions),
            ex=86400,  # 24 hours
        )
        logger.info(f"Cached {len(questions)} questions for exam={exam_id} in Redis")
    except Exception as exc:
        logger.warning(f"Redis cache write failed for exam={exam_id}: {exc}")


# ── Endpoint ──────────────────────────────────────────────────────────────────

@router.post("/exam/generate", response_model=ExamGenerateResponse)
async def generate_exam(req: ExamGenerateRequest):
    logger.info(
        f"Exam generation start: examId={req.examId} topics={req.topicIds} "
        f"total={req.totalQuestions} types={req.questionTypes}"
    )

    # 1. Build generation plan (type, difficulty) per question slot
    plan = _build_question_plan(req.totalQuestions, req.difficultyMix, req.questionTypes)

    # 2. Fetch top-10 chunks per topic (cached in memory for this request)
    topic_chunks: Dict[str, List[Dict]] = {}
    for tid in req.topicIds:
        topic_chunks[tid] = _fetch_chunks_for_topic(tid, req.orgId, limit=10)

    # 3. Generate questions — round-robin across topics
    raw_questions: List[Dict] = []
    topic_map: Dict[int, str] = {}   # question index → topicId
    topics = req.topicIds
    n_topics = len(topics)

    for idx, (q_type, difficulty_bucket) in enumerate(plan):
        topic_id = topics[idx % n_topics]
        chunks = topic_chunks.get(topic_id, [])

        try:
            if _HAS_GEMINI:
                q = _generate_question_gemini(q_type, difficulty_bucket, topic_id, chunks)
            else:
                q = _generate_question_mock(q_type, difficulty_bucket, topic_id, chunks, idx)

            if q:
                q["difficultyBucket"] = difficulty_bucket
                raw_questions.append(q)
                topic_map[len(raw_questions) - 1] = topic_id
        except Exception as exc:
            logger.warning(f"Question generation failed (idx={idx} topic={topic_id}): {exc}")

    if not raw_questions:
        _update_exam_status(req.examId, "DRAFT")
        raise HTTPException(status_code=500, detail="No questions could be generated")

    # 4. Deduplicate by semantic similarity (cosine > 0.95 = duplicate)
    unique_questions = _deduplicate(raw_questions, threshold=0.95)

    # Rebuild topic_map after deduplication (by matching dict identity)
    raw_ids = {id(q): t for q, t in zip(raw_questions, topic_map.values())}
    final_topic_map = {i: raw_ids.get(id(q), topics[0]) for i, q in enumerate(unique_questions)}

    # 5. Persist ExamQuestion rows
    try:
        count = _persist_questions(req.examId, unique_questions, final_topic_map)
    except Exception as exc:
        _update_exam_status(req.examId, "DRAFT")
        raise HTTPException(status_code=500, detail=f"DB persistence failed: {exc}")

    # 6. Update Exam.status = READY
    _update_exam_status(req.examId, "READY")

    # 7. Cache by examId in Redis
    _cache_exam(req.examId, unique_questions)

    return ExamGenerateResponse(
        examId=req.examId,
        questionCount=count,
        status="READY",
    )
