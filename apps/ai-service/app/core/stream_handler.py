import logging
import json
import asyncio
from typing import AsyncGenerator, List, Dict, Any
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)

class StreamHandler:
    def __init__(self, api_key: str):
        self.api_key = api_key
        self.has_gemini = bool(api_key and api_key != "your_gemini_api_key_here")
        if self.has_gemini:
            genai.configure(api_key=api_key)
            logger.info("StreamHandler initialized with Gemini API Key.")
        else:
            logger.warning("StreamHandler initialized in Mock mode: missing Gemini API Key.")

    async def stream_rag(
        self,
        system_prompt: str,
        message: str,
        history: List[Dict[str, str]],
        citations: List[Dict[str, Any]]
    ) -> AsyncGenerator[str, None]:
        """
        Generates real-time SSE stream events for RAG Q&A.
        Emits:
        - event: citation (grounded retrieval mappings)
        - event: token (tokens from the LLM)
        - event: done (finishing metadata)
        """
        # 1. First yield all citation events separately (as per citation streaming rule)
        logger.info(f"Streaming {len(citations)} citations...")
        for cite in citations:
            yield f"event: citation\ndata: {json.dumps(cite)}\n\n"
            await asyncio.sleep(0.01) # Small sleep to avoid buffer bundling

        if not self.has_gemini:
            # Mock Streaming response
            logger.info("Generating mock streamed response...")
            mock_text = (
                f"Based on the provided context, the answer is grounded. Here is the response to '{message}'. "
                "The documents outline key processes. Refer to matching references [chunk_1] and [chunk_2] for pages."
            )
            for word in mock_text.split():
                yield f"event: token\ndata: {word} \n\n"
                await asyncio.sleep(0.05)
            
            yield f"event: done\ndata: {json.dumps({'message_id': 'mock-id', 'total_tokens': len(mock_text.split())})}\n\n"
            return

        try:
            logger.info("Connecting to Gemini streaming service...")
            contents = []
            
            # Format history for Gemini
            for msg in history:
                role = "user" if msg["role"] == "user" else "model"
                contents.append({"role": role, "parts": [msg["content"]]})
                
            contents.append({"role": "user", "parts": [message]})

            model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                system_instruction=system_prompt
            )

            # Generate stream
            response = model.generate_content(
                contents=contents,
                stream=True
            )

            token_count = 0
            for chunk in response:
                if chunk.text:
                    token_count += 1
                    # Yield incremental tokens
                    yield f"event: token\ndata: {chunk.text}\n\n"
                    # Small yield pause to facilitate event looping on proxy
                    await asyncio.sleep(0.001)

            # Yield done event when stream terminates successfully
            yield f"event: done\ndata: {json.dumps({'message_id': 'gen-id', 'total_tokens': token_count})}\n\n"
            logger.info("Streaming response generated and completed successfully.")

        except Exception as e:
            logger.error(f"Gemini streaming event failed: {e}")
            yield f"event: error\ndata: {str(e)}\n\n"
