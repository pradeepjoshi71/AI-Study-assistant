"""
Adaptive Testing Engine
=======================
Implements a 3-parameter logistic (3PL) Item Response Theory (IRT) model.
Manages user latent ability (theta / θ) estimations and recommends target
difficulty levels based on performance events.
"""
from __future__ import annotations

import json
import logging
import math
from typing import Any, Dict, List, Optional, Tuple

import redis
from app.core.config import settings

logger = logging.getLogger(__name__)


class AdaptiveEngine:
    """
    Manages user ability estimates (theta) using Maximum Likelihood Estimation (MLE)
    gradient updates under a 3-parameter logistic model.
    Falls back to simple rule-based difficulty adjustment if insufficient topic records exist.
    """

    def __init__(self):
        self._redis = None
        self._init_redis()

    def _init_redis(self):
        try:
            self._redis = redis.Redis(
                host=settings.REDIS_HOST,
                port=settings.REDIS_PORT,
                password=settings.REDIS_PASSWORD or None,
                decode_responses=True,
            )
        except Exception as e:
            logger.warning(f"AdaptiveEngine: Redis connection failed: {e}")

    # ── Latent Ability & Difficulty Adjustments ───────────────────────────────

    def process_answer_event(
        self,
        user_id: str,
        topic_id: str,
        score: float,  # score: 0.0 - 1.0 (correctness indicator)
        item_difficulty: float,  # b (base difficulty parameter)
        discrimination: float = 1.0,  # a (discrimination parameter)
        guessing: float = 0.2,  # c (guessing parameter)
        recent_scores: Optional[List[float]] = None,
    ) -> float:
        """
        Calculates and updates user latent ability θ based on performance outcomes.
        Returns the next target difficulty parameter level.
        """
        # 1. Fetch current ability estimate theta from Redis
        theta_key = f"ability:{user_id}:{topic_id}"
        theta = 0.0  # default start theta

        if self._redis:
            try:
                cached = self._redis.get(theta_key)
                if cached is not None:
                    theta = float(cached)
            except Exception as cache_err:
                logger.warning(f"Failed to fetch ability from Redis: {cache_err}")

        # 2. Insufficient records fallback (< 5 scores)
        scores_list = recent_scores or []
        if len(scores_list) < 5:
            # Rule-based adjustment
            # score > 0.8: advance (increase by 0.5)
            # score < 0.4: reduce (decrease by 0.5)
            # score: 0.0 - 1.0 bounds
            norm_score = score if score <= 1.0 else score / 100.0
            
            next_diff = item_difficulty
            if norm_score > 0.8:
                next_diff += 0.5
            elif norm_score < 0.4:
                next_diff -= 0.5

            # Clamp difficulty parameters (typically between -3.0 and +3.0)
            next_diff = max(-3.0, min(3.0, next_diff))
            
            # Simple theta adjustment corresponding to difficulty
            theta_update = theta + (0.3 if norm_score > 0.8 else -0.3 if norm_score < 0.4 else 0.0)
            theta_update = max(-3.0, min(3.0, theta_update))
            self._save_theta(theta_key, theta_update)
            
            logger.info(
                f"Adaptive: Rule-based adjustment. Score={norm_score:.2f} "
                f"OldDiff={item_difficulty:.2f} NextDiff={next_diff:.2f} Theta={theta_update:.2f}"
            )
            return next_diff

        # 3. 3PL IRT Model Math:
        # P(correct|θ) = c + (1-c) / (1 + exp(-a*(θ-b)))
        norm_score = score if score <= 1.0 else score / 100.0
        
        a = discrimination
        b = item_difficulty
        c = guessing

        try:
            # Compute exponential term
            exp_term = math.exp(-a * (theta - b))
            denom = 1.0 + exp_term
            p_correct = c + (1.0 - c) / denom

            # Ensure P values stay clear of extreme limits (0 or 1) to avoid math singularities
            p_correct = max(0.01, min(0.99, p_correct))

            # MLE Gradient step update:
            # dL/dtheta = a * (P - c) * (score - P) / (P * (1 - c))
            # Step size (learning rate) decays with confidence/history bounds (default 0.2)
            gradient = a * (p_correct - c) * (norm_score - p_correct) / (p_correct * (1.0 - c))
            
            learning_rate = 0.25
            theta_update = theta + learning_rate * gradient
            theta_update = max(-3.0, min(3.0, theta_update))
            self._save_theta(theta_key, theta_update)

            # Recommend difficulty level matching new latent ability θ
            next_diff = theta_update
            logger.info(
                f"Adaptive: 3PL IRT update. Score={norm_score:.2f} P(correct)={p_correct:.3f} "
                f"Gradient={gradient:.3f} OldTheta={theta:.2f} NewTheta={theta_update:.2f}"
            )
            return next_diff
            
        except Exception as math_err:
            logger.error(f"Failed to compute 3PL IRT model update: {math_err}")
            return item_difficulty

    # ── Helpers ───────────────────────────────────────────────────────────────

    def _save_theta(self, key: str, val: float):
        if self._redis:
            try:
                self._redis.set(key, str(val))
            except Exception as cache_err:
                logger.warning(f"Failed to cache ability in Redis: {cache_err}")
