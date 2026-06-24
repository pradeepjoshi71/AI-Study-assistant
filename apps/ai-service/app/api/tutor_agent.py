import logging
from typing import List
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)
router = APIRouter()

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
