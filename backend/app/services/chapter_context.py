"""Build rich context for AI prompts from chapter content."""
from typing import Optional

from app.models.models import Chapter, Course

import logging
logger = logging.getLogger(__name__)

# Cap raw fallback context so a large multi-module course never blows the prompt.
_MAX_COURSE_CONTEXT_CHARS = 12000


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


def _raw_course_context(course: Course) -> str:
    """Concatenate every module's article + transcript (length-bounded)."""
    sorted_chapters = sorted(course.chapters, key=lambda c: c.order_index)
    parts = [f"# Course: {course.title}"]
    for ch in sorted_chapters:
        parts.append(f"\n## Module: {ch.title}")
        if ch.article_content:
            parts.append(f"\n### Article\n{ch.article_content}")
        if ch.video_transcript:
            parts.append(f"\n### Video Transcript\n{ch.video_transcript}")
    text = "\n".join(parts)
    return text[:_MAX_COURSE_CONTEXT_CHARS]


def build_course_context(
    course: Course,
    query: Optional[str] = None,
    db=None,
) -> str:
    """
    Build a context string spanning ALL modules of a course for the final,
    course-wide AI interview.

    Strategy:
      1. Semantic search across the course's Pinecone namespace (every module's
         embedded video transcript + article) for the chunks most relevant to
         the query.
      2. Fall back to a length-bounded concatenation of every module's raw
         article + transcript when vector search is unavailable or returns
         nothing — so the interviewer always has the full course knowledge base.
    """
    try:
        from app.services.pinecone_store import query_course_content
        chunks = query_course_content(course.id, query or course.title)
        if chunks:
            return (
                f"# Course: {course.title}\n\n"
                "The following are the most relevant excerpts drawn from across "
                "all modules of this course (video transcripts and articles):\n\n"
                + "\n\n---\n\n".join(chunks)
            )
    except Exception as exc:
        logger.warning("Course-wide vector search failed, using raw fallback: %s", exc)

    return _raw_course_context(course)
