"""Central Gemini configuration — API key + models for the Realtime
(speech-to-speech) interview, which runs on Gemini's Live API, and for grading
that interview's transcript afterward.

Every other AI feature in the app (dialog, quiz, the OLDER graph-based
interview's grading, STT, TTS, embeddings) still runs on OpenAI (see
openai_config.py) — only the Realtime voice interview and its own scoring use
Gemini.
"""
import os

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()

# Must support bidiGenerateContent for the configured key/project — verify with
# client.models.list() if you change this, since not every Gemini model is
# available for the Live API on every account. gemini-2.5-flash-native-audio-*
# reproducibly crashes the session (WS 1007) once a custom voice + tool calling
# are both active a few turns in — verified live — so avoid that family here.
GEMINI_LIVE_MODEL = os.getenv("GEMINI_LIVE_MODEL", "gemini-3.1-flash-live-preview")
# Prebuilt Gemini Live voice name (e.g. Kore, Puck, Charon, Aoede, Fenrir, Leda).
GEMINI_LIVE_VOICE = os.getenv("GEMINI_LIVE_VOICE", "Kore")

# Cheap, non-Live text model used ONLY to grade the Realtime interview's
# transcript afterward (see score_realtime_interview in llm.py) — a plain
# generateContent call, unrelated to the Live API session above.
GEMINI_GRADING_MODEL = os.getenv("GEMINI_GRADING_MODEL", "gemini-2.5-flash-lite")


def has_gemini() -> bool:
    """True when a Gemini API key is configured."""
    return bool(GEMINI_API_KEY)
