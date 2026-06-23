"""
LangGraph-powered interview orchestrator.

Turn-based flow for REST API:
  start_interview()  → greeting + opening question
  process_answer()   → classify → chitchat reply OR follow-up question OR final scoring
"""
from typing import TypedDict, Optional, List
from langgraph.graph import StateGraph, END

from app.services.llm import (
    llm_generate_question,
    llm_score_interview,
    llm_classify_response,
    llm_handle_chitchat,
)

MAX_QUESTIONS = 5


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
    pause_metrics.append({
        "question_number": state.get("question_count", 0),
        "response_time_ms": state.get("last_response_time_ms", 0),
        "pause_count": state.get("last_pause_count", 0),
        "long_pause_ms": state.get("last_long_pause_ms", 0),
        "filler_word_count": state.get("last_filler_word_count", 0),
    })
    return {**state, "transcript": transcript, "pause_metrics": pause_metrics}


def _route_after_answer(state: InterviewState) -> str:
    if state.get("question_count", 0) >= MAX_QUESTIONS:
        return "score"
    answer = state.get("last_answer", "")
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


def _build_start_graph():
    """Graph for interview start: generate opening question."""
    g = StateGraph(InterviewState)
    g.add_node("generate_question", _generate_question)
    g.set_entry_point("generate_question")
    g.add_edge("generate_question", END)
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
    greeting = (
        f"Hello! I'm Mav, your AI interviewer today. "
        f"I hope you're doing well. "
        f"We'll be covering '{chapter_title}' in this session. Let's begin the interview."
    )
    initial: InterviewState = {
        "chapter_title": chapter_title,
        "chapter_context": chapter_context,
        "pass_threshold": pass_threshold,
        "transcript": [{"speaker": "ai", "text": greeting}],
        "pause_metrics": [],
        "question_count": 0,
        "is_complete": False,
        "is_chitchat": False,
        "current_question": None,
        "phase": "greeting",
    }
    # Generate the first question after the greeting
    result = dict(_get_start_graph().invoke(initial))
    # Prepend the greeting so TTS speaks greeting + question together
    greeting_plus_q = greeting + " " + result.get("next_question", "")
    result["next_question"] = greeting_plus_q
    # The transcript already has both entries (greeting + Q1) from the graph
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

    current_q = state.get("current_question") or state.get("next_question", "")

    # ── Classify the student's input ──
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
