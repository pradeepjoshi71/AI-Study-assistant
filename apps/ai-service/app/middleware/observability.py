"""
Observability middleware for FastAPI AI Service.
- Reads X-Correlation-ID from request (forwarded by NestJS gateway)
- Generates UUID if not present
- Emits structured JSON log per request: method, path, status, latency, correlation_id
- Attaches X-Correlation-ID to response headers for end-to-end tracing
"""
import json
import logging
import time
from uuid import uuid4

from starlette.middleware.base import BaseHTTPMiddleware
from starlette.requests import Request
from starlette.responses import Response

logger = logging.getLogger("ai_service.http")


class ObservabilityMiddleware(BaseHTTPMiddleware):
    """
    Structured HTTP request/response logging middleware.
    Compatible with CloudWatch, Datadog, and Loki log ingestion.
    """

    async def dispatch(self, request: Request, call_next) -> Response:
        # Extract or generate correlation ID
        correlation_id = request.headers.get("x-correlation-id") or str(uuid4())
        start_time = time.time()

        try:
            response = await call_next(request)
            status_code = response.status_code
        except Exception as exc:
            latency_ms = int((time.time() - start_time) * 1000)
            logger.error(
                json.dumps({
                    "correlation_id": correlation_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": 500,
                    "latency_ms": latency_ms,
                    "error": str(exc),
                })
            )
            raise

        latency_ms = int((time.time() - start_time) * 1000)

        # Structured JSON log line
        logger.info(
            json.dumps({
                "correlation_id": correlation_id,
                "method": request.method,
                "path": request.url.path,
                "status_code": status_code,
                "latency_ms": latency_ms,
            })
        )

        # Propagate correlation ID in response
        response.headers["X-Correlation-ID"] = correlation_id
        return response
