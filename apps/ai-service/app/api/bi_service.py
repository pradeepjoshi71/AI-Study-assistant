"""
BI Service — Hourly cron computing MetricSnapshots.

Metrics computed:
- DAU (Daily Active Users) per tenant
- Retention cohorts (D1, D7, D30) per signup week cohort
- Funnel conversion steps per tenant
- Churn risk detection (dispatches NestJS notification)

All results upserted into metric_snapshots table and cached in Redis.
"""
import json
import uuid
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional

import httpx
import redis as redis_lib
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app.core.config import settings

logger = logging.getLogger(__name__)

# ── DB session setup ──────────────────────────────────────────────────────────
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

REDIS_TTL_1HR = 3600


def _get_redis() -> redis_lib.Redis:
    return redis_lib.Redis(
        host=settings.AI_REDIS_HOST,
        port=settings.AI_REDIS_PORT,
        password=settings.AI_REDIS_PASSWORD or None,
        decode_responses=True,
    )


def _cache_set(r: redis_lib.Redis, tenant_id: str, metric: str, period: str, value: any) -> None:
    key = f"bi:{tenant_id}:{metric}:{period}"
    try:
        r.setex(key, REDIS_TTL_1HR, json.dumps(value))
    except Exception as exc:
        logger.warning(f"Failed to cache BI metric {key}: {exc}")


def _upsert_snapshot(db, tenant_id: str, metric: str, period: str, date: datetime,
                      value: float, dimensions: dict) -> None:
    """Upsert a MetricSnapshot row using ON CONFLICT."""
    try:
        db.execute(text("""
            INSERT INTO metric_snapshots (id, "tenantId", metric, dimensions, value, period, date, "createdAt")
            VALUES (:id, :tenant_id, :metric, CAST(:dimensions AS jsonb), :value, CAST(:period AS "MetricPeriod"), :date, NOW())
            ON CONFLICT ON CONSTRAINT metric_snapshots_unique_idx
            DO UPDATE SET value = EXCLUDED.value
        """), {
            "id": str(uuid.uuid4()),
            "tenant_id": tenant_id,
            "metric": metric,
            "dimensions": json.dumps(dimensions),
            "value": value,
            "period": period,
            "date": date,
        })
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.error(f"Failed to upsert MetricSnapshot {metric}/{period} for tenant {tenant_id}: {exc}")


# ── 1. DAU — Daily Active Users ───────────────────────────────────────────────
def compute_dau(db, r: redis_lib.Redis) -> None:
    today = datetime.now(timezone.utc).date()
    logger.info(f"Computing DAU for {today}")

    rows = db.execute(text("""
        SELECT "tenantId", COUNT(DISTINCT "userId") AS dau
        FROM analytics_events
        WHERE DATE("createdAt") = :today
          AND "userId" IS NOT NULL
        GROUP BY "tenantId"
    """), {"today": today}).fetchall()

    for row in rows:
        tenant_id, dau = row
        _upsert_snapshot(db, tenant_id, "dau", "DAILY", datetime.combine(today, datetime.min.time()), float(dau), {})
        _cache_set(r, tenant_id, "dau", "DAILY", {"date": today.isoformat(), "value": dau})
        logger.info(f"DAU [{tenant_id}]: {dau}")


# ── 2. Retention Cohorts (D1, D7, D30) ───────────────────────────────────────
def compute_retention(db, r: redis_lib.Redis) -> None:
    logger.info("Computing retention cohorts")

    # Get distinct signup cohort weeks
    cohorts = db.execute(text("""
        SELECT "tenantId",
               DATE_TRUNC('week', "createdAt") AS cohort_week,
               COUNT(DISTINCT "userId") AS cohort_size
        FROM analytics_events
        WHERE event = 'signed_up'
          AND "userId" IS NOT NULL
        GROUP BY "tenantId", cohort_week
        ORDER BY cohort_week DESC
        LIMIT 52
    """)).fetchall()

    for cohort in cohorts:
        tenant_id, cohort_week, cohort_size = cohort
        if cohort_size == 0:
            continue

        cohort_week_dt = cohort_week if isinstance(cohort_week, datetime) else datetime.fromisoformat(str(cohort_week))
        cohort_week_str = cohort_week_dt.strftime("%Y-W%W")

        # Fetch userIds in this cohort
        cohort_users = db.execute(text("""
            SELECT DISTINCT "userId"
            FROM analytics_events
            WHERE event = 'signed_up'
              AND "tenantId" = :tenant_id
              AND DATE_TRUNC('week', "createdAt") = :cohort_week
              AND "userId" IS NOT NULL
        """), {"tenant_id": tenant_id, "cohort_week": cohort_week_dt}).fetchall()
        user_ids = [u[0] for u in cohort_users]

        if not user_ids:
            continue

        for window_days, window_label in [(1, "d1"), (7, "d7"), (30, "d30")]:
            window_start = cohort_week_dt + timedelta(days=window_days - 1)
            window_end = cohort_week_dt + timedelta(days=window_days)

            retained = db.execute(text("""
                SELECT COUNT(DISTINCT "userId")
                FROM analytics_events
                WHERE "tenantId" = :tenant_id
                  AND "userId" = ANY(ARRAY[:user_ids])
                  AND "createdAt" >= :window_start
                  AND "createdAt" < :window_end
                  AND event != 'signed_up'
            """), {
                "tenant_id": tenant_id,
                "user_ids": user_ids,
                "window_start": window_start,
                "window_end": window_end,
            }).scalar() or 0

            rate = round((retained / cohort_size) * 100, 2)
            metric_name = f"retention_{window_label}"
            dims = {"cohort_week": cohort_week_str}

            _upsert_snapshot(db, tenant_id, metric_name, "WEEKLY", cohort_week_dt, rate, dims)

        # Cache all D1/D7/D30 for this tenant
        _cache_set(r, tenant_id, "retention_d1", "WEEKLY", {"cohort_week": cohort_week_str})


# ── 3. Funnel — Sequential event conversion ───────────────────────────────────
FUNNEL_STEPS = [
    ("signed_up", "Signed Up"),
    ("doc_uploaded", "Doc Uploaded"),
    ("chat_sent", "Chat Sent"),
    ("subscription_created", "Subscription Created"),
]


def compute_funnel(db, r: redis_lib.Redis) -> None:
    logger.info("Computing funnel conversions")

    # Get distinct tenantIds
    tenant_rows = db.execute(text("""
        SELECT DISTINCT "tenantId" FROM analytics_events
    """)).fetchall()

    for (tenant_id,) in tenant_rows:
        today = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)

        step_data = []
        for event, label in FUNNEL_STEPS:
            count = db.execute(text("""
                SELECT COUNT(DISTINCT "userId")
                FROM analytics_events
                WHERE "tenantId" = :tenant_id
                  AND event = :event
                  AND "userId" IS NOT NULL
            """), {"tenant_id": tenant_id, "event": event}).scalar() or 0

            step_data.append({"step": event, "label": label, "count": int(count)})

            dims = {"step": event, "label": label}
            _upsert_snapshot(db, tenant_id, "funnel", "DAILY", today, float(count), dims)

        _cache_set(r, tenant_id, "funnel", "DAILY", step_data)
        logger.info(f"Funnel [{tenant_id}]: {step_data}")


# ── 4. Churn Risk Detection ───────────────────────────────────────────────────
def compute_churn_risk(db) -> None:
    logger.info("Computing churn risk")
    cutoff = datetime.now(timezone.utc) - timedelta(days=14)

    # Users with active subscriptions who haven't had any events in 14 days
    at_risk = db.execute(text("""
        SELECT DISTINCT u.id AS user_id, u."tenantId"
        FROM users u
        WHERE u."subscriptionStatus" = 'ACTIVE'
          AND NOT EXISTS (
            SELECT 1 FROM analytics_events ae
            WHERE ae."userId" = u.id
              AND ae."createdAt" >= :cutoff
          )
    """), {"cutoff": cutoff}).fetchall()

    if not at_risk:
        logger.info("No churn-risk users found")
        return

    logger.warning(f"Found {len(at_risk)} churn-risk users. Dispatching notifications...")

    nestjs_url = f"{settings.NESTJS_API_URL}/internal/notifications/churn"
    for (user_id, tenant_id) in at_risk:
        try:
            # Sync HTTP call — acceptable for background cron
            import requests
            requests.post(nestjs_url, json={
                "userId": user_id,
                "tenantId": tenant_id,
                "score": "high",
                "reason": "No events in last 14 days",
            }, timeout=5)
            logger.info(f"Churn notification dispatched for user {user_id} (tenant {tenant_id})")
        except Exception as exc:
            logger.error(f"Failed to dispatch churn notification for user {user_id}: {exc}")


# ── Main cron entry point ─────────────────────────────────────────────────────
def run_bi_cron() -> None:
    """Main hourly BI cron. Called by APScheduler."""
    logger.info("=== BI Cron started ===")
    db = _Session()
    r = _get_redis()

    try:
        compute_dau(db, r)
        compute_retention(db, r)
        compute_funnel(db, r)
        compute_churn_risk(db)
    except Exception as exc:
        logger.error(f"BI cron error: {exc}")
    finally:
        db.close()

    logger.info("=== BI Cron complete ===")
