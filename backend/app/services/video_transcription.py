"""Speech-to-text transcription for uploaded module videos via OpenAI Whisper.

Flow: the teacher uploads a video -> we extract a small mono 16 kHz audio track
with the (pip-bundled) ffmpeg binary -> send it to OpenAI's Whisper API -> return
the transcript text. Everything degrades gracefully: any failure returns None so
the caller falls back to manual transcript entry instead of breaking the upload.
"""
import logging
import os
import subprocess
import tempfile
from typing import Optional

from app.services.openai_config import OPENAI_STT_MODEL, get_openai_client, has_openai

logger = logging.getLogger(__name__)

# Container formats OpenAI's audio API accepts directly (used only if ffmpeg is
# unavailable — normally we always down-convert to mp3 first).
_DIRECT_FORMATS = {".mp4", ".webm", ".mp3", ".m4a", ".wav", ".mpeg", ".mpga", ".flac", ".ogg"}


def _ffmpeg_exe() -> Optional[str]:
    """Return a path to an ffmpeg binary (bundled via imageio-ffmpeg), or None."""
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception as exc:
        logger.warning("ffmpeg unavailable (imageio-ffmpeg not installed): %s", exc)
        return None


def _extract_audio(src_path: str) -> Optional[str]:
    """Down-convert any video to a small mono 16 kHz mp3 for transcription.

    Whisper resamples to 16 kHz internally, so this loses no useful information
    while shrinking a 100 MB video to a few MB of speech audio (keeps us well
    under OpenAI's 25 MB per-file size limit). Returns the audio path or None on failure.
    """
    ffmpeg = _ffmpeg_exe()
    if not ffmpeg:
        return None
    out_path = src_path + ".mp3"
    try:
        subprocess.run(
            [ffmpeg, "-y", "-i", src_path,
             "-vn",            # drop the video stream
             "-ac", "1",       # mono
             "-ar", "16000",   # 16 kHz
             "-b:a", "48k",    # plenty for speech
             out_path],
            check=True, capture_output=True,
        )
        return out_path
    except Exception as exc:
        logger.warning("ffmpeg audio extraction failed: %s", exc)
        return None


def transcribe_video_bytes(data: bytes, filename: str) -> Optional[str]:
    """Transcribe an uploaded video's speech to text using OpenAI Whisper.

    Returns the transcript string, or None if transcription is unavailable or
    fails (the caller should then fall back to manual transcript entry).
    """
    if not has_openai():
        logger.warning("OPENAI_API_KEY not set — skipping auto-transcription.")
        return None
    if not data:
        return None

    ext = os.path.splitext(filename)[1].lower() or ".mp4"
    tmp_dir = tempfile.mkdtemp(prefix="lms_tx_")
    src_path = os.path.join(tmp_dir, "input" + ext)
    audio_path: Optional[str] = None
    try:
        with open(src_path, "wb") as f:
            f.write(data)

        audio_path = _extract_audio(src_path)
        if audio_path:
            send_path = audio_path
        elif ext in _DIRECT_FORMATS:
            # No ffmpeg, but OpenAI accepts this container as-is.
            send_path = src_path
        else:
            logger.warning("No ffmpeg and unsupported format '%s' — skipping transcription.", ext)
            return None

        client = get_openai_client()
        if client is None:
            logger.warning("OpenAI client unavailable — skipping auto-transcription.")
            return None
        with open(send_path, "rb") as audio_f:
            audio_bytes = audio_f.read()
        result = client.audio.transcriptions.create(
            file=(os.path.basename(send_path), audio_bytes),
            model=OPENAI_STT_MODEL,
            response_format="text",
        )
        text = result if isinstance(result, str) else getattr(result, "text", "")
        text = (text or "").strip()
        if text:
            logger.info("Transcribed %s: %d chars", filename, len(text))
            return text
        logger.info("Transcription produced no text for %s", filename)
        return None
    except Exception as exc:
        logger.warning("Transcription failed for %s: %s", filename, exc)
        return None
    finally:
        for p in (audio_path, src_path):
            if p and os.path.exists(p):
                try:
                    os.remove(p)
                except Exception:
                    pass
        try:
            os.rmdir(tmp_dir)
        except Exception:
            pass
