"""Gemini Live API integration for the speech-to-speech oral interview.

Architecture (see also the interview router):

    Browser ──WebSocket──> Gemini Live API         (live audio, both directions)
       ▲
       │ ephemeral auth token
       │
    FastAPI backend                                (auth + context + token only)

The backend NEVER proxies the audio. It authenticates the student, assembles
the interview context (the candidate's name, the course/module name, and the
RAW text of the module articles + video transcripts — no vector search), and
asks Gemini to mint a short-lived ephemeral auth token (see
`create_realtime_session`). The browser uses that token — via the
`@google/genai` JS SDK's `ai.live.connect()` — to open the Live API session
directly, so latency is browser<->Gemini only. The system instructions built
here are sent by the browser itself at connect time (Gemini Live has no
server-side "session update" step the backend can push to beforehand).
"""
from __future__ import annotations

import datetime
import logging
from typing import Optional

from google import genai
from google.genai import types as genai_types

from app.services.gemini_config import GEMINI_API_KEY, GEMINI_LIVE_MODEL, GEMINI_LIVE_VOICE

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
        "\n"
        "## Handling the candidate's response (STRICT — this determines question "
        "progress, so getting it right matters more than anything else here)\n"
        "FIRST, before anything else, check the language: if the candidate's message "
        "is not in English (any other language, or mixed with another language), do "
        "NOT evaluate its content at all — not even if it would otherwise be a "
        "genuine, correct answer. Instead, politely tell them (in English) that this "
        "assessment must stay in English and ask them to please answer in English, "
        "then re-ask THE EXACT SAME question you were on. Do NOT call "
        "`mark_question_answered` — a non-English response never counts as progress, "
        "regardless of what it said.\n"
        "Otherwise, once you've confirmed the message IS in English, decide which ONE "
        "of these four cases applies:\n"
        "1. GENUINE ANSWER — a real attempt to answer the current question (right or "
        "wrong). React naturally to it, THEN call the `mark_question_answered` tool "
        "exactly once, then move on to a NEW question on a different topic (unless "
        f"this was the {INTERVIEW_QUESTION_COUNT}th one — see wrap-up below).\n"
        "2. EXPLICIT SKIP — 'I don't know', 'not sure', 'skip', 'pass', 'move on', "
        "'next question', or similar. Acknowledge warmly, call `mark_question_answered` "
        "exactly once, then move on to a NEW question on a different topic.\n"
        "3. REPEAT/CLARIFY REQUEST — the candidate asks you to repeat, rephrase, or "
        "explain the current question. Simply repeat or rephrase THE SAME question. "
        "Do NOT call `mark_question_answered` — this never counts as progress.\n"
        "4. OFF-TOPIC / PERSONAL / CHITCHAT — greetings, 'how are you', jokes, or any "
        "unrelated remark. Give a brief, warm, genuine reply, then re-ask THE EXACT "
        "SAME question you were on. Do NOT call `mark_question_answered`.\n"
        "Call `mark_question_answered` ONLY for cases 1 and 2 — never for the language "
        "check, or for 3 or 4. This "
        "tool call is the ONLY signal the interview system uses to track how many "
        "questions have been answered, so call it exactly once per genuine answer or "
        "explicit skip, and never in any other case. This is a MANDATORY step, not "
        "optional — call it silently as part of your turn, every single time case 1 "
        "or 2 applies, even if you also plan to ask a follow-up question afterward "
        "instead of a brand-new topic.\n"
        "\n"
        f"## Wrap-up (after exactly {INTERVIEW_QUESTION_COUNT} answered questions)\n"
        f"- Ask EXACTLY {INTERVIEW_QUESTION_COUNT} questions in total, each counted "
        "only when you call `mark_question_answered` per the rules above — repeats "
        "and chitchat never count. Your opening greeting already includes question 1.\n"
        "- Adapt difficulty to how well they answer.\n"
        f"- The pass threshold for this assessment is {pass_threshold}%.\n"
        f"- The moment you have called `mark_question_answered` for the "
        f"{INTERVIEW_QUESTION_COUNT}th time, do NOT ask another question. Thank the "
        "candidate warmly, tell them the assessment is complete, and say goodbye "
        "(e.g. include a clear closing word like 'goodbye' or 'take care'). Do "
        "not read out scores — those are computed separately.\n"
        f"- CRITICAL: this applies even while ON the {INTERVIEW_QUESTION_COUNT}th "
        "question. If the candidate asks you to repeat/clarify it (case 3) or goes "
        "off-topic/chitchat (case 4) on this LAST question, you MUST still just "
        "repeat the question or reply-then-re-ask exactly as in those rules — do "
        "NOT say goodbye or end the interview yet. Only say goodbye once the "
        f"candidate has actually given a genuine answer or explicit skip to THIS "
        f"{INTERVIEW_QUESTION_COUNT}th question (case 1 or 2)."
    )


_client = None
_client_resolved = False


def _get_client():
    """Return a cached Gemini client scoped to the v1alpha API (required for the
    experimental ephemeral-token endpoint), or None if unconfigured."""
    global _client, _client_resolved
    if _client_resolved:
        return _client
    _client_resolved = True
    if not GEMINI_API_KEY:
        _client = None
        return None
    _client = genai.Client(
        api_key=GEMINI_API_KEY,
        http_options=genai_types.HttpOptions(api_version="v1alpha"),
    )
    return _client


def create_realtime_session(
    instructions: str,
    *,
    voice: Optional[str] = None,
    model: Optional[str] = None,
) -> dict:
    """Mint a short-lived Gemini Live ephemeral auth token for the browser.

    The browser passes this token as the `apiKey` to `@google/genai`'s
    `ai.live.connect()` to open the Live API session directly — the backend
    never proxies audio. `instructions` isn't embedded in the token itself;
    the browser sends it as `systemInstruction` on connect (kept unlocked so
    each session can carry its own per-student context).

    Raises RuntimeError on misconfiguration or a Gemini error so the router can
    translate it into a clean HTTP error.
    """
    client = _get_client()
    if client is None:
        raise RuntimeError("GEMINI_API_KEY is not configured — cannot start a realtime interview.")

    now = datetime.datetime.now(datetime.timezone.utc)
    try:
        token = client.auth_tokens.create(
            config=genai_types.CreateAuthTokenConfig(
                uses=1,
                # Generous window: covers the consent-gate + connection setup
                # time on slower connections before the token is first used.
                expire_time=now + datetime.timedelta(minutes=30),
                new_session_expire_time=now + datetime.timedelta(minutes=5),
            )
        )
    except Exception as exc:
        logger.error("Gemini ephemeral token creation failed: %s", exc)
        raise RuntimeError("Could not reach the Gemini Live API.") from exc

    return {
        "value": token.name,
        "model": model or GEMINI_LIVE_MODEL,
        "voice": voice or GEMINI_LIVE_VOICE,
    }


def extract_client_secret(session: dict) -> Optional[str]:
    """Pull the ephemeral token string out of the session dict returned by
    `create_realtime_session`."""
    if not isinstance(session, dict):
        return None
    value = session.get("value")
    return value if isinstance(value, str) else None
