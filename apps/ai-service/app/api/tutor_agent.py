import json
import logging
import uuid
from datetime import datetime, timezone, timedelta
from typing import List, Optional
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings
from app.db.models import StudyPlan, StudyTask, TutorInsight
from app.services.analytics import build_summary, get_weak_topics

logger = logging.getLogger(__name__)
router = APIRouter()

# DB session
_db_url = settings.DATABASE_URL
if _db_url.startswith("postgresql://"):
    _db_url = _db_url.replace("postgresql://", "postgresql+psycopg2://", 1)
_engine = create_engine(_db_url, pool_pre_ping=True)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)

_HAS_GEMINI = bool(
    settings.GEMINI_API_KEY
    and settings.GEMINI_API_KEY != "your_gemini_api_key_here"
    and settings.GEMINI_API_KEY.strip()
)

# --- Schemas ---

class TopicMasteryInput(BaseModel):
    topic: str
    score: float
    status: str  # strong | medium | weak

class TutorPlanRequest(BaseModel):
    userId: str
    timeAvailability: int  # in minutes per day
    masteryScores: List[TopicMasteryInput]

# Output Schemas
class TutorTaskMetadata(BaseModel):
    topic: str
    description: str

class TutorTaskItem(BaseModel):
    type: str  # QUIZ | FLASHCARD | READING | REVISION
    estimatedTime: int
    metadata: TutorTaskMetadata

class DailyScheduleItem(BaseModel):
    day: int  # 1 to 7
    tasks: List[TutorTaskItem]

class TutorInsightItem(BaseModel):
    insightText: str
    priorityLevel: str  # HIGH | MEDIUM | LOW

class WeeklyStudyPlanResponse(BaseModel):
    schedule: List[DailyScheduleItem]
    insights: List[TutorInsightItem]


# --- Endpoints ---

@router.post("/tutor/plan/generate", response_model=WeeklyStudyPlanResponse)
async def generate_tutor_plan(req: TutorPlanRequest):
    logger.info(f"Generating weekly study plan for user {req.userId} (daily time limit: {req.timeAvailability} min)...")

    # Format mastery text
    mastery_text = "\n".join([
        f"- {m.topic}: {m.score}% mastery (Status: {m.status})"
        for m in req.masteryScores
    ])

    has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here" and settings.GEMINI_API_KEY.strip() != "")

    if not has_gemini:
        # Mock Study Plan generation logic
        logger.info("GEMINI_API_KEY is missing. Generating mock weekly study plan.")
        
        # Determine weak areas
        weak_topics = [m.topic for m in req.masteryScores if m.score < 50 or m.status == "weak"]
        focus_topic = weak_topics[0] if weak_topics else (req.masteryScores[0].topic if req.masteryScores else "Core Concepts")

        schedule = []
        for day in range(1, 8):
            day_tasks = []
            
            # Divide time availability across 2 tasks
            task_time = max(req.timeAvailability // 2, 20)
            
            if day in [1, 3, 5]:
                day_tasks.append(TutorTaskItem(
                    type="READING",
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(
                        topic=focus_topic,
                        description=f"Read document chapters related to: '{focus_topic}'"
                    )
                ))
                day_tasks.append(TutorTaskItem(
                    type="FLASHCARD",
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(
                        topic=focus_topic,
                        description=f"Review flashcard recall terms for: '{focus_topic}'"
                    )
                ))
            elif day in [2, 4]:
                day_tasks.append(TutorTaskItem(
                    type="REVISION",
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(
                        topic=focus_topic,
                        description=f"Review summaries and resolve weak points for: '{focus_topic}'"
                    )
                ))
                day_tasks.append(TutorTaskItem(
                    type="QUIZ",
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(
                        topic=focus_topic,
                        description=f"Take a conceptual quiz to test your '{focus_topic}' progress"
                    )
                ))
            else: # Day 6, 7 (Weekend recovery / review)
                day_tasks.append(TutorTaskItem(
                    type="REVISION",
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(
                        topic="Comprehensive Recap",
                        description="Brief recap of all focus study items this week."
                    )
                ))

            schedule.append(DailyScheduleItem(day=day, tasks=day_tasks))

        insights = [
            TutorInsightItem(
                insightText=f"Priority study focus: '{focus_topic}' due to lower mastery scores.",
                priorityLevel="HIGH" if weak_topics else "MEDIUM"
            ),
            TutorInsightItem(
                insightText=f"Daily workload set to {req.timeAvailability} minutes.",
                priorityLevel="LOW"
            )
        ]

        return WeeklyStudyPlanResponse(schedule=schedule, insights=insights)

    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)

        # 2. Compile prompt for Gemini
        prompt = f"""You are an advanced AI Tutor Agent. Your task is to design a personalized 7-day study plan (Day 1 to 7) for a student.

Student Profile:
- Available time per day: {req.timeAvailability} minutes
- Current Topic Mastery Ratings:
{mastery_text}

Design rules:
1. Prioritize weak topics (mastery < 50% or status = 'weak') immediately in Day 1-3.
2. Group study tasks into four main types: QUIZ, FLASHCARD, READING, and REVISION.
3. Ensure the total estimatedTime of all tasks for any single day does NOT exceed the student's daily timeAvailability limit ({req.timeAvailability} minutes).
4. Balance the schedule: include document reading (READING), review card tests (FLASHCARD), revision summaries (REVISION), and evaluation testing (QUIZ).
5. Generate 2-3 coaching insights (stored in 'insights') with priorityLevel ('HIGH' for critical weak areas, 'MEDIUM' or 'LOW' for general guidance).

You must respond with a JSON object containing a 'schedule' list and 'insights' list matching the requested response schema.
"""

        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": WeeklyStudyPlanResponse
            }
        )

        import json
        result_data = json.loads(response.text)
        
        # Build structured output
        schedule = []
        for day_sched in result_data.get("schedule", []):
            tasks = []
            for t in day_sched.get("tasks", []):
                tasks.append(TutorTaskItem(
                    type=t.get("type", "READING"),
                    estimatedTime=int(t.get("estimatedTime", 30)),
                    metadata=TutorTaskMetadata(
                        topic=t.get("metadata", {}).get("topic", "General"),
                        description=t.get("metadata", {}).get("description", "Study session")
                    )
                ))
            schedule.append(DailyScheduleItem(day=int(day_sched.get("day", 1)), tasks=tasks))

        insights = []
        for ins in result_data.get("insights", []):
            insights.append(TutorInsightItem(
                insightText=ins.get("insightText", ""),
                priorityLevel=ins.get("priorityLevel", "MEDIUM")
            ))

        logger.info(f"Successfully generated study plan for user {req.userId} via Gemini.")
        return WeeklyStudyPlanResponse(schedule=schedule, insights=insights)

    except Exception as e:
        logger.error(f"Gemini tutor plan generation failed: {e}")
        raise HTTPException(status_code=500, detail=f"Gemini tutor plan generation failed: {str(e)}")


# ── Phase 2.1.8 v2: Live analytics + RAG context + persistence ────────────────

class RagChunkInput(BaseModel):
    chunkId: str
    content: str
    documentId: str
    documentTitle: str
    pageNumber: int

class TutorPlanV2Request(BaseModel):
    userId: str
    timeAvailability: int            # minutes per day
    ragChunks: List[RagChunkInput] = []   # RAG-retrieved chunks for weak topics

class StudyPlanV2Response(BaseModel):
    planId: str
    schedule: List[DailyScheduleItem]
    insights: List[TutorInsightItem]
    progressScore: float
    streakDays: int
    weakTopics: list


def _persist_plan(
    user_id: str,
    schedule: List[DailyScheduleItem],
    insights: List[TutorInsightItem],
) -> str:
    """Saves StudyPlan + StudyTask + TutorInsight rows. Returns plan ID."""
    plan_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    db = _Session()
    try:
        plan = StudyPlan(
            id=plan_id,
            userId=user_id,
            tenantId="default",
            weekStart=now,
            weekEnd=now + timedelta(days=6),
            status="ACTIVE",
        )
        db.add(plan)
        for day_sched in schedule:
            for task in day_sched.tasks:
                db.add(StudyTask(
                    id=str(uuid.uuid4()),
                    planId=plan_id,
                    day=day_sched.day,
                    type=task.type,
                    status="PENDING",
                    taskMeta={
                        "topic": task.metadata.topic,
                        "description": task.metadata.description,
                        "estimatedTime": task.estimatedTime,
                    },
                ))
        for ins in insights:
            db.add(TutorInsight(
                id=str(uuid.uuid4()),
                userId=user_id,
                tenantId="default",
                insightText=ins.insightText,
                priorityLevel=ins.priorityLevel,
            ))
        db.commit()
        logger.info(f"[tutor] plan {plan_id} persisted for user={user_id}")
    except Exception as e:
        db.rollback()
        logger.error(f"[tutor] plan persistence failed: {e}")
        plan_id = "unsaved"
    finally:
        db.close()
    return plan_id


@router.post("/tutor/plan/generate/v2", response_model=StudyPlanV2Response)
async def generate_tutor_plan_v2(req: TutorPlanV2Request):
    """
    Phase 2.1.8 – Personalized study plan using:
    - Live progress score, streak, and weak topics from analytics service
    - RAG context chunks for weak-topic revision material
    - Gemini for tailored suggestions (mock fallback if no key)
    - PostgreSQL persistence of the final plan
    """
    logger.info(f"[tutor v2] generating plan for user={req.userId}")

    # 1. Load live analytics
    db = _Session()
    try:
        summary = build_summary(db=db, user_id=req.userId)
        weak_topics = summary.get("weakTopics", [])
        progress_score = summary.get("progressScore", 0.0)
        streak_days = summary.get("streakDays", 0)
    except Exception as e:
        logger.warning(f"[tutor v2] analytics load failed (using empty): {e}")
        weak_topics, progress_score, streak_days = [], 0.0, 0
    finally:
        db.close()

    # 2. Format context from RAG chunks (for revision suggestions)
    rag_context = ""
    if req.ragChunks:
        rag_context = "\n\n".join([
            f"[{c.documentTitle} p.{c.pageNumber}] {c.content[:300]}"
            for c in req.ragChunks[:8]
        ])

    # 3. Format weak topics for prompt / mock
    weak_topic_names = [t["topic"] for t in weak_topics]
    focus_topic = weak_topic_names[0] if weak_topic_names else "Core Concepts"

    mastery_text = "\n".join([
        f"- {t['topic']}: {t['score']:.1f}% ({t['status']})" for t in weak_topics
    ]) or "No mastery data yet."

    # ── Mock path ──────────────────────────────────────────────────────────────
    if not _HAS_GEMINI:
        logger.info("[tutor v2] mock plan (no Gemini key).")
        schedule: List[DailyScheduleItem] = []
        task_time = max(req.timeAvailability // 2, 20)
        type_rotation = ["READING", "FLASHCARD", "REVISION", "QUIZ", "REVISION", "READING", "QUIZ"]
        for day in range(1, 8):
            t_type = type_rotation[day - 1]
            desc = (
                f"RAG-guided revision: {req.ragChunks[0].documentTitle}" if req.ragChunks and day <= 3
                else f"Study session on '{focus_topic}'"
            )
            schedule.append(DailyScheduleItem(day=day, tasks=[
                TutorTaskItem(
                    type=t_type,
                    estimatedTime=task_time,
                    metadata=TutorTaskMetadata(topic=focus_topic, description=desc),
                )
            ]))
        insights = [
            TutorInsightItem(
                insightText=f"Progress score: {progress_score:.1f}% | Streak: {streak_days} days.",
                priorityLevel="MEDIUM",
            ),
            TutorInsightItem(
                insightText=f"Focus on '{focus_topic}' — lowest mastery detected." if weak_topic_names
                            else "Strong across all topics. Maintain momentum!",
                priorityLevel="HIGH" if weak_topic_names else "LOW",
            ),
        ]
        plan_id = _persist_plan(req.userId, schedule, insights)
        return StudyPlanV2Response(
            planId=plan_id, schedule=schedule, insights=insights,
            progressScore=progress_score, streakDays=streak_days, weakTopics=weak_topics,
        )

    # ── Gemini path ────────────────────────────────────────────────────────────
    try:
        genai.configure(api_key=settings.GEMINI_API_KEY)
        prompt = f"""You are an advanced AI Tutor Agent. Create a personalized 7-day study plan (Day 1–7).

Student Analytics:
- Progress score: {progress_score:.1f}%
- Current streak: {streak_days} days
- Daily time available: {req.timeAvailability} minutes

Weak Topic Mastery:
{mastery_text}

RAG Document Context (use these for revision tasks):
{rag_context if rag_context else "No document context provided."}

Rules:
1. Prioritize weak topics in Day 1–3 using REVISION and FLASHCARD tasks.
2. Add QUIZ tasks on Day 4 and 6 to test progress.
3. Total estimatedTime per day must NOT exceed {req.timeAvailability} minutes.
4. Reference specific document titles from RAG context in REVISION task descriptions.
5. Generate 2–3 coaching insights with priorityLevel HIGH/MEDIUM/LOW.

Respond with JSON: {{"schedule": [{{"day":1,"tasks":[{{"type":"...","estimatedTime":30,"metadata":{{"topic":"...","description":"..."}}}}]}}],"insights":[{{"insightText":"...","priorityLevel":"HIGH"}}]}}
"""
        model = genai.GenerativeModel("gemini-1.5-flash")
        response = model.generate_content(
            prompt,
            generation_config={
                "response_mime_type": "application/json",
                "response_schema": WeeklyStudyPlanResponse,
            },
        )
        result = json.loads(response.text)
        schedule = [
            DailyScheduleItem(
                day=int(d.get("day", i + 1)),
                tasks=[
                    TutorTaskItem(
                        type=t.get("type", "READING"),
                        estimatedTime=int(t.get("estimatedTime", 30)),
                        metadata=TutorTaskMetadata(
                            topic=t.get("metadata", {}).get("topic", focus_topic),
                            description=t.get("metadata", {}).get("description", ""),
                        ),
                    )
                    for t in d.get("tasks", [])
                ],
            )
            for i, d in enumerate(result.get("schedule", []))
        ]
        insights = [
            TutorInsightItem(
                insightText=ins.get("insightText", ""),
                priorityLevel=ins.get("priorityLevel", "MEDIUM"),
            )
            for ins in result.get("insights", [])
        ]
        plan_id = _persist_plan(req.userId, schedule, insights)
        logger.info(f"[tutor v2] Gemini plan generated and persisted ({plan_id}).")
        return StudyPlanV2Response(
            planId=plan_id, schedule=schedule, insights=insights,
            progressScore=progress_score, streakDays=streak_days, weakTopics=weak_topics,
        )
    except Exception as e:
        logger.error(f"[tutor v2] Gemini plan failed: {e}")
        raise HTTPException(status_code=500, detail=f"Tutor plan v2 failed: {e}")

