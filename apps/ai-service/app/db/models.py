from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, JSON, Float
from sqlalchemy.orm import declarative_base, relationship
from datetime import datetime

Base = declarative_base()

class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True)
    email = Column(String, unique=True, nullable=False)
    password = Column(String, nullable=False)
    name = Column(String, nullable=True)
    avatar = Column(String, nullable=True)
    role = Column(String, default="STUDENT")
    subscriptionPlan = Column(String, default="FREE")
    isActive = Column(Boolean, default=True)
    createdAt = Column(DateTime, default=datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    documents = relationship("Document", back_populates="user", cascade="all, delete-orphan")


class Document(Base):
    __tablename__ = "documents"

    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    title = Column(String, nullable=False)
    originalName = Column(String, nullable=False)
    fileType = Column(String, nullable=False)
    mimeType = Column(String, nullable=False)
    fileSize = Column(Integer, nullable=False)
    fileUrl = Column(String, nullable=False)
    storageKey = Column(String, nullable=False)
    status = Column(String, default="UPLOADED")
    pageCount = Column(Integer, default=0)
    extractedTextLength = Column(Integer, nullable=True)
    processingStartedAt = Column(DateTime, nullable=True)
    processingCompletedAt = Column(DateTime, nullable=True)
    processingError = Column(String, nullable=True)
    createdAt = Column(DateTime, default=datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    user = relationship("User", back_populates="documents")
    chunks = relationship("DocumentChunk", back_populates="document", cascade="all, delete-orphan")


class DocumentChunk(Base):
    __tablename__ = "document_chunks"

    id = Column(String, primary_key=True)
    documentId = Column(String, ForeignKey("documents.id", ondelete="CASCADE"), nullable=False)
    chunkIndex = Column(Integer, nullable=False)
    content = Column(Text, nullable=False)
    tokenCount = Column(Integer, nullable=False)
    meta = Column("metadata", JSON, nullable=False, default={})
    embeddingStatus = Column(String, default="PENDING")
    embeddingCreatedAt = Column(DateTime, nullable=True)
    createdAt = Column(DateTime, default=datetime.utcnow)

    document = relationship("Document", back_populates="chunks")


# ── Phase 2.1.6 — Quiz & Flashcard Storage ────────────────────────────────────

class Quiz(Base):
    __tablename__ = "quizzes"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    conversationId = Column(String, nullable=True)
    title = Column(String, nullable=False)
    difficulty = Column(String, nullable=False)
    createdAt = Column(DateTime, default=datetime.utcnow)

    questions = relationship("StoredQuizQuestion", back_populates="quiz", cascade="all, delete-orphan")


class StoredQuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(String, primary_key=True)
    quizId = Column(String, ForeignKey("quizzes.id", ondelete="CASCADE"), nullable=False)
    type = Column(String, nullable=False)          # MCQ | TRUE_FALSE | SHORT_ANSWER
    question = Column(Text, nullable=False)
    options = Column(JSON, nullable=True)           # list[str] for MCQ / TRUE_FALSE
    answer = Column(Text, nullable=False)
    explanation = Column(Text, nullable=False)
    chunkIdSource = Column(String, nullable=False)

    quiz = relationship("Quiz", back_populates="questions")


class FlashcardDeck(Base):
    __tablename__ = "flashcard_decks"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    conversationId = Column(String, nullable=True)
    title = Column(String, nullable=False)
    createdAt = Column(DateTime, default=datetime.utcnow)

    flashcards = relationship("StoredFlashcard", back_populates="deck", cascade="all, delete-orphan")


class StoredFlashcard(Base):
    __tablename__ = "flashcards"

    id = Column(String, primary_key=True)
    deckId = Column(String, ForeignKey("flashcard_decks.id", ondelete="CASCADE"), nullable=False)
    front = Column(Text, nullable=False)
    back = Column(Text, nullable=False)
    chunkIdSource = Column(String, nullable=False)
    tags = Column(JSON, nullable=True)
    createdAt = Column(DateTime, default=datetime.utcnow)

    deck = relationship("FlashcardDeck", back_populates="flashcards")


# ── Phase 2.1.7 — Study Analytics Storage ─────────────────────────────────────

class AnalyticsEvent(Base):
    """
    Raw event log: one row per user action (chat_message, quiz_attempt,
    flashcard_review, document_open, rag_search).
    Maps to the existing 'usage_metrics' table in the Prisma schema.
    """
    __tablename__ = "usage_metrics"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    endpoint = Column(String, nullable=False)   # event type / source endpoint
    tokensIn = Column(Integer, default=0)
    tokensOut = Column(Integer, default=0)
    latencyMs = Column(Integer, default=0)
    cacheHit = Column(Boolean, default=False)
    model = Column(String, nullable=True)
    createdAt = Column(DateTime, default=datetime.utcnow)


class QuizAttempt(Base):
    """
    Records score and outcomes each time a user completes a quiz.
    Maps to the existing 'quiz_attempts' table in the Prisma schema.
    """
    __tablename__ = "quiz_attempts"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    quizId = Column(String, nullable=False)
    score = Column(Float, nullable=False)          # 0.0 – 100.0
    correctAnswers = Column(Integer, nullable=False)
    wrongAnswers = Column(Integer, nullable=False)
    createdAt = Column(DateTime, default=datetime.utcnow)


class FlashcardReview(Base):
    """
    Records each flashcard review outcome (easy | hard | fail).
    Maps to the existing 'flashcard_reviews' table in the Prisma schema.
    """
    __tablename__ = "flashcard_reviews"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    flashcardId = Column(String, nullable=False)
    recallStatus = Column(String, nullable=False)  # easy | hard | fail
    createdAt = Column(DateTime, default=datetime.utcnow)


class MasteryScore(Base):
    """
    Computed per-topic mastery score per user.
    Maps to the existing 'mastery_scores' table in the Prisma schema.
    """
    __tablename__ = "mastery_scores"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    topic = Column(String, nullable=False)
    documentId = Column(String, nullable=True)
    score = Column(Float, nullable=False, default=0.0)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


# ── Phase 2.1.8 — Tutor Agent / Study Planner Storage ─────────────────────────

class StudyPlan(Base):
    """7-day generated study plan. Maps to 'study_plans' Prisma table."""
    __tablename__ = "study_plans"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    weekStart = Column(DateTime, nullable=False)
    weekEnd = Column(DateTime, nullable=False)
    status = Column(String, default="ACTIVE")   # ACTIVE | COMPLETED | ARCHIVED
    createdAt = Column(DateTime, default=datetime.utcnow)

    tasks = relationship("StudyTask", back_populates="plan", cascade="all, delete-orphan")


class StudyTask(Base):
    """Individual daily task within a study plan. Maps to 'study_tasks' Prisma table."""
    __tablename__ = "study_tasks"

    id = Column(String, primary_key=True)
    planId = Column(String, ForeignKey("study_plans.id", ondelete="CASCADE"), nullable=False)
    day = Column(Integer, nullable=False)        # 1–7
    type = Column(String, nullable=False)        # QUIZ | FLASHCARD | READING | REVISION
    status = Column(String, default="PENDING")   # PENDING | COMPLETED | MISSED
    taskMeta = Column("metadata", JSON, nullable=False, default={})  # 'metadata' is reserved by SA
    createdAt = Column(DateTime, default=datetime.utcnow)

    plan = relationship("StudyPlan", back_populates="tasks")


class TutorInsight(Base):
    """Coaching insight generated alongside a study plan. Maps to 'tutor_insights' Prisma table."""
    __tablename__ = "tutor_insights"

    id = Column(String, primary_key=True)
    userId = Column(String, nullable=False)
    tenantId = Column(String, nullable=False, default="default")
    insightText = Column(Text, nullable=False)
    priorityLevel = Column(String, nullable=False)   # HIGH | MEDIUM | LOW
    createdAt = Column(DateTime, default=datetime.utcnow)


# ── Phase 2.1.9 — Knowledge Graph Storage ─────────────────────────────────────

class Concept(Base):
    """
    A unique educational concept node per tenant.
    Maps to 'concepts' Prisma table.
    Unique constraint: (tenantId, name).
    """
    __tablename__ = "concepts"

    id = Column(String, primary_key=True)
    tenantId = Column(String, nullable=False)
    name = Column(String, nullable=False)          # normalized lowercase
    displayName = Column(String, nullable=False)   # original casing
    description = Column(Text, nullable=True)
    confidence = Column(Float, nullable=False, default=1.0)
    createdAt = Column(DateTime, default=datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ConceptRelation(Base):
    """
    A directed typed edge between two concept nodes.
    Maps to 'concept_relations' Prisma table.
    Unique constraint: (tenantId, fromConceptId, toConceptId, relationType).
    """
    __tablename__ = "concept_relations"

    id = Column(String, primary_key=True)
    tenantId = Column(String, nullable=False)
    fromConceptId = Column(String, ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False)
    toConceptId = Column(String, ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False)
    relationType = Column(String, nullable=False)  # EXPLAINS | RELATED_TO | PREREQUISITE_OF | PART_OF
    weight = Column(Float, nullable=False, default=1.0)
    createdAt = Column(DateTime, default=datetime.utcnow)


class ChunkConceptMap(Base):
    """
    Many-to-many mapping: which chunk contributed to which concept.
    Maps to 'chunk_concept_maps' Prisma table.
    Unique constraint: (chunkId, conceptId).
    """
    __tablename__ = "chunk_concept_maps"

    id = Column(String, primary_key=True)
    chunkId = Column(String, nullable=False)       # logical FK to document_chunks.id
    conceptId = Column(String, ForeignKey("concepts.id", ondelete="CASCADE"), nullable=False)
    tenantId = Column(String, nullable=False)
    confidence = Column(Float, nullable=False, default=1.0)
    createdAt = Column(DateTime, default=datetime.utcnow)


class VoiceSession(Base):
    """
    Voice session model storing state, STT text, and TTS output keys.
    Maps to 'voice_sessions' table.
    """
    __tablename__ = "voice_sessions"

    id = Column(String, primary_key=True)
    userId = Column(String, ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    orgId = Column(String, nullable=True)
    sessionId = Column(String, unique=True, nullable=False)
    status = Column(String, default="PENDING")   # PENDING | STT | RAG | TTS | READY | FAILED | PURGED
    sttText = Column(Text, nullable=True)
    ttsAudioKey = Column(Text, nullable=True)
    durationMs = Column(Integer, nullable=True)
    createdAt = Column(DateTime, default=datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ModerationRule(Base):
    __tablename__ = "moderation_rules"

    id = Column(String, primary_key=True)
    tenantId = Column(String, nullable=False)
    category = Column(String, nullable=False)
    threshold = Column(Float, nullable=False)
    action = Column(String, nullable=False)
    createdAt = Column(DateTime, default=datetime.utcnow)
    updatedAt = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)


class ModerationLog(Base):
    __tablename__ = "moderation_logs"

    id = Column(String, primary_key=True)
    tenantId = Column(String, nullable=False)
    orgId = Column(String, nullable=True)
    contentId = Column(String, nullable=False)
    contentType = Column(String, nullable=False)
    verdict = Column(Boolean, nullable=False)
    scores = Column(JSON, nullable=False)
    action = Column(String, nullable=False)
    createdAt = Column(DateTime, default=datetime.utcnow)






