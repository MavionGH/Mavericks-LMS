"""Central OpenAI configuration — API key, model names, and shared raw client.

Every AI feature except the Realtime voice interview runs on OpenAI (that one
runs on Gemini Live — see gemini_config.py / services/realtime.py). Lighter,
cost-efficient models are the defaults:

  • Dialog + Quiz   → gpt-4o-mini   (interview chat loop, MCQ generation)
  • Final grading   → gpt-4o        (premium evaluation; o3-mini = reasoning alt)
  • Speech-to-text  → whisper-1     (student answers + uploaded module videos)

The key may be stored in `.env` under the conventional ``OPENAI_API_KEY`` or the
project's original ``Open_Al`` name — we accept either so nothing breaks.
"""
import os

# Accept the conventional name first, then the project's original `Open_Al`.
OPENAI_API_KEY = (
    os.getenv("OPENAI_API_KEY")
    or os.getenv("Open_Al")
    or os.getenv("OPEN_AI")
    or ""
).strip()

# ─── Model selection (override any of these in .env without code changes) ───
# Chat / dialog generation + quiz MCQs — light and cheap.
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")
# Premium grading engine for final interview evaluation.
OPENAI_GRADING_MODEL = os.getenv("OPENAI_GRADING_MODEL", "gpt-4o")
# Speech-to-text (student voice answers + uploaded module videos).
OPENAI_STT_MODEL = os.getenv("OPENAI_STT_MODEL", "whisper-1")
# Text-to-speech for the AI interviewer's voice. tts-1 is the low-latency model
# (snappy responses); "nova" is a warm, natural female voice. mp3 keeps the
# payload small for a fast transfer. For an even more expressive (but slower)
# voice set OPENAI_TTS_MODEL=gpt-4o-mini-tts. All overridable via .env.
OPENAI_TTS_MODEL = os.getenv("OPENAI_TTS_MODEL", "tts-1")
OPENAI_TTS_VOICE = os.getenv("OPENAI_TTS_VOICE", "nova")
OPENAI_TTS_FORMAT = os.getenv("OPENAI_TTS_FORMAT", "mp3")
# Note: the Realtime (speech-to-speech interview) API now runs on Gemini Live,
# not OpenAI — see gemini_config.py and services/realtime.py.

_raw_client = None
_raw_resolved = False


def has_openai() -> bool:
    """True when an OpenAI API key is configured."""
    return bool(OPENAI_API_KEY)


def get_openai_client():
    """Return a cached raw OpenAI SDK client (or None if unavailable).

    Used for Whisper speech-to-text and text-to-speech. Cached process-wide so
    the underlying HTTP connection pool is created once and reused.
    """
    global _raw_client, _raw_resolved
    if _raw_resolved:
        return _raw_client
    _raw_resolved = True
    if not OPENAI_API_KEY:
        return None
    try:
        from openai import OpenAI
        _raw_client = OpenAI(api_key=OPENAI_API_KEY)
    except Exception:
        _raw_client = None
    return _raw_client


def is_reasoning_model(model: str) -> bool:
    """o1 / o3 / o4 reasoning models don't accept a custom `temperature`/`top_p`."""
    m = (model or "").lower()
    return m.startswith(("o1", "o3", "o4"))
