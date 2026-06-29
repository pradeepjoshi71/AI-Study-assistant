"""
Content Recommendation Engine
=============================
Recommends study actions (RE_EXPLAIN, PRACTICE, ADVANCE) and content types
based on UserMastery and recent PerformanceRecords.
Posts result back to NestJS /adaptive/recommendation.
"""
from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)


class ContentRecommender:
    """
    Analyzes student mastery and performance records to suggest target study actions,
    clamped difficulties, and content formats.
    """

    def __init__(self):
        # Resolve target backend NestJS endpoint
        self.nestjs_api_url = settings.DATABASE_URL.replace("postgresql://", "http://").split("@")[-1].split("/")[0]
        # Resolve to standard NestJS port default if parsed incorrectly
        self.nestjs_endpoint = "http://localhost:3001/api/v1"

    async def recommend_and_dispatch(
        self,
        user_id: str,
        org_id: Optional[str],
        session_id: str,
        topic_id: str,
        mastery_score: float,
        current_difficulty: float,
        recent_scores: List[float],
        token: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Processes recommendation rules:
          - mastery < 0.4: RE_EXPLAIN, difficulty = current - 0.5
          - mastery 0.4 - 0.7: PRACTICE, difficulty = current
          - mastery > 0.7: ADVANCE, difficulty = current + 0.5
        Determines target contentType formats (READING, QUIZ, FLASHCARD).
        Posts recommendations back to NestJS /adaptive/recommendation.
        """
        logger.info(
            f"ContentRecommender: Evaluating user {user_id} on topic {topic_id} "
            f"(mastery: {mastery_score:.2f}, difficulty: {current_difficulty:.2f})"
        )

        # 1. Evaluate rules
        action = "PRACTICE"
        target_difficulty = current_difficulty

        if mastery_score < 0.4:
            action = "RE_EXPLAIN"
            target_difficulty = current_difficulty - 0.5
        elif mastery_score > 0.7:
            action = "ADVANCE"
            target_difficulty = current_difficulty + 0.5

        # Clamp difficulty levels
        target_difficulty = max(-3.0, min(3.0, target_difficulty))

        # 2. Select recommended content type format
        content_type = "QUIZ"
        if action == "RE_EXPLAIN":
            content_type = "READING"
        elif action == "ADVANCE":
            # Advance recommends deeper testing options
            content_type = "FLASHCARD" if len(recent_scores) % 2 == 0 else "QUIZ"

        recommendation = {
            "userId": user_id,
            "orgId": org_id,
            "sessionId": session_id,
            "topicId": topic_id,
            "action": action,
            "difficulty": target_difficulty,
            "contentType": content_type,
        }

        # 3. Post recommendation back to NestJS endpoint
        headers = {}
        if token:
            headers["Authorization"] = f"Bearer {token}"
        
        target_url = f"{self.nestjs_endpoint}/voice/adaptive/recommendation"
        
        # Adjust target hosts if running in docker network containers
        if "docker" in self.nestjs_endpoint or "host.docker.internal" in settings.DATABASE_URL:
            target_url = target_url.replace("localhost", "host.docker.internal")

        logger.info(f"Posting adaptive recommendation back to NestJS: {target_url}")
        
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.post(
                    target_url,
                    headers=headers,
                    json=recommendation,
                )
                if resp.status_code in (200, 201):
                    logger.info("Successfully posted recommendation back to NestJS.")
                else:
                    logger.error(
                        f"NestJS /adaptive/recommendation returned error: "
                        f"{resp.status_code} - {resp.text}"
                    )
        except Exception as dispatch_err:
            logger.error(f"Failed to post recommendation to NestJS: {dispatch_err}")

        return recommendation
