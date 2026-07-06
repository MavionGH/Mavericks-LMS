"""Build rich context for AI prompts from chapter content."""
from typing import Optional

from app.models.models import Chapter, Course

import logging
logger = logging.getLogger(__name__)

# Cap raw fallback context so a large multi-module course never blows the prompt.
_MAX_COURSE_CONTEXT_CHARS = 500000


# A single chapter's article + transcript is small enough to hand to the LLM
# whole, so we never need vector retrieval here. Cap it so a pathologically long
# transcript can't blow the prompt (the LLM prompt builders also slice further).
_MAX_CHAPTER_CONTEXT_CHARS = 500000


def build_chapter_context(
    chapter: Chapter,
    query: Optional[str] = None,
    db=None,
) -> str:
    """
    Build a context string for LLM prompts from a single module's own content.

    A per-module interview only concerns ONE chapter, whose article + transcript
    already fit comfortably in the prompt, so we use the raw text directly.

    This performs NO embedding/vector search — the raw module text is the single
    source of truth. `query`/`db` are accepted for backward compatibility and
    intentionally unused.
    """
    parts = [
        f"# Module: {chapter.title}",
        f"\n## Article Content\n{chapter.article_content}",
    ]
    if chapter.video_transcript:
        parts.append(f"\n## Video Transcript\n{chapter.video_transcript}")
    return "\n".join(parts)[:_MAX_CHAPTER_CONTEXT_CHARS]


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


def build_course_context_no_vector(course: Course) -> str:
    """Raw, length-bounded concatenation of every module's article + transcript.

    Used by the Realtime interview, which deliberately skips vector retrieval
    entirely (per requirement): the candidate's name, the course name, and this
    raw module text are all the interviewer needs, and the Realtime model holds
    it in session context for the whole call.
    """
    return _raw_course_context(course)


def build_course_context(
    course: Course,
    query: Optional[str] = None,
    db=None,
) -> str:
    """
    Build a context string spanning ALL modules of a course for the final,
    course-wide AI interview.

    Uses a length-bounded concatenation of every module's raw article +
    transcript, so the interviewer always has the full course knowledge base.
    No embedding/vector search is performed — the raw module text is the single
    source of truth. `query`/`db` are accepted for backward compatibility and
    intentionally unused.
    """
    return _raw_course_context(course)
