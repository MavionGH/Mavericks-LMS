"""Speech-to-text via Groq Whisper.

The browser's Web Speech API (Google cloud STT) is unreachable in many
networks/regions, so voice capture is done server-side: the frontend records the
student's answer with MediaRecorder and POSTs the audio here, where Groq's hosted
Whisper model transcribes it. This works anywhere the backend can reach Groq —
the same dependency the interview LLM already relies on.
"""
import logging
import os

logger = logging.getLogger(__name__)

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
# Fast, accurate, inexpensive Whisper variant on Groq.
STT_MODEL = os.getenv("GROQ_STT_MODEL", "whisper-large-v3-turbo")

_groq_client = None
_groq_resolved = False


def _get_client():
    """Cache a single Groq client process-wide (keeps the HTTP pool warm)."""
    global _groq_client, _groq_resolved
    if _groq_resolved:
        return _groq_client
    _groq_resolved = True
    if GROQ_API_KEY:
        try:
            from groq import Groq
            _groq_client = Groq(api_key=GROQ_API_KEY)
        except Exception:
            logger.exception("Failed to construct Groq client for STT")
            _groq_client = None
    return _groq_client


def transcribe_audio(audio_bytes: bytes, filename: str = "answer.webm") -> str:
    """Transcribe recorded answer audio to text. Returns "" on any failure so the
    caller can degrade gracefully (e.g. ask the student to type)."""
    if not audio_bytes:
        return ""
    client = _get_client()
    if client is None:
        logger.warning("STT unavailable: no Groq client (missing GROQ_API_KEY?)")
        return ""
    try:
        resp = client.audio.transcriptions.create(
            file=(filename, audio_bytes),
            model=STT_MODEL,
            language="en",
            response_format="json",
            temperature=0.0,
        )
        return (getattr(resp, "text", "") or "").strip()
    except Exception:
        logger.exception("Groq Whisper transcription failed")
        return ""
