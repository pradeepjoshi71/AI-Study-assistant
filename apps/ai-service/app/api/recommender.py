"""
Content Recommender API Router
==============================
Exposes content recommendations endpoints.
"""
import logging
from fastapi import APIRouter, Header, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.services.content_recommender import ContentRecommender

logger = logging.getLogger(__name__)
router = APIRouter()

content_recommender = ContentRecommender()

class ContentRecommendRequest(BaseModel):
    userId: str
    orgId: Optional[str] = None
    sessionId: str
    topicId: str
    masteryScore: float
    currentDifficulty: float
    recentScores: List[float]

@router.post("/study/recommend/content")
async def recommend_content_endpoint(
    req: ContentRecommendRequest,
    authorization: Optional[str] = Header(None),
):
    """
    Computes study action rules, clamps target difficulty, maps formats,
    and dispatches recommendations back to NestJS /adaptive/recommendation.
    """
    token = None
    if authorization and authorization.startswith("Bearer "):
        token = authorization.split(" ")[1]

    try:
        result = await content_recommender.recommend_and_dispatch(
            user_id=req.userId,
            org_id=req.orgId,
            session_id=req.sessionId,
            topic_id=req.topicId,
            mastery_score=req.masteryScore,
            current_difficulty=req.currentDifficulty,
            recent_scores=req.recentScores,
            token=token,
        )
        return {
            "success": True,
            "recommendation": result,
        }
    except Exception as exc:
        logger.error(f"Content recommender failed: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
