"""
LangGraph-powered interview orchestrator.

Turn-based flow for REST API:
  start_interview()  → greeting + opening question
  process_answer()   → classify → chitchat reply OR follow-up question OR final scoring
"""
import re
from typing import TypedDict, Optional, List
from langgraph.graph import StateGraph, END

from app.services.llm import (
    llm_generate_question,
    llm_score_interview,
    llm_classify_response,
    llm_handle_chitchat,
)

MAX_QUESTIONS = 5


# Phrases that signal a skip / I-don't-know non-answer
_SKIP_PHRASES = (
    "i don't know", "i dont know", "i do not know",
    "not sure", "no idea", "no experience",
    "i have no experience", "skip", "pass", "move on",
    "move to next", "next question", "i'm not sure",
    "i am not sure", "don't know", "dont know",
)


class InterviewState(TypedDict, total=False):
    chapter_title: str
    chapter_context: str
    pass_threshold: int
    transcript: List[dict]
    pause_metrics: List[dict]
    question_count: int
    last_answer: Optional[str]
    last_response_time_ms: int
    last_pause_count: int
    last_long_pause_ms: int
    last_filler_word_count: int
    next_question: Optional[str]   # text to send back to the student
    current_question: Optional[str]  # the active pending interview question
    greeting: Optional[str]         # one-time greeting, separate from Q1
    greeting_completed: bool        # True once greeting has been delivered
    microphone_active: bool         # frontend hint
    current_question_pending: bool  # True while waiting for student answer
    is_complete: bool
    is_chitchat: bool              # True when the last response was a chitchat reply
    evaluation: Optional[dict]
    phase: str


def _generate_question(state: InterviewState) -> InterviewState:
    q_num = state.get("question_count", 0) + 1
    question = llm_generate_question(
        state["chapter_title"],
        state["chapter_context"],
        state.get("transcript", []),
        q_num,
    )
    transcript = list(state.get("transcript", []))
    transcript.append({"speaker": "ai", "text": question})
    return {
        **state,
        "transcript": transcript,
        "question_count": q_num,
        "current_question": question,
        "next_question": question,
        "is_chitchat": False,
        "phase": "asking",
        "is_complete": False,
    }


def _record_answer(state: InterviewState) -> InterviewState:
    transcript = list(state.get("transcript", []))
    answer = state.get("last_answer", "").strip()
    if answer:
        transcript.append({"speaker": "student", "text": answer})

    pause_metrics = list(state.get("pause_metrics", []))
    if state.get("question_count", 0) > 0:
        pause_metrics.append({
            "question_number": state.get("question_count", 0),
            "response_time_ms": state.get("last_response_time_ms", 0),
            "pause_count": state.get("last_pause_count", 0),
            "long_pause_ms": state.get("last_long_pause_ms", 0),
            "filler_word_count": state.get("last_filler_word_count", 0),
        })
    return {**state, "transcript": transcript, "pause_metrics": pause_metrics}


def _is_skip_or_dont_know(answer: str) -> bool:
    """Return True if the answer is a non-answer (skip, I don't know, pass, etc.)."""
    low = answer.strip().lower()
    return any(phrase in low for phrase in _SKIP_PHRASES)


# Cheap chitchat regexes (mirror the rule-based fallback in llm.py) used only to
# decide whether we can SKIP the LLM classification call. A reply that trips none
# of these and is reasonably long is treated as a genuine answer locally.
_CHITCHAT_RE = re.compile(
    r"\b(how are you|how do you do|you doing|what('?s| is) up|how'?s it going|"
    r"what do you mean|can you (explain|clarify|elaborate|rephrase|repeat)|"
    r"i don'?t understand|who (are|is) you|your name|tell me a joke|joke|"
    r"weather|the time|what time|today'?s date)\b",
    re.IGNORECASE,
)
_GREETING_ONLY_RE = re.compile(
    r"^\s*(hi+|hello+|hey+|good (morning|afternoon|evening|day)|howdy|sup|yo|greetings)\b",
    re.IGNORECASE,
)


def _is_clearly_an_answer(answer: str) -> bool:
    """True when we can safely classify locally as a genuine answer (no LLM call).

    Conservative on purpose: only short-circuits long replies that contain no
    chitchat/greeting/clarification cues and aren't phrased as a question, so
    borderline inputs still reach the LLM classifier and behaviour is preserved.
    """
    text = answer.strip()
    if len(text.split()) < 12:
        return False
    if text.endswith("?"):
        return False
    if _GREETING_ONLY_RE.match(text) or _CHITCHAT_RE.search(text):
        return False
    return True


def _route_after_answer(state: InterviewState) -> str:
    if state.get("question_count", 0) >= MAX_QUESTIONS:
        return "score"
    answer = state.get("last_answer", "")
    # Skip / I-don't-know always advances (never blocks)
    if _is_skip_or_dont_know(answer):
        return "follow_up"
    # Very short answer after many questions → wrap up
    if len(answer.split()) < 5 and state.get("question_count", 0) >= 3:
        return "score"
    return "follow_up"


def _score_interview(state: InterviewState) -> InterviewState:
    evaluation = llm_score_interview(
        state["chapter_title"],
        state["chapter_context"],
        state.get("transcript", []),
        state.get("pause_metrics", []),
        state.get("pass_threshold", 70),
    )
    closing = (
        "Thank you for completing this oral assessment. "
        f"Your composite score is {evaluation['overall_score']}%. "
        + (
            "Congratulations — you've demonstrated sufficient mastery to proceed."
            if evaluation["passed"]
            else "You need more review of this module before advancing. "
            "Please re-watch the video and re-read the article, then try again."
        )
        + " Take care, bye!"
    )
    transcript = list(state.get("transcript", []))
    transcript.append({"speaker": "ai", "text": closing})
    return {
        **state,
        "transcript": transcript,
        "evaluation": evaluation,
        "is_complete": True,
        "is_chitchat": False,
        "phase": "scoring",
        "next_question": closing,
    }


def _greet_student(state: InterviewState) -> InterviewState:
    greeting = (
        "Hello! Welcome to your interview. I'm Mav, your AI interviewer, and I'm glad "
        "to be speaking with you today. We'll go through a few questions about this module. "
        "Feel free to ask me to repeat or clarify anything at any time. Let's begin."
    )
    transcript = list(state.get("transcript", []))
    if not any(m.get("text") == greeting for m in transcript):
        transcript.append({"speaker": "ai", "text": greeting})
    return {
        **state,
        "transcript": transcript,
        "greeting": greeting,
        "next_question": greeting,
        "current_question": greeting,
        "greeting_completed": True,
        "phase": "greeting",
    }


def _build_start_graph():
    """Graph for interview start: greet, then immediately generate Question 1.

    Per the interview spec, the greeting flows straight into the first question
    in a single turn — the student's first spoken reply is the answer to Q1, not
    a reply to the greeting.
    """
    g = StateGraph(InterviewState)
    g.add_node("GreetingNode", _greet_student)
    g.add_node("FirstQuestion", _generate_question)
    g.set_entry_point("GreetingNode")
    g.add_edge("GreetingNode", "FirstQuestion")
    g.add_edge("FirstQuestion", END)
    return g.compile()


def _build_answer_graph():
    """Graph for each answer turn: record → route → follow-up OR score."""
    g = StateGraph(InterviewState)
    g.add_node("record_answer", _record_answer)
    g.add_node("follow_up", _generate_question)
    g.add_node("score_interview", _score_interview)

    g.set_entry_point("record_answer")
    g.add_conditional_edges(
        "record_answer",
        _route_after_answer,
        {"follow_up": "follow_up", "score": "score_interview"},
    )
    g.add_edge("follow_up", END)
    g.add_edge("score_interview", END)
    return g.compile()


_start_graph = None
_answer_graph = None


def _get_start_graph():
    global _start_graph
    if _start_graph is None:
        _start_graph = _build_start_graph()
    return _start_graph


def _get_answer_graph():
    global _answer_graph
    if _answer_graph is None:
        _answer_graph = _build_answer_graph()
    return _answer_graph


def start_interview(chapter_title: str, chapter_context: str, pass_threshold: int) -> dict:
    initial: InterviewState = {
        "chapter_title": chapter_title,
        "chapter_context": chapter_context,
        "pass_threshold": pass_threshold,
        "transcript": [],
        "pause_metrics": [],
        "question_count": 0,
        "is_complete": False,
        "is_chitchat": False,
        "greeting_completed": False,
        "microphone_active": False,
        "current_question_pending": False,
        "current_question": None,
        "greeting": None,
        "phase": "greeting",
    }
    # Invoke start graph (runs greet_student -> generate_question)
    result = dict(_get_start_graph().invoke(initial))
    # Deliver greeting + Question 1 as ONE spoken turn so the avatar speaks them
    # back-to-back and the student's first answer is for Q1. `current_question`
    # stays Q1 (used for classification / re-asks); `greeting` stays separate.
    greeting = result.get("greeting", "")
    first_question = result.get("current_question", "")
    if greeting and first_question and not result.get("is_complete"):
        result["next_question"] = f"{greeting}\n\n{first_question}"
    return result


def process_answer(
    state: dict,
    answer: str,
    response_time_ms: int = 0,
    pause_count: int = 0,
    long_pause_ms: int = 0,
    filler_word_count: int = 0,
) -> dict:
    """Process the student's message — classify first, then route appropriately."""
    state = dict(state)

    # ── Backward-compat path: question_count == 0 means this session was started
    # under the old flow (greeting-only first turn). New sessions arrive with Q1
    # already asked (question_count == 1), so this branch only runs for sessions
    # that were already active before greeting+Q1 were merged into one turn. ──
    if state.get("question_count", 0) == 0:
        state["last_answer"] = answer
        state["last_response_time_ms"] = 0
        state["last_pause_count"] = 0
        state["last_long_pause_ms"] = 0
        state["last_filler_word_count"] = 0
        result = dict(_get_answer_graph().invoke(state))
        result["is_chitchat"] = False
        return result

    current_q = state.get("current_question") or state.get("next_question", "")

    # ── Classify the student's input ──
    # Fast path: a long, substantive reply that matches none of the chitchat
    # patterns is virtually always a genuine answer. Treating it as such locally
    # skips an entire LLM round-trip (the classify call) on the common case,
    # roughly halving per-answer latency. Ambiguous/short inputs still go to the
    # LLM classifier so greeting/personal/clarification/offtopic handling is
    # unchanged.
    if _is_clearly_an_answer(answer):
        category = "answer"
    else:
        category = llm_classify_response(answer, current_q)

    if category in ("greeting", "personal", "clarification", "offtopic"):
        # Generate a conversational reply without advancing the interview
        reply = llm_handle_chitchat(answer, current_q, category)

        # Record student message + Mav's chitchat reply in transcript
        transcript = list(state.get("transcript", []))
        transcript.append({"speaker": "student", "text": answer})
        transcript.append({"speaker": "ai", "text": reply})

        return {
            **state,
            "transcript": transcript,
            "next_question": reply,
            "current_question": current_q,   # keep the same question pending
            "is_chitchat": True,
            "is_complete": False,
        }

    # ── Genuine answer path — proceed through the normal graph ──
    state["last_answer"] = answer
    state["last_response_time_ms"] = response_time_ms
    state["last_pause_count"] = pause_count
    state["last_long_pause_ms"] = long_pause_ms
    state["last_filler_word_count"] = filler_word_count
    result = dict(_get_answer_graph().invoke(state))
    result["is_chitchat"] = False
    return result
