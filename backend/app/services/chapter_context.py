"""Build rich context for AI interview from chapter content."""
from app.models.models import Chapter


def build_chapter_context(chapter: Chapter) -> str:
    parts = [
        f"# Module: {chapter.title}",
        f"\n## Article Content\n{chapter.article_content}",
    ]
    if chapter.video_transcript:
        parts.append(f"\n## Video Transcript\n{chapter.video_transcript}")
    if chapter.youtube_url:
        parts.append(f"\n## Video URL\n{chapter.youtube_url}")
    return "\n".join(parts)
