import logging
from typing import List, Dict, Any, AsyncGenerator
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)

class LLMOrchestrator:
  def __init__(self):
    self.has_gemini = bool(settings.GEMINI_API_KEY and settings.GEMINI_API_KEY != "your_gemini_api_key_here")
    if self.has_gemini:
      genai.configure(api_key=settings.GEMINI_API_KEY)
      logger.info("Gemini LLM Orchestrator configured successfully.")
    else:
      logger.warning("GEMINI_API_KEY is missing or template value. Running in Mock LLM Mode.")

  async def stream_chat(
    self,
    system_prompt: str,
    message: str,
    history: List[Dict[str, str]]
  ) -> AsyncGenerator[str, None]:
    """
    Streams LLM tokens from Gemini using the system prompt and conversation history.
    """
    if not self.has_gemini:
      # Mock stream generator for testing without key
      mock_response = (
        f"[Mock AI Response] Based on the context provided, here is the answer to your query: '{message}'.\n"
        "According to the documents: the key concepts are clearly laid out in the retrieved materials. "
        "For details, please refer to the specific pages [chunk_mock_1]."
      )
      import asyncio
      for word in mock_response.split():
        yield word + " "
        await asyncio.sleep(0.08)
      return

    try:
      # Build contents structure for Gemini
      contents = []
      
      # 1. Inject history
      for msg in history:
        role = "user" if msg["role"] == "user" else "model"
        contents.append({"role": role, "parts": [msg["content"]]})
        
      # 2. Inject latest message
      contents.append({"role": "user", "parts": [message]})

      # Use gemini-1.5-flash as it is fast, cheap, and supports system instructions
      model = genai.GenerativeModel(
        model_name="gemini-1.5-flash",
        system_instruction=system_prompt
      )

      # Generate stream
      response = model.generate_content(
        contents=contents,
        stream=True
      )

      for chunk in response:
        if chunk.text:
          yield chunk.text

    except Exception as e:
      logger.error(f"Gemini streaming failed: {e}")
      yield f"\n[AI Service Error: {str(e)}]"

  async def summarize(self, messages: List[Dict[str, str]]) -> str:
    """
    Summarizes conversation history using Gemini.
    """
    if not self.has_gemini:
      return "[Mock History Summary] The discussion focused on setup details and verification procedures."

    try:
      history_text = "\n".join([f"{msg['role'].upper()}: {msg['content']}" for msg in messages])
      prompt = f"Summarize the following study session conversation briefly in 2-3 sentences:\n\n{history_text}"
      
      model = genai.GenerativeModel("gemini-1.5-flash")
      response = model.generate_content(prompt)
      return response.text.strip() if response.text else ""
    except Exception as e:
      logger.error(f"Gemini summarization failed: {e}")
      return ""
