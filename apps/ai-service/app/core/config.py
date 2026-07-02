from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "AI Study Assistant - AI Service"
    AI_PORT: int = 8000
    AI_HOST: str = "0.0.0.0"
    NESTJS_API_URL: str = "http://localhost:3001/api/v1"
    
    # Database Connection Settings
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/study_assistant?schema=public"

    # Redis Connection Settings
    AI_REDIS_HOST: str = "localhost"
    AI_REDIS_PORT: int = 6379
    AI_REDIS_PASSWORD: str = ""

    # Qdrant Vector DB Configuration
    QDRANT_HOST: str = "qdrant-node1"
    QDRANT_PORT: int = 6333
    QDRANT_HOST_NODE1: str = "qdrant-node1"
    QDRANT_HOST_NODE2: str = "qdrant-node2"
    SECONDARY_REGION: bool = False
    # Set to True to skip Qdrant connection (e.g. running without Docker)
    QDRANT_SKIP: bool = False
    # Set to True to skip Minio connection (e.g. running without Docker)
    MINIO_SKIP: bool = False


    # Google Gemini API Key
    GEMINI_API_KEY: str = ""

    # OpenAI API Key
    OPENAI_API_KEY: str = ""

    # Minio Object Storage Configuration
    MINIO_ENDPOINT: str = "localhost:9000"
    MINIO_ACCESS_KEY: str = "minioadmin"
    MINIO_SECRET_KEY: str = "minioadmin"
    MINIO_BUCKET: str = "study-assistant"
    MINIO_SECURE: bool = False

    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
