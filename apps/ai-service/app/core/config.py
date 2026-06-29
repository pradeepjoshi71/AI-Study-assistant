from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    PROJECT_NAME: str = "AI Study Assistant - AI Service"
    AI_PORT: int = 8000
    AI_HOST: str = "0.0.0.0"
    
    # Database Connection Settings
    DATABASE_URL: str = "postgresql://postgres:postgres@localhost:5432/study_assistant?schema=public"

    # Redis Connection Settings
    AI_REDIS_HOST: str = "localhost"
    AI_REDIS_PORT: int = 6379
    AI_REDIS_PASSWORD: str = ""

    # Qdrant Vector DB Configuration
    QDRANT_HOST: str = "localhost"
    QDRANT_PORT: int = 6333

    # Google Gemini API Key
    GEMINI_API_KEY: str = ""

    # OpenAI API Key
    OPENAI_API_KEY: str = ""

    model_config = SettingsConfigDict(
        env_file=("../../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore"
    )

settings = Settings()
