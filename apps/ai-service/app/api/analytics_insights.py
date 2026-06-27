import json
import logging
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.services.analytics import (
    track_event, record_quiz_attempt, record_flashcard_review,
    upsert_mastery, build_summary,
    EVENT_CHAT_MESSAGE, EVENT_RAG_SEARCH, EVENT_QUIZ_ATTEMPT,
    EVENT_FLASHCARD_REVIEW, EVENT_DOCUMENT_OPEN,
)

logger = logging.getLogger(__name__)
router = APIRouter()

# DB session
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

# --- Schemas ---

class TopicMasteryItem(BaseModel):
    topic: str
    score: float
    status: str  # strong | medium | weak

class DashboardSummaryInput(BaseModel):
    totalStudyTimeMinutes: int
    totalQuizzesTaken: int
    averageQuizScore: float
    totalFlashcardsReviewed: int
    streakDays: int
    topicMastery: List[TopicMasteryItem]

class AnalyticsInsightsRequest(BaseModel):
    userId: str
    summary: DashboardSummaryInput

class RecommendationResponse(BaseModel):
    insights: List[str]
    recommendations: List[str]


# --- Endpoints ---

@router.post("/analytics/insights", response_model=RecommendationResponse)
async def generate_analytics_insights(req: AnalyticsInsightsRequest):
    logger.info(f"Generating learning insights for user: {req.userId}...")

    # Format mastery text
    mastery_text = "\n".join([
        f"- {m.topic}: {m.score}% mastery (Status: {m.status})"
        for m in req.summary.topicMastery
    ])

    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")

    if not has_gemini:
        # Mock Insights logic for testing / fallback mode
        logger.info("GEMINI_API_KEY is missing. Returning mock learning recommendations.")
        
        insights = [
            f"You have logged {req.summary.totalStudyTimeMinutes} minutes of focused study time.",
            f"Your current daily study streak is {req.summary.streakDays} days! Keep the momentum."
        ]
        
        weak_topics = [m for m in req.summary.topicMastery if m.status == "weak" or m.score < 50]
        recommendations = []
        
        if weak_topics:
            recommendations.append(
                f"Your mastery in '{weak_topics[0].topic}' is low ({weak_topics[0].score}%). We recommend generating a quick revision deck."
            )
            recommendations.append(
                f"Take an EASY quiz on '{weak_topics[0].topic}' to test your basic facts before moving to harder material."
            )
        else:
            recommendations.append(
                "You are showing strong mastery across all active topics. Challenge yourself by taking a HARD mode quiz!"
            )
            recommendations.append(
                "Start a new document session to introduce new study concepts."
            )
            
        return RecommendationResponse(insights=insights, recommendations=recommendations)

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)

        # 2. Compile prompt for Gemini
        prompt = f"""You are an elite AI Study Coach and learning analytics expert. Your job is to analyze the student's learning metrics and knowledge mastery list, and produce highly personalized, actionable study recommendations and coaching insights.

Student Metrics:
- Total study time: {req.summary.totalStudyTimeMinutes} minutes
- Quizzes taken: {req.summary.totalQuizzesTaken} (Avg Score: {req.summary.averageQuizScore}%)
- Flashcards reviewed: {req.summary.totalFlashcardsReviewed}
- Current Study Streak: {req.summary.streakDays} days

Topic Mastery Status:
{mastery_text}

Task:
1. Generate 2-3 coaching insights (stored in 'insights') highlighting streaks, accomplishments, or progress trends (e.g. "Excellent job maintaining a {req.summary.streakDays}-day streak!").
2. Generate 2-3 concrete, actionable recommendations (stored in 'recommendations') focused on weaker areas (e.g. if Photosynthesis mastery is 40%, recommend revising Chapter 3 or generating a quiz on Photosynthesis). Recommendations should be practical, referring to documents/quizzes/flashcards.

You must respond with a JSON object containing 'insights' and 'recommendations' lists matching the requested response schema.
"""

        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": RecommendationResponse
            }
        )

        import json
        result_data = json.loads(response.text)
        
        return RecommendationResponse(
            insights=result_data.get("insights", []),
            recommendations=result_data.get("recommendations", [])
        )

    except Exception as e:
        logger.error(f"Gemini analytics insights failed: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini analytics insights failed: {str(e)}")


# ── Phase 2.1.7: Activity tracking & computed summary ─────────────────────────

class TrackEventRequest(BaseModel):
    userId: str
    eventType: str                   # chat.message | rag.search | quiz.attempt | flashcard.review | document.open
    tokensIn: int = 0
    tokensOut: int = 0
    latencyMs: int = 0
    model: Optional[str] = None
    # Quiz-specific (required when eventType == quiz.attempt)
    quizId: Optional[str] = None
    correctAnswers: Optional[int] = None
    wrongAnswers: Optional[int] = None
    # Flashcard-specific (required when eventType == flashcard.review)
    flashcardId: Optional[str] = None
    recallStatus: Optional[str] = None   # easy | hard | fail
    # Mastery update (optional)
    topic: Optional[str] = None
    masteryScore: Optional[float] = None
    documentId: Optional[str] = None

class TrackEventResponse(BaseModel):
    eventId: str
    status: str

@router.post("/analytics/track", response_model=TrackEventResponse)
def track_analytics_event(req: TrackEventRequest):
    """
    Records a user activity event. Depending on eventType also writes
    quiz attempt results, flashcard review outcomes, and mastery updates.
    """
    db = _Session()
    try:
        event_id = track_event(
            db=db,
            user_id=req.userId,
            event_type=req.eventType,
            tokens_in=req.tokensIn,
            tokens_out=req.tokensOut,
            latency_ms=req.latencyMs,
            model=req.model,
        )

        # Quiz attempt sub-record
        if req.eventType == EVENT_QUIZ_ATTEMPT and req.quizId and req.correctAnswers is not None:
            record_quiz_attempt(
                db=db,
                user_id=req.userId,
                quiz_id=req.quizId,
                correct=req.correctAnswers,
                wrong=req.wrongAnswers or 0,
            )

        # Flashcard review sub-record
        if req.eventType == EVENT_FLASHCARD_REVIEW and req.flashcardId and req.recallStatus:
            record_flashcard_review(
                db=db,
                user_id=req.userId,
                flashcard_id=req.flashcardId,
                recall_status=req.recallStatus,
            )

        # Optional mastery update
        if req.topic and req.masteryScore is not None:
            upsert_mastery(
                db=db,
                user_id=req.userId,
                topic=req.topic,
                score=req.masteryScore,
                document_id=req.documentId,
            )

        logger.info(f"[analytics] tracked {req.eventType} for user={req.userId} (event={event_id})")
        return TrackEventResponse(eventId=event_id, status="ok")
    except Exception as e:
        logger.error(f"[analytics] track endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()


class AnalyticsSummaryResponse(BaseModel):
    userId: str
    progressScore: float
    streakDays: int
    weakTopics: list
    chatMessages30d: int
    documentOpens30d: int
    quizAttempts30d: int
    averageQuizScore30d: float
    flashcardReviews30d: int

@router.get("/analytics/summary/{user_id}", response_model=AnalyticsSummaryResponse)
def get_analytics_summary(user_id: str):
    """
    Returns the computed analytics summary for a user:
    progress score, learning streak, weak topics, and 30-day activity counts.
    """
    db = _Session()
    try:
        summary = build_summary(db=db, user_id=user_id)
        return AnalyticsSummaryResponse(**summary)
    except Exception as e:
        logger.error(f"[analytics] summary endpoint error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        db.close()

