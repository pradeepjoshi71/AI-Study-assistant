# Multi-stage production Dockerfile for FastAPI AI Service
# Optimized: multi-stage build, non-root user, HEALTHCHECK

# ─── Stage 1: Build / dependency install ────────────────────
FROM python:3.11-slim AS builder

WORKDIR /app

# Install build dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Create and activate virtual environment
RUN python -m venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Copy and install dependencies (cached layer)
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip \
 && pip install --no-cache-dir -r requirements.txt

# ─── Stage 2: Production runtime image ──────────────────────
FROM python:3.11-slim AS runner

WORKDIR /app

# Install only runtime system deps (OCR + curl for healthcheck)
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    tesseract-ocr \
    tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*

# Copy virtual environment from builder (avoids pip in production image)
COPY --from=builder /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH"

# Run as non-root user
RUN groupadd --gid 1001 appgroup \
 && useradd --uid 1001 --gid appgroup --shell /bin/bash --create-home appuser

# Copy application code
COPY --chown=appuser:appgroup . .

USER appuser

# OCI image labels
LABEL org.opencontainers.image.title="ai-study-assistant-ai-service" \
      org.opencontainers.image.description="FastAPI AI/RAG service"

EXPOSE 8000

# Docker-level health check (ECS uses container healthCheck block)
HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD curl -f http://localhost:8000/health || exit 1

# Uvicorn with production settings:
# - 2 workers for parallelism (LLM calls are I/O bound)
# - access log off (handled by CloudWatch)
CMD ["uvicorn", "app.main:app", \
     "--host", "0.0.0.0", \
     "--port", "8000", \
     "--workers", "2", \
     "--loop", "uvloop", \
     "--no-access-log"]
