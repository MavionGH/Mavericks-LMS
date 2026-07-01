"""LLM wrapper — OpenAI (gpt-4o-mini for dialog/quiz, gpt-4o for grading),
then rule-based scoring as a graceful fallback."""
import json
import math
import random
import re

from app.services.openai_config import (
    OPENAI_API_KEY,
    OPENAI_GRADING_MODEL,
    OPENAI_MODEL,
    is_reasoning_model,
)

# ─── Keywords used in rule-based fallback for classification ───
_GREETING_PATTERNS = re.compile(
    r"^\s*(hi+|hello+|hey+|good (morning|afternoon|evening|day)|howdy|sup|yo|greetings)",
    re.IGNORECASE,
)
_PERSONAL_PATTERNS = re.compile(
    r"\b(how are you|how do you do|you doing|are you (ok|good|fine|well|alright)|what('s| is) up|how's it going)\b",
    re.IGNORECASE,
)
_CLARIFICATION_PATTERNS = re.compile(
    r"\b(what do you mean|can you (explain|clarify|elaborate|rephrase|repeat)|i don'?t understand|could you (explain|clarify|repeat)|what is meant by|please (explain|clarify|repeat)|i'?m (not sure|confused|unsure))\b",
    re.IGNORECASE,
)
_OFFTOPIC_PATTERNS = re.compile(
    r"\b(weather|temperature|time (is it|now)|what time|today'?s date|who (are|is) you|your name|tell me a joke|joke|news|sports|music|movie|song|recipe|food|cook|game|play|funny)\b",
    re.IGNORECASE,
)


# Cache a single chat-model client process-wide. Constructing a ChatOpenAI client
# sets up an underlying HTTP client (connection pool); doing it once and reusing it
# across every interview turn avoids re-creating that pool on each LLM call (start,
# classify, follow-up) and keeps connections warm.
_llm_client = None
_llm_resolved = False
_grading_llm = None
_grading_resolved = False


def get_llm():
    """Return a cached LangChain chat model for dialog (OpenAI gpt-4o-mini)."""
    global _llm_client, _llm_resolved
    if _llm_resolved:
        return _llm_client

    if OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            _llm_client = ChatOpenAI(
                model=OPENAI_MODEL,
                temperature=0.7,
                api_key=OPENAI_API_KEY,
            )
            _llm_resolved = True
            return _llm_client
        except Exception:
            pass

    _llm_resolved = True
    _llm_client = None
    return _llm_client


def get_grading_llm():
    """Return a cached LangChain chat model for final grading.

    Uses the premium grading model (gpt-4o by default; set OPENAI_GRADING_MODEL to
    o3-mini for a high-reasoning alternative). Reasoning models (o1/o3/o4) don't
    accept a custom temperature, so it's omitted for them.
    """
    global _grading_llm, _grading_resolved
    if _grading_resolved:
        return _grading_llm

    if OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            kwargs = {"model": OPENAI_GRADING_MODEL, "api_key": OPENAI_API_KEY}
            if not is_reasoning_model(OPENAI_GRADING_MODEL):
                kwargs["temperature"] = 0.3  # low temp for consistent, fair scoring
            _grading_llm = ChatOpenAI(**kwargs)
            _grading_resolved = True
            return _grading_llm
        except Exception:
            pass

    _grading_resolved = True
    _grading_llm = None
    return _grading_llm


def _extract_json(text: str) -> dict:
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        start = text.find("{")
        end = text.rfind("}")
        if start >= 0 and end > start:
            return json.loads(text[start : end + 1])
        raise


# ── Cached question-generation LLM ──────────────────────────────────────────
# PERF FIX: The old _get_question_llm() called ChatOpenAI(...) on EVERY
# question, rebuilding the underlying httpx connection pool each time and
# adding 2–5 s of cold-connection overhead per turn.
# Now the client is cached process-wide (same pattern as get_llm/get_grading_llm)
# and per-call temperature randomness is applied via .bind() so question variety
# is fully preserved without the pool-rebuild penalty.
_question_llm_client = None
_question_llm_resolved = False


def _get_question_llm():
    """Return the cached question-generation LLM (gpt-4o-mini, warm HTTP pool).

    Call .bind(temperature=T) on the returned object to vary temperature
    per-question without rebuilding the client.
    """
    global _question_llm_client, _question_llm_resolved
    if _question_llm_resolved:
        return _question_llm_client

    if OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            kwargs = {"model": OPENAI_MODEL, "api_key": OPENAI_API_KEY}
            if not is_reasoning_model(OPENAI_MODEL):
                kwargs["temperature"] = 0.9   # default; overridden per-call
                kwargs["top_p"] = 0.95
            _question_llm_client = ChatOpenAI(**kwargs)
        except Exception:
            _question_llm_client = None

    _question_llm_resolved = True
    return _question_llm_client


def llm_generate_greeting(chapter_title: str, student_name: str = "") -> str:
    """
    Mav's opening greeting — warm, interactive, and personalised by name. It
    introduces Mav, names the course/module the interview covers, and invites the
    student to say hello when ready. It does NOT ask the first question yet; the
    first question is asked only after the student greets back.
    """
    name = (student_name or "").strip()
    first = name.split()[0] if name else ""
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are Mav, a warm, friendly AI interviewer on an online learning platform. "
            "Write a SHORT spoken greeting (2-3 sentences) to open an oral interview.\n"
            "RULES:\n"
            "- Address the student by their first name if one is provided.\n"
            "- Introduce yourself as Mav, their AI interviewer.\n"
            "- Clearly mention that this interview is about the given course/module.\n"
            "- Say it will be a quick, friendly chat of five questions, and they can ask you "
            "to repeat or clarify anything anytime.\n"
            "- End by warmly inviting them to say hello or let you know when they're ready to begin.\n"
            "- Do NOT ask the first interview question yet.\n"
            "- Sound natural and human, not scripted. Return ONLY the greeting text."
        )
        user = (
            f"Course/module: {chapter_title}\n"
            f"Student first name: {first or '(unknown)'}\n"
            "Write Mav's greeting now."
        )
        try:
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
            return resp.content.strip()
        except Exception:
            pass

    # Rule-based fallback
    hello = f"Hello {first}! " if first else "Hello! "
    return (
        f"{hello}Welcome — I'm Mav, your AI interviewer. Today we'll have a friendly chat "
        f"with five short questions about {chapter_title}. Feel free to ask me to repeat or "
        "clarify anything at any time. Whenever you're ready, just say hello and we'll begin!"
    )


def llm_greeting_transition(student_text: str, student_name: str = "") -> str:
    """
    Mav's brief, warm acknowledgement of the student's greeting, right before the
    first interview question is asked. Does NOT contain a question — it's only the
    human-like lead-in that the first question is appended to.
    """
    name = (student_name or "").strip()
    first = name.split()[0] if name else ""
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are Mav, a warm AI interviewer. The student just greeted you back at the "
            "start of an oral interview. Reply with ONE short, friendly sentence that "
            "acknowledges them (by first name if provided) and says you'll begin with the "
            "first question. Do NOT actually ask a question. Return ONLY that sentence."
        )
        user = (
            f"Student first name: {first or '(unknown)'}\n"
            f"Student said: \"{student_text}\"\n"
            "Write Mav's one-sentence lead-in now."
        )
        try:
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
            return resp.content.strip()
        except Exception:
            pass

    return (
        f"Great to meet you, {first}! Let's get started with the first question."
        if first else
        "Great, let's get started with the first question."
    )


# Randomized question angles. Sampling a fresh one per call (especially for the
# first question, which has no prior conversation to vary against) is what stops
# separate interviews on the same module from always opening on the same concept.
_QUESTION_ANGLES = (
    "a core definition or terminology",
    "an underlying principle or concept",
    "a step-by-step process or workflow",
    "a real-world application or example",
    "a practical problem-solving scenario",
    "a comparison, trade-off, or distinction",
    "a common mistake or misconception",
    "a hands-on experience the student may have had",
    "a cause-and-effect relationship",
    "a best practice and why it matters",
)


def llm_generate_question(
    chapter_title: str,
    context: str,
    transcript: list,
    question_number: int,
    student_name: str = "",
    asked_questions: list = None,
) -> str:
    # Draw a fresh random temperature for this question and bind it to the
    # cached client — preserves variety without rebuilding the HTTP pool.
    temperature = round(random.uniform(0.85, 1.05), 2)
    base_llm = _get_question_llm()
    if base_llm is not None and not is_reasoning_model(OPENAI_MODEL):
        llm = base_llm.bind(temperature=temperature)
    else:
        llm = base_llm
    history = "\n".join(
        f"{m['speaker'].upper()}: {m['text']}" for m in transcript[-6:]
    )
    name = (student_name or "").strip()
    first = name.split()[0] if name else ""
    asked_questions = asked_questions or []
    asked_block = (
        "\n".join(f"- {q}" for q in asked_questions) if asked_questions else "None yet"
    )

    # Detect if the last student answer was a non-answer / skip
    last_student = next(
        (m["text"] for m in reversed(transcript) if m["speaker"] == "student"),
        "",
    )
    _NO_ANSWER_PHRASES = (
        "i don't know", "i dont know", "not sure", "no idea",
        "no experience", "skip", "pass", "move on", "don't know",
        "i have no experience", "i'm not sure",
    )
    last_was_skip = any(p in last_student.lower() for p in _NO_ANSWER_PHRASES)
    skip_hint = (
        "\nIMPORTANT: The student just said they don't know or skipped this one. "
        "Start your reply with a brief, warm, human acknowledgement (e.g. \"No worries"
        f"{', ' + first if first else ''}, that's okay — let's try a different one.\") "
        "then ask a question on a DIFFERENT topic from the module. Do NOT follow up on the "
        "topic they skipped."
        if last_was_skip else ""
    )
    # A fresh random token + a randomly chosen angle nudge sampling so repeated
    # interviews on the same module don't converge on the same phrasing or always
    # open on the same concept.
    nonce = random.randint(1000, 9999)
    angle = random.choice(_QUESTION_ANGLES)

    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are an expert technical interviewer for an online learning platform. "
            "Ask ONE clear, concise oral interview question based ONLY on the module content provided.\n"
            "RULES:\n"
            "- Keep the question UNDER 25 WORDS whenever possible.\n"
            "- Ask only ONE thing per question. Never ask multi-part questions.\n"
            "- Be conversational and natural — like a real interviewer speaking. You may "
            "occasionally address the student by their first name to feel personal.\n"
            "- Test deep understanding, not memorization.\n"
            "- Use follow-up style when prior genuine answers exist.\n"
            "- Adapt the difficulty to the student's previous answers: go deeper or harder "
            "after strong answers, simpler after weak ones.\n"
            "- Vary the style across the interview — mix conceptual, practical/applied, "
            "scenario-based, and behavioural questions.\n"
            "- NEVER repeat or paraphrase any question already asked (listed below). "
            "Each question in the interview must be unique and cover a different angle.\n"
            "- Return ONLY the spoken text (a short lead-in is allowed only when "
            "acknowledging a skip), no preamble, no labels.\n"
            "GOOD examples: 'Tell me about a data pipeline you built.' | "
            "'What is the difference between ETL and ELT?' | "
            "'How do you handle schema evolution in production?' | "
            "'Explain a challenge you faced with Airflow.'\n"
            "BAD: 'Can you walk me through a complex end-to-end enterprise-scale distributed "
            "data processing architecture involving multiple ingestion patterns...'"
        )
        user = (
            f"Module: {chapter_title}\n"
            f"Student first name: {first or '(unknown)'}\n\n"
            f"Content:\n{context[:6000]}\n\n"
            f"Questions already asked (do NOT repeat these):\n{asked_block}\n\n"
            f"Conversation so far:\n{history or 'None yet'}\n\n"
            f"This is question #{question_number} of up to 5. "
            f"Frame this question around {angle} drawn from the module — pick a part of "
            f"the content not yet covered by earlier questions. "
            f"Ask the next, unique interview question (under 25 words). "
            f"(Variation token {nonce}: use it only to vary your wording; never mention it.)"
            f"{skip_hint}"
        )
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        return resp.content.strip()

    fallback_questions = _fallback_questions(chapter_title, context)
    idx = min(question_number - 1, len(fallback_questions) - 1)
    if transcript and question_number > 1 and not last_was_skip:
        return (
            f"Can you give a real-world example from {chapter_title} "
            f"based on your last answer?"
        )
    return fallback_questions[idx]


# Pre-compiled fast-path patterns for classify — checked BEFORE the LLM call
# to skip the classify round-trip on the most common (genuine answer) case.
_CLASSIFY_CHITCHAT_RE = re.compile(
    r"\b(how are you|how do you do|you doing|what('?s| is) up|how'?s it going|"
    r"what do you mean|can you (explain|clarify|elaborate|rephrase|repeat)|"
    r"i don'?t understand|who (are|is) you|your name|tell me a joke|joke|"
    r"weather|the time|what time|today'?s date)\b",
    re.IGNORECASE,
)
_CLASSIFY_GREETING_RE = re.compile(
    r"^\s*(hi+|hello+|hey+|good (morning|afternoon|evening|day)|howdy|sup|yo|greetings)\b",
    re.IGNORECASE,
)


def _is_obvious_answer(text: str) -> bool:
    """Return True when we can classify locally as 'answer' without an LLM call.

    Saves ~1-2 s per turn on the common case (student gives a substantive reply).
    Conservative: only short-circuits when the text is long, doesn't look like
    chitchat/greeting/clarification, and isn't phrased as a question.
    """
    t = text.strip()
    if len(t.split()) < 10:
        return False          # short → ambiguous, let LLM decide
    if t.endswith("?"):
        return False          # phrased as a question
    if _CLASSIFY_GREETING_RE.match(t) or _CLASSIFY_CHITCHAT_RE.search(t):
        return False          # obvious chitchat cue
    return True


def llm_classify_response(
    student_text: str,
    current_question: str,
) -> str:
    """
    Classify the student's input relative to the current interview question.

    Returns one of:
      'answer'        — genuine attempt at the interview question
      'greeting'      — hi/hello/hey etc.
      'personal'      — 'how are you?' type enquiries
      'clarification' — asking for explanation of the question
      'offtopic'      — unrelated general knowledge / smalltalk
    """
    text = student_text.strip()

    # ── Fast path 1: explicit skip / I-don't-know → treat as answer ──
    _SKIP_PHRASES_SET = (
        "i don't know", "i dont know", "i do not know",
        "not sure", "no idea", "no experience",
        "i have no experience", "skip", "pass", "move on",
        "move to next", "next question", "i'm not sure",
        "i am not sure", "don't know", "dont know",
    )
    text_lower = text.lower()
    if any(phrase in text_lower for phrase in _SKIP_PHRASES_SET):
        return "answer"

    # ── Fast path 2: long, substantive, non-chitchat → skip LLM classify call ──
    # Saves ~1-2 s per turn on the common case (student gives a real answer).
    if _is_obvious_answer(text):
        return "answer"

    # ── LLM path (short / ambiguous inputs only) ──
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are a classifier for an AI interview assistant. "
            "Classify the student's message into exactly ONE of these categories:\n"
            "  answer        — a genuine attempt to answer the active interview question\n"
            "  greeting      — greetings like hi, hello, hey, good morning\n"
            "  personal      — personal enquiries like 'how are you?'\n"
            "  clarification — asking for clarification/explanation of the question\n"
            "  offtopic      — unrelated question or casual conversation\n"
            "IMPORTANT: 'I don't know', 'skip', 'pass', 'move on', 'not sure' = answer (attempt).\n"
            "Reply with ONLY the single category word, nothing else."
        )
        user = (
            f"Active interview question: {current_question}\n"
            f"Student message: {text}"
        )
        try:
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
            category = resp.content.strip().lower().split()[0]
            if category in ("answer", "greeting", "personal", "clarification", "offtopic"):
                return category
        except Exception:
            pass

    # ── Rule-based fallback ──
    if _GREETING_PATTERNS.match(text):
        return "greeting"
    if _PERSONAL_PATTERNS.search(text):
        return "personal"
    if _CLARIFICATION_PATTERNS.search(text):
        return "clarification"
    if _OFFTOPIC_PATTERNS.search(text):
        return "offtopic"
    # Default: treat as a genuine answer
    return "answer"


def llm_handle_chitchat(
    student_text: str,
    current_question: str,
    category: str,
    student_name: str = "",
) -> str:
    """
    Generate Mav's natural conversational reply to a non-answer input.
    Always ends by re-asking the active interview question.
    """
    name = (student_name or "").strip()
    first = name.split()[0] if name else ""
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are Mav, a friendly and professional AI interviewer. "
            "Your job in this response has TWO parts:\n"
            "  PART 1 — Respond directly and helpfully to whatever the student said "
            "(answer their question, greet them back, clarify the interview question, etc.). "
            "Do NOT say 'I'll answer that at the end' or defer. Answer RIGHT NOW.\n"
            "  PART 2 — After your response, transition back and re-ask the current interview question.\n"
            "You may address the student by their first name to feel personal. "
            "Keep the whole reply concise (2-4 sentences). "
            "Return ONLY the response text, no preamble or labels."
        )
        category_hints = {
            "greeting": (
                "The student greeted you. Greet them back warmly and briefly, "
                "then re-ask the interview question."
            ),
            "personal": (
                "The student asked how you are. Give a brief, warm personal answer "
                "(e.g. 'I'm doing great, thanks for asking!'), then re-ask the interview question."
            ),
            "clarification": (
                "The student asked for clarification on the interview question. "
                "Explain what the question is asking in simpler terms, then re-ask it."
            ),
            "offtopic": (
                "The student asked an off-topic question. Give a brief, genuine answer to their "
                "question right now (DO NOT say you will answer later or at the end). "
                "Then transition back and re-ask the interview question."
            ),
        }
        hint = category_hints.get(category, "Respond naturally, then re-ask the interview question.")
        user = (
            f"{hint}\n"
            f"Student first name: {first or '(unknown)'}\n"
            f"Student said: \"{student_text}\"\n"
            f"Current interview question: \"{current_question}\"\n"
            "Now write Mav's response (answer their message first, then re-ask the question)."
        )
        try:
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
            return resp.content.strip()
        except Exception:
            pass

    # ── Rule-based fallback ──
    if category == "greeting":
        return f"Hello! Great to have you here today. Now, let's get started — {current_question}"
    if category == "personal":
        return f"I'm doing great, thanks for asking! Now let's continue — {current_question}"
    if category == "clarification":
        return (
            f"Of course! I'm asking you to explain your understanding and experience related to this topic. "
            f"Here's the question again: {current_question}"
        )
    # offtopic — give a brief genuine answer, then redirect
    lower = student_text.lower()
    if "weather" in lower:
        brief = "I don't have access to live weather data, but I hope it's nice where you are!"
    elif "time" in lower or "date" in lower:
        brief = "I don't have a clock on me, but let's make the most of our time together!"
    elif "joke" in lower:
        brief = "Ha! I'd love to tell a joke, but I'm in interviewer mode right now."
    else:
        brief = "That's a great question outside of our interview scope, so I can't go into detail on that."
    return f"{brief} Now, back to the interview — {current_question}"




def llm_score_interview(
    chapter_title: str,
    context: str,
    transcript: list,
    pause_metrics: list,
    pass_threshold: int,
) -> dict:
    # Count GENUINE interview answers only. Each real answer records exactly one
    # pause-metric entry, whereas the greeting exchange and any chitchat turns add
    # student lines to the transcript WITHOUT a pause metric — so pause_metrics is
    # the authoritative count of questions actually answered (never inflated).
    num_answers = len(pause_metrics) if pause_metrics else 0
    if num_answers == 0:
        return {
            "technical_score": 0.0,
            "communication_score": 0.0,
            "confidence_score": 0.0,
            "overall_score": 0.0,
            "passed": False,
            "strengths": ["None (interview ended before starting)"],
            "weak_areas": ["Interview was terminated early without any answers."],
            "suggested_review": [f"Please complete the oral assessment for {chapter_title}."],
        }

    llm = get_grading_llm()
    dialogue = "\n".join(
        f"{m['speaker'].upper()}: {m['text']}" for m in transcript
    )
    avg_pause = 0
    avg_response = 0
    total_filler = 0
    avg_filler = 0
    if pause_metrics:
        avg_pause = sum(p.get("pause_count", 0) for p in pause_metrics) / len(pause_metrics)
        avg_response = sum(p.get("response_time_ms", 0) for p in pause_metrics) / len(pause_metrics)
        total_filler = sum(p.get("filler_word_count", 0) for p in pause_metrics)
        avg_filler = total_filler / len(pause_metrics)

    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are an expert evaluator for technical oral assessments. "
            "Score the student's interview performance based on the module content. "
            f"Pass threshold is {pass_threshold}%. "
            "Return ONLY valid JSON with keys: "
            "technical_score (0-100), communication_score (0-100), "
            "confidence_score (0-100), overall_score (0-100), passed (boolean), "
            "strengths (array of strings), weak_areas (array of strings), "
            "suggested_review (array of strings referencing module topics to re-study). "
            "Scoring guidelines: "
            "technical_score = accuracy and depth of answers vs module content; "
            "communication_score = clarity, structure, and coherence of speech "
            "(penalise heavily for excessive filler words); "
            "confidence_score = penalise for filler words (um, uh, mhm, hmm, like, you know) "
            "and long hesitation pauses — these directly signal uncertainty and poor preparation.\n"
            f"IMPORTANT: The student has only answered {num_answers} out of 5 questions. "
            "Unanswered questions must receive 0 marks. Pro-rate the technical, communication, "
            "and confidence scores down to reflect the fraction of questions answered."
        )
        user = (
            f"Module: {chapter_title}\n\n"
            f"Reference content:\n{context[:4000]}\n\n"
            f"Interview transcript:\n{dialogue}\n\n"
            f"Speech quality metrics:\n"
            f"- Avg hesitation pauses per answer: {avg_pause:.1f}\n"
            f"- Avg response time: {avg_response:.0f} ms\n"
            f"- Total filler words (um/uh/mhm/hmm/like/you know): {total_filler} "
            f"(avg {avg_filler:.1f} per answer)\n"
            "Filler words and long pauses must significantly reduce confidence_score and communication_score."
        )
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        result = _extract_json(resp.content)
        
        # Enforce proportional limit programmatically based on completion ratio
        completion_ratio = num_answers / 5.0
        result["technical_score"] = min(result.get("technical_score", 0.0), 100.0) * completion_ratio
        result["communication_score"] = min(result.get("communication_score", 0.0), 100.0) * completion_ratio
        result["confidence_score"] = min(result.get("confidence_score", 0.0), 100.0) * completion_ratio

        result["overall_score"] = round(
            result.get("technical_score", 0) * 0.5
            + result.get("communication_score", 0) * 0.3
            + result.get("confidence_score", 0) * 0.2,
            1,
        )
        result["passed"] = result["overall_score"] >= pass_threshold
        return result

    return _fallback_score(transcript, pause_metrics, pass_threshold, chapter_title)


def score_realtime_interview(
    course_name: str,
    context: str,
    transcript: list,
    pass_threshold: int,
) -> dict:
    """Grade a Realtime (speech-to-speech) interview from its transcript.

    The Realtime path is free-flowing — the browser talks directly to OpenAI, so
    there are no server-side pause/filler metrics and no fixed 5-question pacing.
    We therefore grade purely on the transcript: count the candidate's spoken
    turns and let the grading model assess technical depth, communication, and
    confidence. Returns the same shape as ``llm_score_interview`` so the
    Evaluation record and dashboards are unchanged.
    """
    student_turns = [m for m in (transcript or []) if m.get("speaker") == "student" and m.get("text", "").strip()]
    num_answers = len(student_turns)
    if num_answers == 0:
        return {
            "technical_score": 0.0,
            "communication_score": 0.0,
            "confidence_score": 0.0,
            "overall_score": 0.0,
            "passed": False,
            "strengths": ["None (interview ended before any answers)"],
            "weak_areas": ["The candidate did not answer any questions."],
            "suggested_review": [f"Please complete the oral assessment for {course_name}."],
        }

    llm = get_grading_llm()
    dialogue = "\n".join(f"{m['speaker'].upper()}: {m['text']}" for m in transcript)

    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are an expert evaluator for technical oral assessments. "
            "Score the candidate's spoken interview against the course material. "
            f"Pass threshold is {pass_threshold}%. "
            "Return ONLY valid JSON with keys: "
            "technical_score (0-100), communication_score (0-100), "
            "confidence_score (0-100), strengths (array of strings), "
            "weak_areas (array of strings), "
            "suggested_review (array of strings referencing course topics to re-study). "
            "Scoring guidelines: "
            "technical_score = accuracy and depth of answers vs the course material; "
            "communication_score = clarity, structure, and coherence of speech; "
            "confidence_score = decisiveness and fluency, penalising heavy hesitation, "
            "filler words, and 'I don't know' non-answers."
        )
        user = (
            f"Course: {course_name}\n\n"
            f"Reference material:\n{context[:4000]}\n\n"
            f"Interview transcript ({num_answers} candidate answers):\n{dialogue}"
        )
        try:
            resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
            result = _extract_json(resp.content)
            result["technical_score"] = min(max(result.get("technical_score", 0.0), 0.0), 100.0)
            result["communication_score"] = min(max(result.get("communication_score", 0.0), 0.0), 100.0)
            result["confidence_score"] = min(max(result.get("confidence_score", 0.0), 0.0), 100.0)
            result["overall_score"] = round(
                result["technical_score"] * 0.5
                + result["communication_score"] * 0.3
                + result["confidence_score"] * 0.2,
                1,
            )
            result["passed"] = result["overall_score"] >= pass_threshold
            result.setdefault("strengths", [])
            result.setdefault("weak_areas", [])
            result.setdefault("suggested_review", [])
            return result
        except Exception:
            pass

    # No LLM available — reuse the rule-based fallback with synthetic per-answer
    # metrics (one zero-metric entry per candidate turn).
    synthetic_metrics = [{"pause_count": 0, "filler_word_count": 0, "response_time_ms": 0} for _ in student_turns]
    return _fallback_score(transcript, synthetic_metrics, pass_threshold, course_name)


def llm_generate_mock_transcript(title: str) -> str:
    """
    Generate a realistic educational video transcript for a topic when YouTube
    captions are unavailable.  Used only as a fallback in the preview endpoint.
    """
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are a professional educator. Write a realistic 400-600 word educational "
            "video transcript for the given topic. Include an introduction, key concepts "
            "clearly explained with examples, and a brief summary. Write as if speaking "
            "to students. Return only the transcript text, no headings."
        )
        resp = llm.invoke([
            SystemMessage(content=system),
            HumanMessage(content=f"Write an educational video transcript about: {title}"),
        ])
        return resp.content.strip()

    return (
        f"Welcome to this module on {title}. "
        f"In this video we'll explore the core concepts of {title}, "
        "walk through practical examples, and summarise the key takeaways. "
        f"Understanding {title} is essential for building a solid foundation "
        "in this subject area."
    )


# ─── QUIZ GENERATION (dynamic, grounded in module video transcript + articles) ───

QUIZ_QUESTION_COUNT = 10
_QUIZ_BATCH_CHARS = 6000

# Randomized prompt facets — varied per request so each quiz feels fresh.
_QUIZ_FOCUS_AREAS = [
    "definitions and terminology",
    "core concepts and underlying principles",
    "processes and step-by-step workflows",
    "real-world examples and applications",
    "practical understanding and problem-solving",
    "comparisons, trade-offs and distinctions",
    "common mistakes and misconceptions",
    "cause-and-effect relationships",
]
_QUIZ_DIFFICULTIES = [
    "a balanced mix of easy and medium difficulty",
    "mostly medium difficulty with a couple of challenging questions",
    "an even spread from easy to hard",
    "medium-to-hard difficulty that tests deep understanding",
]


def _get_quiz_llm():
    """
    LLM tuned for diverse quiz generation: temperature 0.8-1.0 and top_p 0.9.
    A fresh random temperature each call helps every quiz come out different.
    """
    temperature = round(random.uniform(0.8, 1.0), 2)
    if OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=OPENAI_MODEL,
                temperature=temperature,
                top_p=0.9,
                api_key=OPENAI_API_KEY,
            )
        except Exception:
            pass

    return None


def _extract_json_list(text: str) -> list:
    """Parse a JSON array from an LLM response, tolerating fences/preamble."""
    text = text.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        start = text.find("[")
        end = text.rfind("]")
        if start >= 0 and end > start:
            data = json.loads(text[start : end + 1])
        else:
            raise
    if isinstance(data, dict) and "questions" in data:
        data = data["questions"]
    return data if isinstance(data, list) else []


def _valid_mcq(q) -> bool:
    if not isinstance(q, dict) or not str(q.get("question", "")).strip():
        return False
    opts = q.get("options")
    if not isinstance(opts, dict):
        return False
    if not all(k in opts and str(opts[k]).strip() for k in ("A", "B", "C", "D")):
        return False
    return str(q.get("correct", "")).strip().upper() in ("A", "B", "C", "D")


def _normalize_question(text: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", text.lower()).strip()


def _dedupe_questions(questions: list) -> list:
    """Keep only valid, non-duplicate MCQs (deduped by normalized question text)."""
    seen = set()
    out = []
    for q in questions:
        if not _valid_mcq(q):
            continue
        q["correct"] = str(q["correct"]).strip().upper()
        key = _normalize_question(str(q["question"]))
        if not key or key in seen:
            continue
        seen.add(key)
        out.append(q)
    return out


def _batch_content(text: str, max_chars: int = _QUIZ_BATCH_CHARS) -> list:
    """
    Split long content into sentence-aligned batches so the ENTIRE module is
    used (never truncated) even when it exceeds the LLM context window.
    """
    text = text.strip()
    if len(text) <= max_chars:
        return [text]
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    batches, current = [], ""
    for sentence in sentences:
        candidate = (current + " " + sentence).strip() if current else sentence
        if len(candidate) > max_chars and current:
            batches.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        batches.append(current)
    return batches


def _generate_quiz_batch(llm, title, content, count, focus_areas, difficulty, nonce) -> list:
    """Generate candidate MCQs from a single content batch."""
    from langchain_core.messages import HumanMessage, SystemMessage
    system = (
        "You are an expert educator creating multiple-choice quiz questions.\n"
        f"Generate exactly {count} MCQ questions based STRICTLY and ONLY on the provided module material.\n"
        "RULES:\n"
        "- Use ONLY the provided material. Do NOT invent facts or use any outside knowledge.\n"
        "- Each question must have exactly 4 options (A, B, C, D) with exactly ONE correct answer.\n"
        "- Make every question unique — never reword the same concept twice.\n"
        "- Cover diverse parts of the material: definitions, concepts, processes, examples, "
        "and practical understanding.\n"
        "- Return ONLY valid JSON: a JSON array of objects, each with keys "
        'id (integer), question (string), options (object with keys "A","B","C","D"), '
        'correct (one of "A","B","C","D").\n'
        "- No preamble, no explanations, no markdown fences — just the JSON array."
    )
    user = (
        f"Module: {title}\n\n"
        f"Module material:\n{content}\n\n"
        f"Focus especially on: {', '.join(focus_areas)}.\n"
        f"Use {difficulty}.\n"
        f"Generate {count} fresh, diverse MCQs that cover different concepts. "
        f"(Variation token {nonce}: use it only to vary your choices; never mention it.)\n"
        "Return ONLY the JSON array."
    )
    try:
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        return [q for q in _extract_json_list(resp.content) if _valid_mcq(q)]
    except Exception:
        return []


def llm_generate_quiz(
    chapter_title: str,
    video_transcript: str = None,
    article_content: str = None,
) -> list:
    """
    Dynamically generate exactly 10 MCQs grounded in the module's video transcript
    and article content (NO vector search / Pinecone — raw content is used directly).

    Long content is split into batches, each batch produces candidate questions,
    then results are merged, de-duplicated, and the final 10 are selected. Prompt
    facets and sampling are randomized so each generation is fresh (not cached,
    not templated).

    Returns list of {id, question, options:{A,B,C,D}, correct}.
    """
    parts = []
    if video_transcript and video_transcript.strip():
        parts.append("VIDEO TRANSCRIPT:\n" + video_transcript.strip())
    if article_content and article_content.strip():
        parts.append("ARTICLE CONTENT:\n" + article_content.strip())
    combined = "\n\n".join(parts).strip()

    llm = _get_quiz_llm()
    if not combined or llm is None:
        return _fallback_quiz_questions(chapter_title, combined)

    batches = _batch_content(combined)
    # Ask each batch for a few extra so we have spares for dedup/selection.
    per_batch = max(4, math.ceil(QUIZ_QUESTION_COUNT / len(batches)) + 2)

    candidates = []
    for batch in batches:
        focus = random.sample(_QUIZ_FOCUS_AREAS, k=min(3, len(_QUIZ_FOCUS_AREAS)))
        difficulty = random.choice(_QUIZ_DIFFICULTIES)
        nonce = random.randint(1000, 9999)
        candidates.extend(
            _generate_quiz_batch(llm, chapter_title, batch, per_batch, focus, difficulty, nonce)
        )

    unique = _dedupe_questions(candidates)
    random.shuffle(unique)  # randomize which questions are selected each time
    selected = unique[:QUIZ_QUESTION_COUNT]

    # Guarantee exactly 10 — top up from the rule-based fallback if the LLM
    # produced too few unique, valid questions.
    if len(selected) < QUIZ_QUESTION_COUNT:
        seen = {_normalize_question(str(q["question"])) for q in selected}
        for q in _fallback_quiz_questions(chapter_title, combined):
            if len(selected) >= QUIZ_QUESTION_COUNT:
                break
            key = _normalize_question(str(q["question"]))
            if key not in seen:
                seen.add(key)
                selected.append(q)

    selected = selected[:QUIZ_QUESTION_COUNT]
    for i, q in enumerate(selected):
        q["id"] = i + 1
    return selected


def _fallback_quiz_questions(title: str, context: str, count: int = QUIZ_QUESTION_COUNT) -> list:
    headings = re.findall(r"^#{1,3}\s+(.+)$", context or "", re.MULTILINE)
    keywords = re.findall(r"\*\*(.+?)\*\*", context or "")
    topics = (headings + keywords)[:count]
    while len(topics) < count:
        topics.append(f"{title} — concept {len(topics) + 1}")
    questions = []
    for i, topic in enumerate(topics[:count]):
        questions.append({
            "id": i + 1,
            "question": f"Which best describes '{topic.strip()}' in the context of {title}?",
            "options": {
                "A": f"A core concept central to understanding {title}",
                "B": f"An advanced topic outside the scope of this module",
                "C": f"A legacy pattern replaced by modern practices",
                "D": f"An optional feature not covered in this module",
            },
            "correct": "A",
        })
    return questions


def _fallback_questions(title: str, context: str) -> list:
    headings = re.findall(r"^#{1,3}\s+(.+)$", context, re.MULTILINE)
    keywords = re.findall(r"\*\*(.+?)\*\*", context)
    topics = headings[:3] or keywords[:3] or [title]
    questions = []
    for topic in topics:
        questions.append(
            f"In the context of {title}, explain the concept of '{topic.strip()}' "
            "and why it matters for a developer."
        )
    questions.append(
        f"Summarize the three most important takeaways from the {title} module "
        "and give a practical example for each."
    )
    questions.append(
        f"What common mistakes do beginners make regarding {title}, "
        "and how would you avoid them?"
    )
    return questions


def _fallback_score(transcript: list, pause_metrics: list, threshold: int, title: str) -> dict:
    # Genuine answers = number of recorded pause-metric entries (one per real
    # answer). The greeting reply and any chitchat add student transcript lines but
    # no pause metric, so they never inflate this count.
    num_answers = len(pause_metrics) if pause_metrics else 0
    if num_answers == 0:
        return {
            "technical_score": 0.0,
            "communication_score": 0.0,
            "confidence_score": 0.0,
            "overall_score": 0.0,
            "passed": False,
            "strengths": ["None (interview ended before starting)"],
            "weak_areas": ["Interview was terminated early without any answers."],
            "suggested_review": [f"Please complete the oral assessment for {title}."],
        }

    # Use the last `num_answers` student lines as the genuine answers for length
    # metrics (excludes the earlier greeting reply if present).
    student_msgs = [m["text"] for m in transcript if m["speaker"] == "student"][-num_answers:]
    total_words = sum(len(m.split()) for m in student_msgs)
    avg_len = total_words / max(num_answers, 1)

    avg_pauses = 0
    total_filler = 0
    avg_filler = 0
    if pause_metrics:
        avg_pauses = sum(p.get("pause_count", 0) for p in pause_metrics) / len(pause_metrics)
        total_filler = sum(p.get("filler_word_count", 0) for p in pause_metrics)
        avg_filler = total_filler / len(pause_metrics)

    # Pro-rate scores based on completion fraction (each answer adds up to 1/5th of the score)
    completion_ratio = num_answers / 5.0

    raw_technical = min(100.0, 40.0 + avg_len * 2.0 + num_answers * 8.0)
    raw_communication = min(100.0, max(20.0, 35.0 + avg_len * 1.5 + num_answers * 10.0 - avg_filler * 5.0))
    raw_confidence = max(20.0, min(100.0, 100.0 - avg_pauses * 8.0 - avg_filler * 4.0))

    technical = raw_technical * completion_ratio
    communication = raw_communication * completion_ratio
    confidence = raw_confidence * completion_ratio

    overall = round(technical * 0.5 + communication * 0.3 + confidence * 0.2, 1)
    passed = overall >= threshold

    strengths, weak_areas = [], []
    if avg_len > 30:
        strengths.append("Provided detailed, structured answers.")
    else:
        weak_areas.append("Answers were too brief — expand with examples.")
    if avg_pauses > 3:
        weak_areas.append("Frequent long pauses suggest uncertainty — review the module.")
    else:
        strengths.append("Responded with reasonable confidence and flow.")
    if avg_filler > 3:
        weak_areas.append(f"High use of filler words ({int(total_filler)} total: um, uh, mhm, like, you know) — practice speaking more deliberately.")
    elif avg_filler == 0:
        strengths.append("Spoke clearly without excessive filler words.")
    if num_answers >= 3:
        strengths.append("Engaged well across multiple interview questions.")

    return {
        "technical_score": round(technical, 1),
        "communication_score": round(communication, 1),
        "confidence_score": round(confidence, 1),
        "overall_score": overall,
        "passed": passed,
        "strengths": strengths or ["Showed willingness to participate."],
        "weak_areas": weak_areas or ["Continue practicing verbal explanations."],
        "suggested_review": [f"Re-watch and re-read: {title}"] if not passed else [],
    }



