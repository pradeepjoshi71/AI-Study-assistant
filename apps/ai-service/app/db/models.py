from sqlalchemy import Column, String, Integer, Boolean, DateTime, ForeignKey, Text, JSON
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
