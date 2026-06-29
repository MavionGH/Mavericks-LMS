"""Central OpenAI configuration — API key, model names, and shared raw client.

Every AI feature in the app now runs on OpenAI (replacing the previous Groq /
HuggingFace stack). Lighter, cost-efficient models are the defaults:

  • Dialog + Quiz   → gpt-4o-mini   (interview chat loop, MCQ generation)
  • Final grading   → gpt-4o        (premium evaluation; o3-mini = reasoning alt)
  • Speech-to-text  → whisper-1     (student answers + uploaded module videos)
  • Embeddings      → text-embedding-3-small  (RAG vector search)

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
# Embeddings for RAG vector search.
OPENAI_EMBED_MODEL = os.getenv("OPENAI_EMBED_MODEL", "text-embedding-3-small")
# Embedding dimension. Kept at 384 so it stays compatible with the existing
# Postgres `Vector(384)` column and the existing Pinecone index — no migration
# needed. text-embedding-3-small natively outputs 1536 dims but supports the
# `dimensions` parameter to truncate, which we use here.
EMBED_DIM = int(os.getenv("EMBED_DIM", "384"))

_raw_client = None
_raw_resolved = False


def has_openai() -> bool:
    """True when an OpenAI API key is configured."""
    return bool(OPENAI_API_KEY)


def get_openai_client():
    """Return a cached raw OpenAI SDK client (or None if unavailable).

    Used for Whisper transcription and embeddings. Cached process-wide so the
    underlying HTTP connection pool is created once and reused.
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
