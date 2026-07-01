"""OpenAI Realtime API integration for the speech-to-speech oral interview.

Architecture (see also the interview router):

    Browser ──WebRTC──> OpenAI Realtime API        (live audio, both directions)
       ▲
       │ ephemeral token
       │
    FastAPI backend                                (auth + context + token only)

The backend NEVER proxies the audio. It authenticates the student, assembles
the interview context (the candidate's name, the course/module name, and the
RAW text of the module articles + video transcripts — no vector search), bakes
that into the interviewer's `instructions`, and asks OpenAI to mint a short-lived
ephemeral client secret. The browser uses that secret to open the WebRTC session
directly, so latency is browser↔OpenAI only.
"""
from __future__ import annotations

import logging
from typing import Optional

import httpx

from app.services.openai_config import (
    OPENAI_API_KEY,
    OPENAI_REALTIME_MODEL,
    OPENAI_REALTIME_SESSION_URL,
    OPENAI_REALTIME_VOICE,
)

logger = logging.getLogger(__name__)

# Number of questions Mav aims to ask — kept in step with the LangGraph flow so
# the two interview paths grade against the same expectation.
INTERVIEW_QUESTION_COUNT = 5

# Hard cap on the reference text baked into the instructions. The Realtime model
# keeps this in session context for the whole call, so we bound it to avoid an
# oversized session payload (the raw builders also slice further).
_MAX_CONTEXT_CHARS = 8000


def build_interview_instructions(
    *,
    student_name: str,
    course_name: str,
    context: str,
    pass_threshold: int = 70,
) -> str:
    """Compose the system instructions Mav (the AI interviewer) runs the call with.

    Everything the interviewer needs lives here and stays in the session for the
    whole conversation, so the frontend never resends it per turn:
      • who it's talking to (student first name),
      • what it's assessing (course/module name),
      • the source material (raw article + transcript text — NO vector retrieval),
      • how to behave (one question at a time, never interrupt, follow-ups).
    """
    first = (student_name or "").strip().split(" ")[0] if student_name else ""
    who = first or "the candidate"
    reference = (context or "").strip()[:_MAX_CONTEXT_CHARS] or "(no module text available)"

    return (
        f"You are Mav, a warm, professional AI interviewer on an online learning "
        f"platform. You are conducting a spoken oral assessment with {who} about the "
        f"course \"{course_name}\".\n\n"
        "## Voice and language (STRICT)\n"
        "- Speak ENGLISH ONLY for the entire conversation. Never switch to Arabic, "
        "Urdu, Hindi, or any other language, even if the candidate uses another "
        "language — always reply in clear English.\n"
        "- Speak at a calm, slow, relaxed pace with natural pauses between sentences. "
        "Do NOT rush or speak quickly. Enunciate clearly so the candidate can follow "
        "you easily.\n\n"
        "## Reference material\n"
        "Base every question ONLY on the module material below (its articles and "
        "video transcripts). Do not test anything outside it.\n"
        f"\"\"\"\n{reference}\n\"\"\"\n\n"
        "## How to run the interview\n"
        f"- Open with a short, warm greeting that addresses {who} by name and names "
        f"the course, then ask your first question.\n"
        f"- Ask ONE clear question at a time — never multi-part questions.\n"
        f"- Wait until the candidate has fully finished speaking before you respond. "
        "Never talk over them or interrupt.\n"
        "- Ask natural follow-up questions when an answer invites one.\n"
        "- Keep your spoken turns concise and conversational, like a real interviewer.\n"
        "- If the candidate says they don't know or wants to skip, acknowledge it "
        "warmly and move to a different topic.\n"
        f"- Ask EXACTLY {INTERVIEW_QUESTION_COUNT} interview questions in total — no "
        f"more, no fewer. Your opening greeting already includes question 1, so after "
        f"that you ask {INTERVIEW_QUESTION_COUNT - 1} more. Brief clarifications do NOT "
        "count as new questions.\n"
        "- Adapt difficulty to how well they answer.\n"
        f"- The pass threshold for this assessment is {pass_threshold}%.\n"
        f"- After the candidate has answered the {INTERVIEW_QUESTION_COUNT}th question, "
        "do NOT ask another question. Thank them warmly, tell them the assessment is "
        "complete, and say goodbye. Do not read out scores — those are computed "
        "separately."
    )


def create_realtime_session(
    instructions: str,
    *,
    voice: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Mint an ephemeral Realtime session and return OpenAI's raw JSON response.

    The response carries a short-lived client secret the browser uses to open the
    WebRTC connection. We return the whole payload (the frontend reads the secret
    + expiry from it) and also surface a normalised ``client_secret`` string via
    :func:`extract_client_secret` at the call site.

    Raises RuntimeError on misconfiguration or an OpenAI error so the router can
    translate it into a clean HTTP error.
    """
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY is not configured — cannot start a realtime interview.")

    payload = {
        "session": {
            "type": "realtime",
            "model": model or OPENAI_REALTIME_MODEL,
            "instructions": instructions,
            "audio": {"output": {"voice": voice or OPENAI_REALTIME_VOICE}},
        }
    }

    try:
        resp = httpx.post(
            OPENAI_REALTIME_SESSION_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=20.0,
        )
    except httpx.HTTPError as exc:
        logger.error("Realtime session request failed: %s", exc)
        raise RuntimeError("Could not reach the OpenAI Realtime API.") from exc

    if resp.status_code >= 400:
        logger.error("Realtime session error %s: %s", resp.status_code, resp.text[:500])
        raise RuntimeError(f"OpenAI Realtime API returned {resp.status_code}.")

    return resp.json()


def extract_client_secret(session: dict) -> Optional[str]:
    """Pull the ephemeral secret string out of OpenAI's session response.

    Tolerant of the two shapes OpenAI has shipped: a top-level ``value`` (GA
    client-secrets endpoint) or a nested ``client_secret.value`` (older sessions
    endpoint).
    """
    if not isinstance(session, dict):
        return None
    if isinstance(session.get("value"), str):
        return session["value"]
    cs = session.get("client_secret")
    if isinstance(cs, dict) and isinstance(cs.get("value"), str):
        return cs["value"]
    if isinstance(cs, str):
        return cs
    return None
