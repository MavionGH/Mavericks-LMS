"""
YouTube transcript fetcher — pulls auto/manual captions via youtube-transcript-api.

Usage:
    from app.services.transcript import fetch_youtube_transcript
    text = fetch_youtube_transcript("https://www.youtube.com/watch?v=dQw4w9WgXcQ")
    # Returns full transcript string or None if unavailable
"""
import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)


def extract_video_id(url: str) -> Optional[str]:
    """Extract YouTube video ID from various URL formats."""
    patterns = [
        r"(?:v=|/v/|youtu\.be/|/embed/)([a-zA-Z0-9_-]{11})",
        r"^([a-zA-Z0-9_-]{11})$",
    ]
    for pattern in patterns:
        match = re.search(pattern, url)
        if match:
            return match.group(1)
    return None


def fetch_youtube_transcript(youtube_url: str) -> Optional[str]:
    """Fetch transcript for a YouTube video.

    Returns the full transcript as a single string, or None if captions
    are unavailable.

    Preferred language order: English → any available language.
    """
    video_id = extract_video_id(youtube_url)
    if not video_id:
        logger.warning(f"Could not extract video ID from URL: {youtube_url}")
        return None

    try:
        from youtube_transcript_api import YouTubeTranscriptApi

        transcript_list = YouTubeTranscriptApi.list_transcripts(video_id)

        # Try English first, then any language
        transcript = None
        try:
            transcript = transcript_list.find_transcript(["en", "en-US", "en-GB"])
        except Exception:
            try:
                # Get first available and translate to English if possible
                for t in transcript_list:
                    if t.is_translatable:
                        transcript = t.translate("en")
                        break
                    else:
                        transcript = t
                        break
            except Exception:
                pass

        if transcript is None:
            logger.info(f"No transcript available for video {video_id}")
            return None

        # Fetch the actual text entries
        entries = transcript.fetch()
        full_text = " ".join(
            entry.get("text", "") if isinstance(entry, dict) else str(entry)
            for entry in entries
        ).strip()

        if not full_text:
            logger.info(f"Transcript was empty for video {video_id}")
            return None

        logger.info(f"Fetched transcript for video {video_id} ({len(full_text)} chars)")
        return full_text

    except Exception as e:
        # Covers: TranscriptsDisabled, NoTranscriptFound, VideoUnavailable,
        # network errors, and import errors
        logger.warning(f"Could not fetch transcript for video {video_id}: {e}")
        return None

    # TODO: Add Whisper-based fallback for videos without any captions.
    # This would involve downloading audio via yt-dlp and running
    # openai-whisper or faster-whisper locally. Not implemented yet
    # because it requires significant compute resources and additional
    # dependencies (ffmpeg, torch, whisper model weights).
