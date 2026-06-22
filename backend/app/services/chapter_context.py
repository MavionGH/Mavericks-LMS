"""Build rich context for AI interview/quiz from chapter content.

Strategy:
  1. If a query is provided, use RAG vector search for relevant chunks
  2. Fall back to raw content concatenation if vector search fails or
     returns no results (e.g. fresh chapter with no embeddings yet)
"""
import logging
from typing import Optional

from sqlalchemy.orm import Session

from app.models.models import Chapter

logger = logging.getLogger(__name__)


def build_chapter_context(
    chapter: Chapter,
    query: Optional[str] = None,
    db: Optional[Session] = None,
    top_k: int = 8,
) -> str:
    """Build context string for a chapter.

    If db and query are provided, retrieves top-k relevant chunks via
    vector similarity. Falls back to full raw content otherwise.
    """
    # ── Try RAG retrieval first ──────────────────────────────────────
    if db and query:
        try:
            from app.services.embeddings import retrieve_relevant_chunks
            chunks = retrieve_relevant_chunks(
                db=db,
                query=query,
                chapter_id=chapter.id,
                top_k=top_k,
            )
            if chunks:
                rag_context = (
                    f"# Module: {chapter.title}\n\n"
                    f"## Relevant Content Excerpts\n\n"
                )
                for i, c in enumerate(chunks, 1):
                    rag_context += f"### Excerpt {i}\n{c['chunk_text']}\n\n"
                logger.info(
                    f"RAG context built for chapter {chapter.id}: "
                    f"{len(chunks)} chunks, {len(rag_context)} chars"
                )
                return rag_context
        except Exception as e:
            logger.warning(f"RAG retrieval failed, falling back to raw content: {e}")

    # ── Fallback: raw concatenation (original behavior) ──────────────
    parts = [
        f"# Module: {chapter.title}",
        f"\n## Article Content\n{chapter.article_content}",
    ]
    if chapter.video_transcript:
        parts.append(f"\n## Video Transcript\n{chapter.video_transcript}")
    if chapter.youtube_url:
        parts.append(f"\n## Video URL\n{chapter.youtube_url}")
    return "\n".join(parts)


def build_course_context(
    db: Session,
    course_id: str,
    query: str,
    top_k: int = 10,
) -> str:
    """Build context from all chapters in a course via RAG.

    Used for the final course-wide interview (Phase 5).
    Retrieves chunks proportionally across all chapters.
    """
    try:
        from app.services.embeddings import retrieve_relevant_chunks
        chunks = retrieve_relevant_chunks(
            db=db,
            query=query,
            course_id=course_id,
            top_k=top_k,
        )
        if chunks:
            context = "# Course-Wide Content (Multiple Modules)\n\n"
            # Group by chapter for clarity
            by_chapter = {}
            for c in chunks:
                by_chapter.setdefault(c["chapter_id"], []).append(c)

            for ch_id, ch_chunks in by_chapter.items():
                context += f"## Module Excerpts (chapter {ch_id[:8]}…)\n\n"
                for c in ch_chunks:
                    context += f"{c['chunk_text']}\n\n"

            return context
    except Exception as e:
        logger.warning(f"Course-wide RAG failed: {e}")

    return f"# Course {course_id}\n\nNo context available."
