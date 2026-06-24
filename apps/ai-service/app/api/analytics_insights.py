import logging
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

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
