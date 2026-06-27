"""
Phase 2.1.2 – Prompt Engine
Builds structured system and user prompts for the RAG chat pipeline.
Responsibilities:
- Inject retrieved RAG context into a token-budgeted system prompt
- Append citation instructions so the LLM always grounds answers
- Apply hallucination prevention rules (refuse to answer if context is empty)
- Produce a final user message string from the raw query
"""

from typing import List, Dict, Any

# ── Constants ──────────────────────────────────────────────────────────────────
MAX_CONTEXT_CHARS = 24_000   # ~6 000 tokens at 4 chars/token; leaves room for prompt scaffold
CITATION_TAG_FORMAT = "[source:{doc_id}:p{page}]"

# ── System Prompt Template ─────────────────────────────────────────────────────
_SYSTEM_TEMPLATE = """\
You are an expert AI study assistant. Your sole purpose is to help the student understand and recall information from their uploaded study materials.

## Rules
1. Answer ONLY from the context provided below. Do NOT draw on outside knowledge.
2. If the context does not contain enough information to answer, say:
   "I could not find an answer in your study materials. Please upload more relevant documents."
3. Every factual claim MUST be followed by an inline citation tag in the format {citation_format}.
4. Be concise, structured, and pedagogically helpful.
5. Do NOT hallucinate page numbers, document titles, or facts.

## Retrieved Study Context ({chunk_count} chunks, ~{token_estimate} tokens)
{context}
"""

_EMPTY_CONTEXT_SYSTEM = """\
You are an expert AI study assistant.

No study material context was found for the student's query. \
Politely inform the student that their query returned no relevant content and \
suggest they upload or select the relevant documents before asking.

Do NOT attempt to answer the question from general knowledge.
"""


def build_system_prompt(
    context: str,
    sources: List[Dict[str, Any]],
    pages: List[int],
    chunks: List[Dict[str, Any]],
) -> str:
    """
    Constructs the system prompt injected into the LLM request.

    Args:
        context:  Merged text from ContextBuilderService.
        sources:  List of {documentId, originalName} dicts.
        pages:    Sorted list of referenced page numbers.
        chunks:   Reranked chunk dicts (used for token budget estimation).

    Returns:
        A fully-formatted system prompt string.
    """
    if not context or not context.strip():
        return _EMPTY_CONTEXT_SYSTEM

    # Truncate context to MAX_CONTEXT_CHARS to stay within LLM context window
    truncated_context = context[:MAX_CONTEXT_CHARS]
    if len(context) > MAX_CONTEXT_CHARS:
        truncated_context += "\n\n[...context truncated to fit token budget...]"

    token_estimate = len(truncated_context) // 4
    chunk_count = len(chunks)

    # Append a source legend so the model can produce accurate citation tags
    legend_lines = []
    for src in sources:
        legend_lines.append(
            f"- Document ID {src['documentId']}: \"{src.get('originalName', 'Unknown')}\""
        )
    if legend_lines:
        legend = "\n## Source Legend\n" + "\n".join(legend_lines)
        truncated_context = truncated_context + "\n" + legend

    return _SYSTEM_TEMPLATE.format(
        citation_format=CITATION_TAG_FORMAT,
        chunk_count=chunk_count,
        token_estimate=token_estimate,
        context=truncated_context,
    )


def build_user_message(query: str, pages: List[int]) -> str:
    """
    Wraps the raw student query into a structured user message.

    Args:
        query: The student's original question.
        pages: Page numbers retrieved from the RAG pipeline (for context).

    Returns:
        A formatted user message string.
    """
    page_hint = ""
    if pages:
        page_list = ", ".join(str(p) for p in pages)
        page_hint = f"\n\n(Relevant pages from retrieved context: {page_list})"

    return f"{query}{page_hint}"
