import logging
import json
import asyncio
from typing import AsyncGenerator, List, Dict, Any, Optional
import google.generativeai as genai
from app.core.config import settings

logger = logging.getLogger(__name__)

def uppercase_schema_types(schema: Any) -> Any:
    """Gemini API expects uppercase types in schema (e.g. OBJECT, STRING)"""
    if isinstance(schema, dict):
        new_schema = {}
        for k, v in schema.items():
            if k == "type" and isinstance(v, str):
                new_schema[k] = v.upper()
            else:
                new_schema[k] = uppercase_schema_types(v)
        return new_schema
    elif isinstance(schema, list):
        return [uppercase_schema_types(item) for item in schema]
    return schema

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
        history: List[Dict[str, Any]],
        citations: List[Dict[str, Any]],
        tools: Optional[List[Dict[str, Any]]] = None
    ) -> AsyncGenerator[str, None]:
        """
        Generates real-time SSE stream events for RAG Q&A.
        Emits:
        - event: citation (grounded retrieval mappings)
        - event: token (tokens from the LLM)
        - event: tool_call (triggering external tool execution)
        - event: done (finishing metadata)
        """
        # 1. First yield all citation events separately (as per citation streaming rule)
        logger.info(f"Streaming {len(citations)} citations...")
        for cite in citations:
            yield f"event: citation\ndata: {json.dumps(cite)}\n\n"
            await asyncio.sleep(0.01) # Small sleep to avoid buffer bundling

        if not self.has_gemini:
            # Mock Streaming response or mock tool calls
            logger.info("Generating mock streamed response...")
            if message.lower().startswith("run tool") or message.lower().startswith("mock tool"):
                yield f"event: tool_call\ndata: {json.dumps({'name': 'mock_tool', 'args': {'query': message}})}\n\n"
            else:
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
            
            # Format history for Gemini supporting tool call and response structures
            for msg in history:
                role = "user" if msg["role"] == "user" else "model"
                content_str = msg["content"]
                
                try:
                    parsed = json.loads(content_str)
                    if isinstance(parsed, dict) and parsed.get("type") == "tool_call":
                        contents.append({
                            "role": "model",
                            "parts": [{
                                "function_call": {
                                    "name": parsed["name"],
                                    "args": parsed["args"]
                                }
                            }]
                        })
                        continue
                    elif isinstance(parsed, dict) and parsed.get("type") == "tool_response":
                        contents.append({
                            "role": "user",
                            "parts": [{
                                "function_response": {
                                    "name": parsed["name"],
                                    "response": parsed["response"]
                                }
                            }]
                        })
                        continue
                except Exception:
                    pass

                contents.append({"role": role, "parts": [content_str]})
                
            contents.append({"role": "user", "parts": [message]})

            # Prepare tools format
            formatted_tools = None
            if tools:
                declarations = []
                for t in tools:
                    parameters = uppercase_schema_types(t.get("parameters", {}))
                    declarations.append({
                        "name": t["name"],
                        "description": t["description"],
                        "parameters": parameters
                    })
                formatted_tools = [{"function_declarations": declarations}]

            model = genai.GenerativeModel(
                model_name="gemini-1.5-flash",
                system_instruction=system_prompt,
                tools=formatted_tools
            )

            # Generate stream
            response = model.generate_content(
                contents=contents,
                stream=True
            )

            token_count = 0
            for chunk in response:
                # Check for function calling candidates
                if hasattr(chunk, "candidates") and chunk.candidates:
                    parts = chunk.candidates[0].content.parts
                    has_fn = False
                    for part in parts:
                        if part.function_call:
                            has_fn = True
                            logger.info(f"Gemini requested tool call: {part.function_call.name}")
                            yield f"event: tool_call\ndata: {json.dumps({'name': part.function_call.name, 'args': dict(part.function_call.args)})}\n\n"
                    if has_fn:
                        break

                if chunk.text:
                    token_count += 1
                    yield f"event: token\ndata: {chunk.text}\n\n"
                    await asyncio.sleep(0.001)

            # Yield done event when stream terminates successfully
            yield f"event: done\ndata: {json.dumps({'message_id': 'gen-id', 'total_tokens': token_count})}\n\n"
            logger.info("Streaming response generated and completed successfully.")

        except Exception as e:
            logger.error(f"Gemini streaming event failed: {e}")
            yield f"event: error\ndata: {str(e)}\n\n"
