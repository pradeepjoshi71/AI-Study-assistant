import json
import time
import logging
from fastapi import Request, Response, status
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse
import redis
from app.core.config import settings

logger = logging.getLogger("ai_service.token_budget")

# Plan limits configuration
PLAN_LIMITS = {
    "FREE": {
        "max_input_tokens": 2000,
        "max_output_tokens": 500,
        "daily_budget": 50000
    },
    "PRO": {
        "max_input_tokens": 10000,
        "max_output_tokens": 2000,
        "daily_budget": 500000
    },
    "TEAM": {
        "max_input_tokens": 30000,
        "max_output_tokens": 8000,
        "daily_budget": 2000000
    },
    "ENTERPRISE": {
        "max_input_tokens": 30000,
        "max_output_tokens": 8000,
        "daily_budget": 2000000
    },
    "PREMIUM": {
        "max_input_tokens": 30000,
        "max_output_tokens": 8000,
        "daily_budget": 2000000
    }
}

DEFAULT_LIMITS = PLAN_LIMITS["FREE"]


class TokenBudgetMiddleware(BaseHTTPMiddleware):
    """
    Enforces per-request input/output token budgets and daily token limits
    based on the user's plan. Returns 429 when budget is exhausted.
    """

    def __init__(self, app):
        super().__init__(app)
        self.redis_client = redis.Redis(
            host=settings.AI_REDIS_HOST,
            port=int(settings.AI_REDIS_PORT),
            password=settings.AI_REDIS_PASSWORD or None,
            decode_responses=True
        )

    async def dispatch(self, request: Request, call_next) -> Response:
        user_id = request.headers.get("x-user-id")
        
        # If no user_id is provided (e.g. background worker internal jobs), let it pass
        if not user_id:
            return await call_next(request)

        # Skip limit checking on health/metadata endpoints
        if request.url.path in ["/health", "/docs", "/openapi.json", "/redoc"]:
            return await call_next(request)

        # 1. Resolve user plan from Redis session cache
        plan = "FREE"
        try:
            user_session_raw = self.redis_client.get(f"user:session:{user_id}")
            if user_session_raw:
                user_session = json.loads(user_session_raw)
                plan = user_session.get("subscriptionPlan", "FREE").upper()
        except Exception as e:
            logger.warning(f"Failed to fetch user plan from Redis for user {user_id}: {e}")

        limits = PLAN_LIMITS.get(plan, DEFAULT_LIMITS)

        # 2. Estimate input tokens from request body
        input_tokens = 0
        body_bytes = b""
        
        if request.method in ["POST", "PUT", "PATCH"]:
            body_bytes = await request.body()
            # Restore request body stream so downstream route handlers can parse it
            async def receive():
                return {"type": "http.request", "body": body_bytes, "more_body": False}
            request._receive = receive

            try:
                if body_bytes:
                    payload = json.loads(body_bytes.decode("utf-8"))
                    
                    # Estimate based on string lengths in payload (1 token ≈ 4 characters)
                    text_content = ""
                    for key in ["message", "prompt", "text", "systemPrompt"]:
                        if key in payload and isinstance(payload[key], str):
                            text_content += payload[key]
                    
                    if "history" in payload and isinstance(payload["history"], list):
                        for item in payload["history"]:
                            if isinstance(item, dict) and "content" in item:
                                text_content += str(item["content"])

                    if text_content:
                        input_tokens = len(text_content) // 4
            except Exception as e:
                logger.warning(f"Error parsing request body for token budget: {e}")

        # Enforce max_input_tokens
        if input_tokens > limits["max_input_tokens"]:
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Input token limit exceeded for plan {plan}. Limit: {limits['max_input_tokens']} tokens, Request: {input_tokens} tokens."
                },
                headers={"X-RateLimit-Reset": "0"}
            )

        # 3. Check daily accumulated token budget
        daily_usage_key = f"user:daily-tokens:{user_id}"
        try:
            current_usage_raw = self.redis_client.get(daily_usage_key)
            current_usage = int(current_usage_raw) if current_usage_raw else 0
        except Exception as e:
            logger.warning(f"Failed to fetch daily token usage from Redis: {e}")
            current_usage = 0

        # Enforce daily budget (we include a default expected output tokens chunk for the check)
        expected_output = limits["max_output_tokens"]
        if current_usage + input_tokens + expected_output > limits["daily_budget"]:
            ttl = self.redis_client.ttl(daily_usage_key)
            reset_time = str(ttl) if ttl > 0 else "86400"
            return JSONResponse(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                content={
                    "detail": f"Daily token budget exceeded for plan {plan}. Daily limit: {limits['daily_budget']} tokens."
                },
                headers={"X-RateLimit-Reset": reset_time, "Retry-After": reset_time}
            )

        # 4. Process Request
        response = await call_next(request)

        # 5. Track/update token usage in Redis
        # Conservative token estimation: input + 250 default output tokens (for streaming/unknown sizes)
        tokens_consumed = input_tokens + 250
        try:
            pipe = self.redis_client.pipeline()
            pipe.incrby(daily_usage_key, tokens_consumed)
            pipe.ttl(daily_usage_key)
            res = pipe.execute()
            
            ttl_val = res[1]
            if ttl_val == -1 or ttl_val == -2:
                self.redis_client.expire(daily_usage_key, 86400)
        except Exception as e:
            logger.warning(f"Failed to update daily token usage counter in Redis: {e}")

        return response
