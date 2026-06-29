import logging
import json
import asyncio
import base64
import io
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
        tools: Optional[List[Dict[str, Any]]] = None,
        timeout_seconds: int = 60,
        user_plan: Optional[str] = "FREE",
        chunks: Optional[List[Dict[str, Any]]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generates real-time SSE stream events for RAG Q&A.
        Emits:
        - event: citation  (grounded retrieval mappings)
        - event: token     (tokens from the LLM)
        - event: tool_call (triggering external tool execution)
        - event: keepalive (heartbeat comment to prevent proxy timeouts)
        - event: done      (finishing metadata)
        - event: error     (structured error payload)

        Disconnect: the async generator is abandoned by FastAPI/Starlette when
        the client disconnects; GeneratorExit is caught to log the event cleanly.
        Timeout: wraps the entire LLM call in asyncio.wait_for with timeout_seconds.
        """
        # 1. Emit citation events upfront
        logger.info(f"Streaming {len(citations)} citations...")
        for cite in citations:
            yield f"event: citation\ndata: {json.dumps(cite)}\n\n"
            await asyncio.sleep(0.01)

        # 2. Mock path (no Gemini key)
        if not self.has_gemini:
            logger.info("Generating mock streamed response...")
            if message.lower().startswith("run tool") or message.lower().startswith("mock tool"):
                yield f"event: tool_call\ndata: {json.dumps({'name': 'mock_tool', 'args': {'query': message}})}\n\n"
            else:
                mock_text = (
                    f"Based on the provided context, the answer is grounded. Here is the response to '{message}'. "
                    "The documents outline key processes. Refer to matching references [chunk_1] and [chunk_2] for pages."
                )
                try:
                    for word in mock_text.split():
                        yield f"event: token\ndata: {word} \n\n"
                        await asyncio.sleep(0.05)
                    yield f"event: done\ndata: {json.dumps({'message_id': 'mock-id', 'total_tokens': len(mock_text.split())})}\n\n"
                except GeneratorExit:
                    logger.info("Client disconnected during mock stream.")
            return

        # 3. Real Gemini path with timeout + disconnect handling
        try:
            async def _generate() -> AsyncGenerator[str, None]:
                logger.info("Connecting to Gemini streaming service...")
                contents = []

                for msg in history:
                    role = "user" if msg["role"] == "user" else "model"
                    content_str = msg["content"]
                    try:
                        parsed = json.loads(content_str)
                        if isinstance(parsed, dict) and parsed.get("type") == "tool_call":
                            contents.append({
                                "role": "model",
                                "parts": [{"function_call": {"name": parsed["name"], "args": parsed["args"]}}]
                            })
                            continue
                        elif isinstance(parsed, dict) and parsed.get("type") == "tool_response":
                            contents.append({
                                "role": "user",
                                "parts": [{"function_response": {"name": parsed["name"], "response": parsed["response"]}}]
                            })
                            continue
                    except Exception:
                        pass
                    contents.append({"role": role, "parts": [content_str]})

                user_parts: List[Any] = [message]

                # Check if we have visual chunks and user plan allows visual prompt analysis
                # FREE plan users are restricted to text-only prompts (image inputs are skipped/fall back to captions).
                has_visual_elements = False
                if chunks and user_plan != "FREE":
                    # Filter only IMAGE and DIAGRAM modalities
                    visual_chunks = [
                        c for c in chunks 
                        if (c.get("modality") or "").upper() in ("IMAGE", "DIAGRAM")
                    ]
                    
                    if visual_chunks:
                        # Cap at max 3 images per prompt
                        target_chunks = visual_chunks[:3]
                        
                        # Generate signed URLs and append image blocks to user parts
                        for vc in target_chunks:
                            skey = vc.get("storageKey") or vc.get("storage_key")
                            if skey:
                                try:
                                    from app.services.minio_storage import get_presigned_url
                                    from PIL import Image as PILImage
                                    import httpx
                                    
                                    # Fetch signed download url
                                    signed_url = get_presigned_url(skey)
                                    
                                    # Fetch and process image bytes for Gemini inline data part
                                    resp = httpx.get(signed_url)
                                    if resp.status_code == 200:
                                        img_bytes = resp.content
                                        # Deduce extension, load as PIL to verify image
                                        pil_img = PILImage.open(io.BytesIO(img_bytes))
                                        
                                        user_parts.append({
                                            "inline_data": {
                                                "mime_type": "image/png",
                                                "data": base64.b64encode(img_bytes).decode("utf-8")
                                            }
                                        })
                                        has_visual_elements = True
                                        logger.info(f"Successfully appended visual chunk {skey} to user prompt.")
                                except Exception as img_err:
                                    logger.error(f"Failed to fetch/append visual chunk image: {img_err}")
                
                contents.append({"role": "user", "parts": user_parts})

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

                response = model.generate_content(contents=contents, stream=True)

                token_count = 0
                last_heartbeat = asyncio.get_event_loop().time()
                heartbeat_interval = 15  # seconds

                for chunk in response:
                    # Emit keepalive heartbeat if the LLM is slow to produce tokens
                    now = asyncio.get_event_loop().time()
                    if now - last_heartbeat >= heartbeat_interval:
                        yield ": keepalive\n\n"
                        last_heartbeat = now

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

                yield f"event: done\ndata: {json.dumps({'message_id': 'gen-id', 'total_tokens': token_count})}\n\n"
                logger.info(f"Streaming complete. Tokens emitted: {token_count}")

            # Run the inner generator under a timeout
            try:
                async with asyncio.timeout(timeout_seconds):
                    async for event in _generate():
                        yield event
            except asyncio.TimeoutError:
                logger.error(f"Stream timed out after {timeout_seconds}s.")
                yield f"event: error\ndata: {json.dumps({'code': 'STREAM_TIMEOUT', 'message': f'Response timed out after {timeout_seconds} seconds.'})}\n\n"

        except GeneratorExit:
            logger.info("Client disconnected; stream generator closed.")
        except Exception as e:
            logger.error(f"Gemini streaming event failed: {e}")
            yield f"event: error\ndata: {json.dumps({'code': 'STREAM_ERROR', 'message': str(e)})}\n\n"
