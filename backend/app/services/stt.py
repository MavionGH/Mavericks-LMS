"""Speech-to-text via OpenAI Whisper (whisper-1).

The browser's Web Speech API (Google cloud STT) is unreachable in many
networks/regions, so voice capture is done server-side: the frontend records the
student's answer with MediaRecorder and POSTs the audio here, where OpenAI's
hosted Whisper model transcribes it. This works anywhere the backend can reach
OpenAI — the same dependency the interview LLM already relies on.
"""
import logging

from app.services.openai_config import OPENAI_STT_MODEL, get_openai_client

logger = logging.getLogger(__name__)


def transcribe_audio(audio_bytes: bytes, filename: str = "answer.webm") -> str:
    """Transcribe recorded answer audio to text. Returns "" on any failure so the
    caller can degrade gracefully (e.g. ask the student to type)."""
    if not audio_bytes:
        return ""
    client = get_openai_client()
    if client is None:
        logger.warning("STT unavailable: no OpenAI client (missing OPENAI_API_KEY?)")
        return ""
    try:
        resp = client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=OPENAI_STT_MODEL,
            language="en",
            response_format="json",
            temperature=0.0,
        )
        return (getattr(resp, "text", "") or "").strip()
    except Exception:
        logger.exception("OpenAI Whisper transcription failed")
        return ""
