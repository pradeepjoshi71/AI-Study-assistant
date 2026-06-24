import logging
from typing import List, Dict, Any

logger = logging.getLogger(__name__)

def generate_chunks(pages: List[Dict[str, Any]], chunk_size: int = 1000, chunk_overlap: int = 200) -> List[Dict[str, Any]]:
    """
    Generates overlapping text chunks from a list of extracted pages,
    tracking character positions and referencing source pages.
    """
    logger.info("Starting semantic text chunking...")
    
    if not pages:
        return []

    # 1. Flatten all pages into a continuous stream, building a page index mapping per character
    full_text = ""
    char_to_page_index = []

    for page in pages:
        page_num = page.get("page_number", 1)
        page_text = page.get("text", "")

        # Join pages with a space separator if necessary
        if full_text and not full_text.endswith(" ") and not page_text.startswith(" "):
            full_text += " "
            char_to_page_index.append(page_num)

        start_pos = len(full_text)
        full_text += page_text
        end_pos = len(full_text)

        for _ in range(start_pos, end_pos):
            char_to_page_index.append(page_num)

    total_characters = len(full_text)
    if total_characters == 0:
        return []

    # 2. Slide window across the text stream
    chunks = []
    start = 0
    chunk_index = 0

    while start < total_characters:
        end = min(start + chunk_size, total_characters)
        content = full_text[start:end]

        # Determine which pages this chunk intersects
        pages_covered = sorted(list(set(char_to_page_index[start:end])))

        # Approximate tokens (1 token is roughly 4 characters)
        token_count = max(1, len(content) // 4)

        chunks.append({
            "chunkIndex": chunk_index,
            "content": content,
            "tokenCount": token_count,
            "metadata": {
                "source_pages": pages_covered,
                "character_start": start,
                "character_end": end,
            }
        })

        chunk_index += 1
        if end >= total_characters:
            break
        
        # Advance window
        start += (chunk_size - chunk_overlap)

    logger.info(f"Generated {len(chunks)} chunks successfully.")
    return chunks
