"""LLM wrapper — Groq (primary), OpenAI (fallback), then rule-based scoring."""
import json
import os
import re

GROQ_API_KEY = os.getenv("GROQ_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")


def get_llm():
    """Return a LangChain chat model. Prefers Groq, then OpenAI."""
    if GROQ_API_KEY:
        try:
            from langchain_groq import ChatGroq
            return ChatGroq(
                model=os.getenv("GROQ_MODEL", "llama-3.3-70b-versatile"),
                temperature=0.7,
                groq_api_key=GROQ_API_KEY,
            )
        except Exception:
            pass

    if OPENAI_API_KEY:
        try:
            from langchain_openai import ChatOpenAI
            return ChatOpenAI(
                model=os.getenv("OPENAI_MODEL", "gpt-4o-mini"),
                temperature=0.7,
                api_key=OPENAI_API_KEY,
            )
        except Exception:
            pass

    return None


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


def llm_generate_question(
    chapter_title: str,
    context: str,
    transcript: list,
    question_number: int,
) -> str:
    llm = get_llm()
    history = "\n".join(
        f"{m['speaker'].upper()}: {m['text']}" for m in transcript[-6:]
    )
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are an expert technical interviewer for an online learning platform. "
            "Ask ONE clear oral interview question based ONLY on the module content provided. "
            "Questions should test deep understanding, not memorization. "
            "Use follow-up style when prior answers exist. "
            "Return ONLY the question text, no preamble."
        )
        user = (
            f"Module: {chapter_title}\n\n"
            f"Content:\n{context[:6000]}\n\n"
            f"Conversation so far:\n{history or 'None yet'}\n\n"
            f"This is question #{question_number} of up to 5. "
            "Ask the next interview question."
        )
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        return resp.content.strip()

    fallback_questions = _fallback_questions(chapter_title, context)
    idx = min(question_number - 1, len(fallback_questions) - 1)
    if transcript and question_number > 1:
        last_student = next(
            (m["text"] for m in reversed(transcript) if m["speaker"] == "student"),
            "",
        )
        return (
            f"Good. Can you elaborate further on your previous point about "
            f"'{last_student[:80]}...'? Specifically, how would you apply that concept "
            f"from {chapter_title} in a real-world scenario?"
        )
    return fallback_questions[idx]


def llm_score_interview(
    chapter_title: str,
    context: str,
    transcript: list,
    pause_metrics: list,
    pass_threshold: int,
) -> dict:
    llm = get_llm()
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
            "and long hesitation pauses — these directly signal uncertainty and poor preparation."
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
        result["overall_score"] = round(
            result.get("technical_score", 0) * 0.5
            + result.get("communication_score", 0) * 0.3
            + result.get("confidence_score", 0) * 0.2,
            1,
        )
        result["passed"] = result["overall_score"] >= pass_threshold
        return result

    return _fallback_score(transcript, pause_metrics, pass_threshold, chapter_title)


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


def llm_generate_quiz(chapter_title: str, context: str) -> list:
    """
    Generate 5 MCQ questions from chapter content.
    Returns list of {id, question, options:{A,B,C,D}, correct} — includes correct answers for server-side grading.
    """
    llm = get_llm()
    if llm:
        from langchain_core.messages import HumanMessage, SystemMessage
        system = (
            "You are an expert educator creating a multiple-choice quiz. "
            "Generate exactly 5 MCQ questions based ONLY on the provided module content. "
            "Each question must have 4 options (A, B, C, D) with exactly one correct answer. "
            "Return ONLY valid JSON — a list of 5 objects, each with keys: "
            "id (integer 1-5), question (string), options (object with keys A/B/C/D), correct (one of A/B/C/D). "
            "No preamble, no markdown fences, just the JSON array."
        )
        user = (
            f"Module: {chapter_title}\n\n"
            f"Content:\n{context[:5000]}\n\n"
            "Generate 5 MCQ questions."
        )
        resp = llm.invoke([SystemMessage(content=system), HumanMessage(content=user)])
        try:
            data = _extract_json(resp.content)
            if isinstance(data, list) and len(data) >= 5:
                return data[:5]
            if isinstance(data, dict) and "questions" in data:
                qs = data["questions"]
                if isinstance(qs, list) and len(qs) >= 5:
                    return qs[:5]
        except Exception:
            pass

    return _fallback_quiz_questions(chapter_title, context)


def _fallback_quiz_questions(title: str, context: str) -> list:
    headings = re.findall(r"^#{1,3}\s+(.+)$", context, re.MULTILINE)
    keywords = re.findall(r"\*\*(.+?)\*\*", context)
    topics = (headings + keywords)[:5]
    while len(topics) < 5:
        topics.append(f"{title} — concept {len(topics) + 1}")
    questions = []
    for i, topic in enumerate(topics[:5]):
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
    student_msgs = [m["text"] for m in transcript if m["speaker"] == "student"]
    total_words = sum(len(m.split()) for m in student_msgs)
    avg_len = total_words / max(len(student_msgs), 1)

    technical = min(100, 40 + avg_len * 2 + len(student_msgs) * 8)

    avg_pauses = 0
    total_filler = 0
    avg_filler = 0
    if pause_metrics:
        avg_pauses = sum(p.get("pause_count", 0) for p in pause_metrics) / len(pause_metrics)
        total_filler = sum(p.get("filler_word_count", 0) for p in pause_metrics)
        avg_filler = total_filler / len(pause_metrics)

    # Filler words reduce communication score; pauses reduce confidence score
    communication = min(100, max(20, 35 + avg_len * 1.5 + len(student_msgs) * 10 - avg_filler * 5))
    confidence = max(20, min(100, 85 - avg_pauses * 8 - avg_filler * 4))

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
    if len(student_msgs) >= 3:
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



