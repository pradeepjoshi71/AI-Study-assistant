import json
import logging
import uuid
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.db.models import Quiz, StoredQuizQuestion, FlashcardDeck, StoredFlashcard

logger = logging.getLogger(__name__)
router = APIRouter()

# ── DB session (reuse main engine config) ─────────────────────────────────────
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

_HAS_GEMINI = bool(
    settings.GEMINI_API_KEY
    and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    and settings.GEMINI_API_KEY.strip()
)

# ── Schemas ───────────────────────────────────────────────────────────────────

class ChunkItem(BaseModel):
    chunkId: str
    text: str
    score: float
    documentId: str
    pageNumber: int
    documentTitle: str

class GenerateQuizRequest(BaseModel):
    query: str
    chunks: List[ChunkItem]
    difficulty: str          # easy | medium | hard
    count: int
    userId: str = "anonymous"
    conversationId: Optional[str] = None

class QuizQuestion(BaseModel):
    type: str                # MCQ | TRUE_FALSE | SHORT_ANSWER
    question: str
    options: Optional[List[str]] = None
    answer: str
    explanation: str
    chunkIdSource: str

class QuizGenerationResponse(BaseModel):
    quizId: str
    questions: List[QuizQuestion]
    documentIds: List[str]   # unique document IDs covered by this quiz

class GenerateFlashcardsRequest(BaseModel):
    chunks: List[ChunkItem]
    mode: str                # basic | exam | revision
    userId: str = "anonymous"
    conversationId: Optional[str] = None

class FlashcardItem(BaseModel):
    front: str
    back: str
    chunkIdSource: str
    tags: List[str]

class FlashcardGenerationResponse(BaseModel):
    deckId: str
    flashcards: List[FlashcardItem]
    documentIds: List[str]   # unique document IDs covered by this deck


# ── Helpers ───────────────────────────────────────────────────────────────────

def _unique_doc_ids(chunks: List[ChunkItem]) -> List[str]:
    seen, out = set(), []
    for c in chunks:
        if c.documentId not in seen:
            seen.add(c.documentId)
            out.append(c.documentId)
    return out

def _persist_quiz(
    questions: List[QuizQuestion],
    req: GenerateQuizRequest,
    doc_ids: List[str],
) -> str:
    """Saves quiz + questions to PostgreSQL; returns quiz ID."""
    quiz_id = str(uuid.uuid4())
    title = f"Quiz: {req.query[:60]}" if req.query else "Generated Quiz"
    db = _Session()
    try:
        quiz = Quiz(
            id=quiz_id,
            userId=req.userId,
            tenantId="default",
            conversationId=req.conversationId,
            title=title,
            difficulty=req.difficulty,
        )
        db.add(quiz)
        for q in questions:
            db.add(StoredQuizQuestion(
                id=str(uuid.uuid4()),
                quizId=quiz_id,
                type=q.type,
                question=q.question,
                options=q.options,
                answer=q.answer,
                explanation=q.explanation,
                chunkIdSource=q.chunkIdSource,
            ))
        db.commit()
        logger.info(f"Quiz {quiz_id} persisted ({len(questions)} questions, docs={doc_ids})")
    except Exception as e:
        db.rollback()
        logger.error(f"Quiz persistence failed: {e}")
        quiz_id = "unsaved"
    finally:
        db.close()
    return quiz_id

def _persist_deck(
    flashcards: List[FlashcardItem],
    req: GenerateFlashcardsRequest,
    doc_ids: List[str],
) -> str:
    """Saves flashcard deck + cards to PostgreSQL; returns deck ID."""
    deck_id = str(uuid.uuid4())
    title = f"Flashcards ({req.mode}) – {', '.join(doc_ids[:2])}"
    db = _Session()
    try:
        deck = FlashcardDeck(
            id=deck_id,
            userId=req.userId,
            tenantId="default",
            conversationId=req.conversationId,
            title=title,
        )
        db.add(deck)
        for fc in flashcards:
            db.add(StoredFlashcard(
                id=str(uuid.uuid4()),
                deckId=deck_id,
                front=fc.front,
                back=fc.back,
                chunkIdSource=fc.chunkIdSource,
                tags=fc.tags,
            ))
        db.commit()
        logger.info(f"Deck {deck_id} persisted ({len(flashcards)} cards, docs={doc_ids})")
    except Exception as e:
        db.rollback()
        logger.error(f"Deck persistence failed: {e}")
        deck_id = "unsaved"
    finally:
        db.close()
    return deck_id


# ── Endpoints ─────────────────────────────────────────────────────────────────

@router.post("/study/quiz/generate", response_model=QuizGenerationResponse)
async def generate_quiz(req: GenerateQuizRequest):
    logger.info(f"Generating quiz: count={req.count}, difficulty={req.difficulty}")
    doc_ids = _unique_doc_ids(req.chunks)

    if not req.chunks:
        return QuizGenerationResponse(quizId="empty", questions=[], documentIds=[])

    formatted_excerpts = "\n\n".join([
        f"Excerpt from '{c.documentTitle}' (Page {c.pageNumber}) [Chunk ID: {c.chunkId}]:\n{c.text}"
        for c in req.chunks
    ])

    # ── Mock path ─────────────────────────────────────────────────────────────
    if not _HAS_GEMINI:
        logger.info("Mock quiz generation (no Gemini key).")
        questions: List[QuizQuestion] = []
        for i in range(min(req.count, len(req.chunks))):
            c = req.chunks[i]
            snippet = c.text[:80] + "..."
            q_text = f"According to '{c.documentTitle}' (p.{c.pageNumber}), describe the main concept."
            q_type = ["MCQ", "SHORT_ANSWER", "TRUE_FALSE"][i % 3]
            opts = [snippet, "Incorrect A", "Incorrect B", "Incorrect C"] if q_type == "MCQ" else \
                   (["True", "False"] if q_type == "TRUE_FALSE" else None)
            questions.append(QuizQuestion(
                type=q_type,
                question=q_text,
                options=opts,
                answer=snippet,
                explanation=f"The text says: '{c.text[:120]}'",
                chunkIdSource=c.chunkId,
            ))
        quiz_id = _persist_quiz(questions, req, doc_ids)
        return QuizGenerationResponse(quizId=quiz_id, questions=questions, documentIds=doc_ids)

    # ── Gemini path ───────────────────────────────────────────────────────────
    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        prompt = f"""You are an elite academic curriculum designer. Generate exactly {req.count} quiz questions on: "{req.query}".
Use ONLY the source excerpts below. Do NOT use external knowledge.
Every question must cite its chunkIdSource.
Difficulty: {req.difficulty}
  - easy: direct fact-based (definitions, dates, numbers)
  - medium: conceptual understanding (why, how, relationships)
  - hard: application/inference across multiple chunks

Use question types: MCQ (4 options), TRUE_FALSE, SHORT_ANSWER.
Distribute types across all three where possible.

Source Excerpts:
{formatted_excerpts}

Respond with JSON: {{"questions": [{{"type":"...","question":"...","options":["..."],"answer":"...","explanation":"...","chunkIdSource":"..."}}]}}
"""
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json", "response_schema": QuizGenerationResponse},
        )
        result = json.loads(response.text)
        questions = [
            QuizQuestion(
                type=q.get("type", "MCQ"),
                question=q.get("question", ""),
                options=q.get("options"),
                answer=str(q.get("answer", "")),
                explanation=q.get("explanation", ""),
                chunkIdSource=q.get("chunkIdSource", ""),
            )
            for q in result.get("questions", [])
        ]
        logger.info(f"Generated {len(questions)} questions via Gemini.")
        quiz_id = _persist_quiz(questions, req, doc_ids)
        return QuizGenerationResponse(quizId=quiz_id, questions=questions, documentIds=doc_ids)
    except Exception as e:
        logger.error(f"Gemini quiz generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Quiz generation failed: {e}")


@router.post("/study/flashcards/generate", response_model=FlashcardGenerationResponse)
async def generate_flashcards(req: GenerateFlashcardsRequest):
    logger.info(f"Generating flashcards: mode={req.mode}")
    doc_ids = _unique_doc_ids(req.chunks)

    if not req.chunks:
        return FlashcardGenerationResponse(deckId="empty", flashcards=[], documentIds=[])

    formatted_excerpts = "\n\n".join([
        f"Excerpt from '{c.documentTitle}' (Page {c.pageNumber}) [Chunk ID: {c.chunkId}]:\n{c.text}"
        for c in req.chunks
    ])

    # ── Mock path ─────────────────────────────────────────────────────────────
    if not _HAS_GEMINI:
        logger.info("Mock flashcard generation (no Gemini key).")
        flashcards = [
            FlashcardItem(
                front=f"Key concept from '{c.documentTitle}' p.{c.pageNumber}",
                back=c.text[:120] + "...",
                chunkIdSource=c.chunkId,
                tags=[req.mode, "mock", c.documentId],
            )
            for c in req.chunks
        ]
        deck_id = _persist_deck(flashcards, req, doc_ids)
        return FlashcardGenerationResponse(deckId=deck_id, flashcards=flashcards, documentIds=doc_ids)

    # ── Gemini path ───────────────────────────────────────────────────────────
    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        prompt = f"""You are an academic learning designer. Convert the excerpts into flashcards for active recall.
Mode: {req.mode}
  - basic: key terms and definitions
  - exam: core theories, formulas, laws
  - revision: summaries and quick reference points

Each card: atomic front/back pair, chunkIdSource, and relevant tags.
Use ONLY the source excerpts. No external knowledge.

Source Excerpts:
{formatted_excerpts}

Respond with JSON: {{"flashcards": [{{"front":"...","back":"...","chunkIdSource":"...","tags":["..."]}}]}}
"""
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={"response_mime_type": "application/json", "response_schema": FlashcardGenerationResponse},
        )
        result = json.loads(response.text)
        flashcards = [
            FlashcardItem(
                front=fc.get("front", ""),
                back=fc.get("back", ""),
                chunkIdSource=fc.get("chunkIdSource", ""),
                tags=fc.get("tags", []),
            )
            for fc in result.get("flashcards", [])
        ]
        logger.info(f"Generated {len(flashcards)} flashcards via Gemini.")
        deck_id = _persist_deck(flashcards, req, doc_ids)
        return FlashcardGenerationResponse(deckId=deck_id, flashcards=flashcards, documentIds=doc_ids)
    except Exception as e:
        logger.error(f"Gemini flashcard generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Flashcard generation failed: {e}")
