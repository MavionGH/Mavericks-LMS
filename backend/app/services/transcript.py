"""YouTube transcript fetching service."""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r"(?:v=)([a-zA-Z0-9_-]{11})",
        r"(?:youtu\.be/)([a-zA-Z0-9_-]{11})",
        r"(?:embed/)([a-zA-Z0-9_-]{11})",
        r"(?:shorts/)([a-zA-Z0-9_-]{11})",
    ]
    for pattern in patterns:
        m = re.search(pattern, url)
        if m:
            return m.group(1)
    return None


def fetch_youtube_transcript(youtube_url: str) -> Optional[str]:
    """
    Fetch and return the concatenated transcript text for a YouTube video.
    Returns None if captions are unavailable or on any error.
    """
    video_id = extract_video_id(youtube_url)
    if not video_id:
        logger.warning("Could not extract video ID from URL: %s", youtube_url)
        return None

    try:
        from youtube_transcript_api import YouTubeTranscriptApi
        api = YouTubeTranscriptApi()
        fetched = api.fetch(video_id)
        text = " ".join(snippet.text for snippet in fetched)
        logger.info("Fetched transcript for %s: %d chars", video_id, len(text))
        return text
    except Exception as exc:
        logger.warning("No transcript available for %s: %s", video_id, exc)
        return None
