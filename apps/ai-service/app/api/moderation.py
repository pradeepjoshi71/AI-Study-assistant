import json
import logging
import httpx
from typing import Optional, Dict, Any, List
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from openai import OpenAI

from app.core.config import settings
from app.db.models import ModerationRule, ModerationLog

logger = logging.getLogger(__name__)
router = APIRouter()

# DB session setup
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

def _get_redis_client():
    import redis
    return redis.Redis(
        host=settings.AI_REDIS_HOST,
        port=settings.AI_REDIS_PORT,
        password=settings.AI_REDIS_PASSWORD or None,
    )

class ModerationRequest(BaseModel):
    contentType: str
    contentId: str
    text: str
    orgId: Optional[str] = None
    tenantId: str

# Default rules if none are present in DB
DEFAULT_RULES = [
    {"category": "hate", "threshold": 0.5, "action": "BLOCK"},
    {"category": "hate/threatening", "threshold": 0.3, "action": "BLOCK"},
    {"category": "harassment", "threshold": 0.5, "action": "BLOCK"},
    {"category": "harassment/threatening", "threshold": 0.3, "action": "BLOCK"},
    {"category": "self-harm", "threshold": 0.4, "action": "BLOCK"},
    {"category": "sexual", "threshold": 0.5, "action": "BLOCK"},
    {"category": "sexual/minors", "threshold": 0.2, "action": "BLOCK"},
    {"category": "violence", "threshold": 0.6, "action": "BLOCK"},
    {"category": "violence/graphic", "threshold": 0.4, "action": "BLOCK"}
]

@router.post("/moderation")
async def moderate_content(req: ModerationRequest):
    logger.info(f"Moderation request received for {req.contentType} ID: {req.contentId} on Tenant: {req.tenantId}")
    
    # ── 1. Fetch rules from Redis cache (fallback to DB) ──────────────────────
    redis_client = None
    cache_key = f"mod:rules:{req.tenantId}"
    rules = []
    
    try:
        redis_client = _get_redis_client()
        cached = redis_client.get(cache_key)
        if cached:
            rules = json.loads(cached.decode("utf-8"))
            logger.info("Retrieved moderation rules from Redis cache")
    except Exception as exc:
        logger.warning(f"Redis lookup failed for moderation rules: {exc}")
        
    if not rules:
        db = _Session()
        try:
            db_rules = db.query(ModerationRule).filter(ModerationRule.tenantId == req.tenantId).all()
            if db_rules:
                rules = [
                    {"category": r.category, "threshold": r.threshold, "action": r.action}
                    for r in db_rules
                ]
                logger.info(f"Retrieved {len(rules)} moderation rules from DB for tenant {req.tenantId}")
                # Cache for 10 minutes
                if redis_client:
                    try:
                        redis_client.setex(cache_key, 600, json.dumps(rules))
                    except Exception as err:
                        logger.warning(f"Failed caching rules in Redis: {err}")
            else:
                logger.info(f"No custom moderation rules found in DB for tenant {req.tenantId}. Falling back to system defaults.")
                rules = DEFAULT_RULES
        except Exception as err:
            logger.error(f"Failed querying moderation rules from database: {err}")
            rules = DEFAULT_RULES
        finally:
            db.close()

    # ── 2. Invoke OpenAI Moderation API ──────────────────────────────────────
    if not settings.OPENAI_API_KEY or settings.OPENAI_API_KEY == "your_openai_api_key_here":
        # Mock mode if OpenAI API key is missing/placeholder
        logger.warning("OpenAI API key missing or default placeholder. Running in safe mode default pass.")
        verdict = True
        action = "ALLOW"
        scores = {}
    else:
        try:
            openai_client = OpenAI(api_key=settings.OPENAI_API_KEY)
            response = openai_client.moderations.create(input=req.text)
            result = response.results[0]
            
            # Map categories and scores
            # OpenAI API returns category_scores as object attributes, e.g. result.category_scores.hate
            scores = {
                cat: getattr(result.category_scores, cat, 0.0)
                for cat in [
                    "hate", "hate/threatening", "harassment", "harassment/threatening",
                    "self-harm", "self-harm/intent", "self-harm/instructions",
                    "sexual", "sexual/minors", "violence", "violence/graphic"
                ]
            }
            
            # Evaluate against rules
            verdict = True
            action = "ALLOW"
            triggered_actions = []
            
            for rule in rules:
                cat = rule["category"]
                threshold = rule["threshold"]
                rule_action = rule["action"]
                
                # Retrieve score (support category hierarchy mapping if OpenAI reports slightly different keys)
                score = scores.get(cat, 0.0)
                if score > threshold:
                    triggered_actions.append(rule_action)
                    logger.warning(f"Moderation rule triggered: category '{cat}' score {score} > threshold {threshold}. Action: {rule_action}")
            
            if triggered_actions:
                verdict = False
                # Prioritise BLOCK over FLAG
                if "BLOCK" in triggered_actions:
                    action = "BLOCK"
                else:
                    action = "FLAG"
                    
        except Exception as exc:
            logger.error(f"Failed calling OpenAI Moderation API: {exc}")
            raise HTTPException(status_code=500, detail=f"AI moderation endpoint failure: {str(exc)}")

    # ── 3. Post verdict back to NestJS internal endpoint ──────────────────────
    verdict_payload = {
        "contentId": req.contentId,
        "contentType": req.contentType,
        "verdict": verdict,
        "scores": scores,
        "action": action
    }
    
    # NESTJS_API_URL defaults to http://localhost:3001/api/v1
    nestjs_url = f"{settings.NESTJS_API_URL}/internal/moderation/verdict"
    logger.info(f"Posting verdict back to NestJS: {nestjs_url} (action: {action})")
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(nestjs_url, json=verdict_payload, timeout=10.0)
            if resp.status_code not in (200, 201):
                logger.error(f"NestJS callback failed with status {resp.status_code}: {resp.text}")
                raise HTTPException(
                    status_code=resp.status_code,
                    detail=f"NestJS moderation handler error: {resp.text}"
                )
    except httpx.RequestError as exc:
        logger.error(f"HTTP request error during callback to NestJS: {exc}")
        raise HTTPException(status_code=502, detail=f"Unable to contact NestJS callback API: {exc}")

    return {
        "success": True,
        "verdict": verdict,
        "action": action,
        "scores": scores
    }
