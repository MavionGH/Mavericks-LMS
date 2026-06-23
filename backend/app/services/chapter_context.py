"""Build rich context for AI prompts from chapter content."""
from typing import Optional

from app.models.models import Chapter

import logging
logger = logging.getLogger(__name__)


def build_chapter_context(
    chapter: Chapter,
    query: Optional[str] = None,
    db=None,
) -> str:
    """
    Build a context string for LLM prompts.

    When db is provided, retrieves the most relevant chunks via pgvector cosine
    similarity (RAG). Falls back to raw text concatenation when embeddings are
    not yet available or the vector search fails.
    """
    if db is not None:
        try:
            from app.services.embeddings import retrieve_relevant_chunks
            chunks = retrieve_relevant_chunks(chapter.id, query or chapter.title, db)
            if chunks:
                return f"# Module: {chapter.title}\n\n" + "\n\n---\n\n".join(chunks)
        except Exception:
            pass

    parts = [
        f"# Module: {chapter.title}",
        f"\n## Article Content\n{chapter.article_content}",
    ]
    if chapter.video_transcript:
        parts.append(f"\n## Video Transcript\n{chapter.video_transcript}")
    return "\n".join(parts)
