"""
Adaptive Testing Engine Router
==============================
Exposes difficulty recommendations and student capability estimations.
"""
import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional

from app.services.adaptive_engine import AdaptiveEngine

logger = logging.getLogger(__name__)
router = APIRouter()

adaptive_engine = AdaptiveEngine()

class AnswerEventRequest(BaseModel):
    userId: str
    topicId: str
    score: float # correctness indicator: 0.0 - 1.0 (or percentage 0 - 100)
    itemDifficulty: float # b parameter
    discrimination: Optional[float] = 1.0 # a parameter
    guessing: Optional[float] = 0.2 # c parameter
    recentScores: Optional[List[float]] = None

@router.post("/study/adaptive/recommend")
def recommend_next_difficulty(req: AnswerEventRequest):
    """
    Receives quiz/flashcard completion events.
    Computes latent ability updates and recommends difficulty levels.
    """
    try:
        next_difficulty = adaptive_engine.process_answer_event(
            user_id=req.userId,
            topic_id=req.topicId,
            score=req.score,
            item_difficulty=req.itemDifficulty,
            discrimination=req.discrimination or 1.0,
            guessing=req.guessing or 0.2,
            recent_scores=req.recentScores,
        )
        return {
            "success": True,
            "userId": req.userId,
            "topicId": req.topicId,
            "nextDifficulty": next_difficulty,
        }
    except Exception as exc:
        logger.error(f"Failed to calculate adaptive recommendation: {exc}")
        raise HTTPException(status_code=500, detail=str(exc))
