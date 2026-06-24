import logging
from typing import List, Dict, Any, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

# --- Schemas ---

class ChunkItem(BaseModel):
    chunkId: str
    text: str
    score: float
    documentId: str
    pageNumber: int
    documentTitle: str

# Quiz Generation Input/Output
class GenerateQuizRequest(BaseModel):
    query: str
    chunks: List[ChunkItem]
    difficulty: str  # easy | medium | hard
    count: int

class QuizQuestion(BaseModel):
    type: str  # MCQ | TRUE_FALSE | SHORT_ANSWER
    question: str
    options: Optional[List[str]] = None
    answer: str
    explanation: str
    chunkIdSource: str

class QuizGenerationResponse(BaseModel):
    questions: List[QuizQuestion]

# Flashcard Generation Input/Output
class GenerateFlashcardsRequest(BaseModel):
    chunks: List[ChunkItem]
    mode: str  # basic | exam | revision

class FlashcardItem(BaseModel):
    front: str
    back: str
    chunkIdSource: str
    tags: List[str]

class FlashcardGenerationResponse(BaseModel):
    flashcards: List[FlashcardItem]


# --- Endpoints ---

@router.post("/study/quiz/generate", response_model=QuizGenerationResponse)
async def generate_quiz(req: GenerateQuizRequest):
    logger.info(f"Generating quiz questions: count={req.count}, difficulty={req.difficulty}...")
    
    if not req.chunks:
        return QuizGenerationResponse(questions=[])

    # 1. Format source excerpts
    formatted_excerpts = "\n\n".join([
        f"Excerpt from '{c.documentTitle}' (Page {c.pageNumber}) [Chunk ID: {c.chunkId}]:\n{c.text}"
        for c in req.chunks
    ])

    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")

    if not has_gemini:
        # Mock Quiz Generation logic for testing / fallback mode
        logger.info("GEMINI_API_KEY is missing. Returning mock quiz questions.")
        mock_questions = []
        
        # Create mock questions from chunks
        for i in range(min(req.count, len(req.chunks))):
            chunk = req.chunks[i]
            question_text = f"According to '{chunk.documentTitle}', what is discussed on page {chunk.pageNumber}?"
            snippet = chunk.text[:80] + "..."
            
            if i % 3 == 0:
                mock_questions.append(QuizQuestion(
                    type="MCQ",
                    question=question_text,
                    options=[snippet, "Incorrect option A", "Incorrect option B", "Incorrect option C"],
                    answer=snippet,
                    explanation=f"The text explicitly says: '{chunk.text[:120]}...'",
                    chunkIdSource=chunk.chunkId
                ))
            elif i % 3 == 1:
                mock_questions.append(QuizQuestion(
                    type="TRUE_FALSE",
                    question=f"True or False: The text discusses the following concept: '{chunk.text[:60]}'",
                    options=["True", "False"],
                    answer="True",
                    explanation="This is true based on the provided text.",
                    chunkIdSource=chunk.chunkId
                ))
            else:
                mock_questions.append(QuizQuestion(
                    type="SHORT_ANSWER",
                    question=f"Complete this statement: {question_text}",
                    answer=snippet,
                    explanation="Re-read the text for detailed confirmation.",
                    chunkIdSource=chunk.chunkId
                ))

        return QuizGenerationResponse(questions=mock_questions)

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)

        # 2. Compile prompt for Gemini
        prompt = f"""You are an elite academic curriculum designer and Study Assistant. Your task is to generate a high-quality, RAG-grounded quiz on the topic: "{req.query}".
The quiz must contain exactly {req.count} questions.
All questions must be strictly based on the provided source excerpts. Do not use any external knowledge. If the excerpts do not contain enough facts to generate a question, simplify or skip.
Every question must cite its source chunk ID in 'chunkIdSource'.

Difficulty Level constraints:
- easy: Generate direct, fact-based questions (e.g. key terms, definitions, specific dates or numbers directly stated in the context).
- medium: Generate questions testing conceptual understanding (e.g. explaining "why", summarizing sections, or understanding relationships).
- hard: Generate questions requiring application and inference across multiple chunks or documents (e.g. synthesizing facts, drawing conclusions, comparing details).

Choose question types among: MCQ (Multiple Choice with 4 options), TRUE_FALSE, and SHORT_ANSWER.

Source Excerpts:
{formatted_excerpts}

You must respond with a JSON object containing a 'questions' list matching the requested response schema.
"""

        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": QuizGenerationResponse
            }
        )

        import json
        result_data = json.loads(response.text)
        
        # Fallback fields mapping if required
        parsed_questions = []
        for q in result_data.get("questions", []):
            parsed_questions.append(QuizQuestion(
                type=q.get("type", "MCQ"),
                question=q.get("question", ""),
                options=q.get("options"),
                answer=str(q.get("answer", "")),
                explanation=q.get("explanation", ""),
                chunkIdSource=q.get("chunkIdSource", "")
            ))
            
        logger.info(f"Successfully generated {len(parsed_questions)} questions via Gemini.")
        return QuizGenerationResponse(questions=parsed_questions)

    except Exception as e:
        logger.error(f"Gemini quiz generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini quiz generation failed: {str(e)}")


@router.post("/study/flashcards/generate", response_model=FlashcardGenerationResponse)
async def generate_flashcards(req: GenerateFlashcardsRequest):
    logger.info(f"Generating flashcards: mode={req.mode}...")
    
    if not req.chunks:
        return FlashcardGenerationResponse(flashcards=[])

    # 1. Format source excerpts
    formatted_excerpts = "\n\n".join([
        f"Excerpt from '{c.documentTitle}' (Page {c.pageNumber}) [Chunk ID: {c.chunkId}]:\n{c.text}"
        for c in req.chunks
    ])

    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")

    if not has_gemini:
        # Mock Flashcards logic for testing / fallback mode
        logger.info("GEMINI_API_KEY is missing. Returning mock flashcards.")
        mock_cards = []
        
        for i, chunk in enumerate(req.chunks):
            mock_cards.append(FlashcardItem(
                front=f"Key Concept from '{chunk.documentTitle}' (Page {chunk.pageNumber})",
                back=chunk.text[:120] + "...",
                chunkIdSource=chunk.chunkId,
                tags=[req.mode, "mock"]
            ))
            
        return FlashcardGenerationResponse(flashcards=mock_cards)

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)

        # 2. Compile prompt for Gemini
        prompt = f"""You are an academic learning designer. Your task is to convert the provided document excerpts into flashcards designed for active recall and spaced repetition.
Generate atomic, focused Front/Back question-answer card pairs.
All cards must be strictly based on the provided source excerpts. Do not use external knowledge.
Each card must cite its source chunk ID in 'chunkIdSource' and contain tags describing the topic and difficulty.

Flashcard Mode constraints:
- basic: standard concept definitions and key terms.
- exam: exam-relevant questions testing core theories, formulas, and laws.
- revision: quick review items containing summaries and quick reference points.

Source Excerpts:
{formatted_excerpts}

You must respond with a JSON object containing a 'flashcards' list matching the requested response schema.
"""

        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": FlashcardGenerationResponse
            }
        )

        import json
        result_data = json.loads(response.text)
        
        parsed_cards = []
        for fc in result_data.get("flashcards", []):
            parsed_cards.append(FlashcardItem(
                front=fc.get("front", ""),
                back=fc.get("back", ""),
                chunkIdSource=fc.get("chunkIdSource", ""),
                tags=fc.get("tags", [])
            ))

        logger.info(f"Successfully generated {len(parsed_cards)} flashcards via Gemini.")
        return FlashcardGenerationResponse(flashcards=parsed_cards)

    except Exception as e:
        logger.error(f"Gemini flashcards generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini flashcard generation failed: {str(e)}")
