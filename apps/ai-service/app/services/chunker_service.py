import logging
import re
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

class ChunkingService:
    """
    ChunkingService splits parsed segments/sections into semantically meaningful chunks
    based on sentence boundaries.
    Enforces a max limit of 512 tokens (using an approximation of 1 token ≈ 4 characters,
    or 512 tokens ≈ 2048 characters) and a 10% overlap (approx 200 characters).
    Preserves pageRef per chunk.
    """

    def __init__(self, max_tokens: int = 512, overlap_pct: float = 0.10):
        self.max_tokens = max_tokens
        # 1 token ≈ 4 characters. Max tokens 512 ≈ 2048 characters.
        self.max_chars = max_tokens * 4
        self.overlap_chars = int(self.max_chars * overlap_pct)

    def chunk_segments(self, segments: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Receives a list of parsed segments: list of {text, pageRef, sectionTitle}
        Applies sentence boundary splitting and overlapping sliding window.
        Returns a list of structured chunks: {chunkIndex, content, tokenCount, metadata: {source_pages, section_title}}
        """
        logger.info(f"Chunking {len(segments)} segments...")
        chunks = []
        chunk_index = 0

        for segment in segments:
            text = segment.get("text", "").strip()
            if not text:
                continue

            page_ref = segment.get("pageRef", 1)
            section_title = segment.get("sectionTitle")

            # Split into sentences using a regex pattern
            sentences = re.split(r'(?<=[.!?])\s+', text)
            
            current_chunk_sentences = []
            current_chunk_len = 0

            for sentence in sentences:
                sentence_len = len(sentence)
                
                # If a single sentence exceeds the max chunk size, we must force-split it
                if sentence_len > self.max_chars:
                    # Flush current chunk sentences first
                    if current_chunk_sentences:
                        chunk_content = " ".join(current_chunk_sentences)
                        chunks.append(self._build_chunk_dict(chunk_index, chunk_content, page_ref, section_title))
                        chunk_index += 1
                        current_chunk_sentences = []
                        current_chunk_len = 0

                    # Splitting long sentence by sliding window
                    start = 0
                    while start < sentence_len:
                        end = min(start + self.max_chars, sentence_len)
                        force_sub_text = sentence[start:end]
                        chunks.append(self._build_chunk_dict(chunk_index, force_sub_text, page_ref, section_title))
                        chunk_index += 1
                        start += (self.max_chars - self.overlap_chars)
                    continue

                # Normal sentence accumulation
                if current_chunk_len + sentence_len + 1 > self.max_chars:
                    # Flush current chunk
                    chunk_content = " ".join(current_chunk_sentences)
                    chunks.append(self._build_chunk_dict(chunk_index, chunk_content, page_ref, section_title))
                    chunk_index += 1

                    # Semantic overlap: keep sentences from the end of the previous chunk
                    # that fit within the overlap window
                    overlap_sentences = []
                    overlap_len = 0
                    for prev_sentence in reversed(current_chunk_sentences):
                        if overlap_len + len(prev_sentence) + 1 <= self.overlap_chars:
                            overlap_sentences.insert(0, prev_sentence)
                            overlap_len += len(prev_sentence) + 1
                        else:
                            break

                    current_chunk_sentences = overlap_sentences + [sentence]
                    current_chunk_len = sum(len(s) for s in current_chunk_sentences) + len(current_chunk_sentences) - 1
                else:
                    current_chunk_sentences.append(sentence)
                    current_chunk_len += sentence_len + (1 if current_chunk_len > 0 else 0)

            # Flush any remaining sentences in current segment
            if current_chunk_sentences:
                chunk_content = " ".join(current_chunk_sentences)
                chunks.append(self._build_chunk_dict(chunk_index, chunk_content, page_ref, section_title))
                chunk_index += 1

        logger.info(f"Generated {len(chunks)} chunks from segments.")
        return chunks

    def _build_chunk_dict(self, index: int, content: str, page_ref: int, section_title: Optional[str]) -> Dict[str, Any]:
        token_estimate = max(1, len(content) // 4)
        return {
            "chunkIndex": index,
            "content": content,
            "tokenCount": token_estimate,
            "metadata": {
                "source_pages": [page_ref],
                "section_title": section_title
            }
        }
