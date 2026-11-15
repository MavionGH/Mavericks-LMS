"""Text-to-speech for the AI interviewer's voice — OpenAI TTS.

Mav's spoken lines are synthesized with OpenAI's `gpt-4o-mini-tts` model (a warm,
natural, human-like female voice — "nova" by default). It reuses the same OpenAI
client the rest of the app already uses for Whisper/LLM, so there's no extra
model to download and no local compute: the backend just streams the audio to
the browser, which plays it through a normal `<audio>` element (so Mav's voice is
still captured by the interview's screen+audio recording).

Everything degrades gracefully: if the OpenAI key/client is unavailable or the
request fails, `synthesize_speech()` returns ``None`` and the frontend
automatically falls back to the browser's built-in `speechSynthesis` — so the
interview never goes silent, it just loses the nicer voice.
"""
import logging
import threading
from collections import OrderedDict

from app.services.openai_config import (
    OPENAI_TTS_FORMAT,
    OPENAI_TTS_MODEL,
    OPENAI_TTS_VOICE,
    get_openai_client,
)

logger = logging.getLogger(__name__)

# Map the OpenAI audio format to the HTTP content type the browser plays.
_MEDIA_TYPES = {
    "mp3": "audio/mpeg",
    "opus": "audio/ogg",
    "aac": "audio/aac",
    "flac": "audio/flac",
    "wav": "audio/wav",
    "pcm": "audio/L16",
}
MEDIA_TYPE = _MEDIA_TYPES.get(OPENAI_TTS_FORMAT, "audio/mpeg")

# Tiny LRU of synthesized audio. Mav's questions are dynamic (rarely repeat), but
# the greeting/goodbye lines do — caching them avoids a redundant TTS API call.
_CACHE_MAX = 32
_cache: "OrderedDict[tuple, bytes]" = OrderedDict()
_cache_lock = threading.Lock()


def synthesize_speech(text: str, voice: str | None = None) -> bytes | None:
    """Synthesize `text` into audio bytes (format = OPENAI_TTS_FORMAT), or None.

    Returning None (rather than raising) lets the caller — and ultimately the
    browser — degrade gracefully to the built-in speech synthesizer.
    """
    text = (text or "").strip()
    if not text:
        return None
    voice = voice or OPENAI_TTS_VOICE

    key = (voice, OPENAI_TTS_MODEL, OPENAI_TTS_FORMAT, text)
    with _cache_lock:
        hit = _cache.get(key)
        if hit is not None:
            _cache.move_to_end(key)
            return hit

    client = get_openai_client()
    if client is None:
        logger.warning("TTS unavailable: no OpenAI client (missing OPENAI_API_KEY?)")
        return None

    try:
        # Streaming response is the recommended pattern (lower time-to-first-byte
        # and no deprecation warning); .read() collects the full clip.
        with client.audio.speech.with_streaming_response.create(
            model=OPENAI_TTS_MODEL,
            voice=voice,
            input=text,
            response_format=OPENAI_TTS_FORMAT,
        ) as response:
            audio = response.read()
    except Exception:
        logger.exception("OpenAI TTS synthesis failed for text of length %d", len(text))
        return None

    if not audio:
        return None

    with _cache_lock:
        _cache[key] = audio
        _cache.move_to_end(key)
        while len(_cache) > _CACHE_MAX:
            _cache.popitem(last=False)
    return audio


def tts_available() -> bool:
    """True when an OpenAI client is configured (used by warm-up/health)."""
    return get_openai_client() is not None


def warm_up() -> bool:
    """Warm the OpenAI TTS connection so the FIRST real interview line is fast.

    Synthesizes a tiny clip to establish the TLS connection + HTTP pool (the cold
    first request otherwise costs several seconds). The result is cached, so the
    spend is one ~1-word call per server start. Fully guarded — never raises.
    """
    try:
        if get_openai_client() is None:
            return False
        return synthesize_speech("Ready.") is not None
    except Exception:
        logger.exception("TTS warm-up skipped.")
        return False
