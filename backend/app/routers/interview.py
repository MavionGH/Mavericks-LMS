import logging
import time
from typing import Union
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from sqlalchemy.orm import Session, joinedload, load_only

from app.database import get_db
from app.models.models import (
    Chapter, Course, Enrollment, Evaluation, EvaluationType,
    InterviewSession, User,
)
from app.schemas.schemas import (
    InterviewStartRequest, CourseInterviewStartRequest, InterviewAnswerRequest,
    InterviewTurnResponse, InterviewResultResponse, InterviewEligibilityResponse,
)
from app.auth.dependencies import require_student
from app.services.chapter_context import build_chapter_context, build_course_context
from app.services.interview_graph import start_interview, process_answer, MAX_QUESTIONS
from app.services.stt import transcribe_audio
from app.services.storage import upload_recording_to_r2

# Hard cap on the uploaded interview recording (screen + audio for the whole
# session). Generous because a multi-minute screen capture is far larger than a
# single spoken answer, but still bounded to stop a runaway upload.
MAX_RECORDING_BYTES = 200 * 1024 * 1024

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/interview", tags=["Interview"])


@router.get("/eligibility/{chapter_id}", response_model=InterviewEligibilityResponse)
def check_eligibility(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    # Enrollment is the ONLY requirement (requirement #2). A single indexed
    # lookup on (chapter_id) + (user_id, course_id) — no chapter/quiz/session
    # fan-out — keeps this endpoint cheap.
    chapter = (
        db.query(Chapter)
        .options(load_only(Chapter.course_id))
        .filter(Chapter.id == chapter_id)
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        return InterviewEligibilityResponse(eligible=False, reason="Not enrolled in this course")

    return InterviewEligibilityResponse(
        eligible=True,
        video_watched=True,
        article_read=True,
        enrollment_id=enrollment.id,
    )


@router.post("/transcribe")
async def transcribe_answer(
    audio: UploadFile = File(...),
    current_user: User = Depends(require_student),
):
    """Server-side speech-to-text for the oral assessment.

    The browser records the student's spoken answer and uploads it here; we run it
    through OpenAI Whisper and return the text. This replaces the browser Web Speech
    API, which fails silently on networks that can't reach Google's STT backend.
    """
    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    # Guard against runaway uploads (a normal answer is well under this).
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio too large")
    # transcribe_audio makes a blocking OpenAI HTTP call. Run it in the threadpool so
    # it never freezes the event loop (which would stall every other request while a
    # student's answer is being transcribed).
    text = await run_in_threadpool(transcribe_audio, audio_bytes, audio.filename or "answer.webm")
    return {"text": text}


@router.post("/recording/{session_id}")
async def upload_interview_recording(
    session_id: str,
    recording: UploadFile = File(...),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """Store the full screen+audio recording of an interview in Cloudflare R2.

    The browser records the entire session (shared screen + Mav's voice + the
    student's mic) and uploads the finished blob here when the interview ends. We
    push it to R2 and save the public URL on the session so a teacher can replay it.
    """
    session = db.query(InterviewSession).filter(
        InterviewSession.id == session_id,
        InterviewSession.user_id == current_user.id,
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Interview session not found")

    # Stream-size guard: read into memory once (boto3 needs a seekable body) but
    # reject anything implausibly large before touching R2.
    data = await recording.read()
    if not data:
        raise HTTPException(status_code=400, detail="Empty recording upload")
    if len(data) > MAX_RECORDING_BYTES:
        raise HTTPException(status_code=413, detail="Recording too large")

    # Rewind so upload_recording_to_r2 reads from the start.
    recording.file.seek(0)
    # boto3's R2 upload is blocking and can take many seconds for a large recording.
    # Run it in the threadpool so the event loop stays free and other requests
    # (interview answers, etc.) aren't blocked for the duration of the upload.
    url = await run_in_threadpool(upload_recording_to_r2, recording)

    session.recording_url = url
    db.commit()
    return {"recording_url": url}


@router.post("/start", response_model=InterviewTurnResponse)
def start_interview_session(
    data: InterviewStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    _t0 = time.perf_counter()

    # ── Eligibility: enrollment is the ONLY requirement to start an interview ──
    # (video/article/quiz gating intentionally removed — see requirement #2.)
    chapter = (
        db.query(Chapter)
        .options(joinedload(Chapter.course))
        .filter(Chapter.id == data.chapter_id)
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=400, detail="Not enrolled in this course")

    db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.chapter_id == data.chapter_id,
        InterviewSession.status == "active",
    ).update({"status": "abandoned"})
    db.commit()

    # Pull primitives off the ORM objects up front so we don't depend on the
    # session after this point (the course is already loaded via joinedload, so
    # no extra query is issued).
    course = chapter.course
    course_pass_threshold = course.pass_threshold if course else 70
    chapter_title = chapter.title
    _t_db = time.perf_counter()

    # No vector search / embedding model: a single module's text is used directly.
    context = build_chapter_context(chapter)
    _t_ctx = time.perf_counter()

    graph_state = start_interview(chapter_title, context, course_pass_threshold)
    _t_graph = time.perf_counter()
    logger.info(
        "interview/start timing — db=%.0fms context=%.0fms graph=%.0fms total=%.0fms",
        (_t_db - _t0) * 1000, (_t_ctx - _t_db) * 1000,
        (_t_graph - _t_ctx) * 1000, (_t_graph - _t0) * 1000,
    )

    session = InterviewSession(
        user_id=current_user.id,
        chapter_id=data.chapter_id,
        status="active",
        transcript=graph_state.get("transcript", []),
        pause_metrics=[],
        question_count=graph_state.get("question_count", 1),
        graph_state=graph_state,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return InterviewTurnResponse(
        session_id=session.id,
        speaker="ai",
        text=graph_state.get("next_question", ""),
        is_complete=False,
        waiting_for_student=True,
        question_number=graph_state.get("question_count", 1),
        total_questions=MAX_QUESTIONS,
        greeting=graph_state.get("greeting"),
        greeting_completed=False,
    )


# ─── COURSE-WIDE FINAL INTERVIEW ───
# Optional, ungated, available at any time. The AI interviewer (Mav) draws on the
# knowledge of EVERY module in the course (all video transcripts + articles).

@router.get("/course/eligibility/{course_id}", response_model=InterviewEligibilityResponse)
def check_course_eligibility(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == course_id,
    ).first()
    if not enrollment:
        return InterviewEligibilityResponse(eligible=False, reason="Enroll in this course first")

    if not course.chapters:
        return InterviewEligibilityResponse(eligible=False, reason="This course has no modules yet")

    return InterviewEligibilityResponse(eligible=True, enrollment_id=enrollment.id)


@router.post("/course/start", response_model=InterviewTurnResponse)
def start_course_interview(
    data: CourseInterviewStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    course = db.query(Course).filter(Course.id == data.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == data.course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=400, detail="Not enrolled in this course")

    if not course.chapters:
        raise HTTPException(status_code=400, detail="This course has no modules yet")

    # Abandon any prior active course interview for a clean restart.
    db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.course_id == data.course_id,
        InterviewSession.chapter_id.is_(None),
        InterviewSession.status == "active",
    ).update({"status": "abandoned"})
    db.commit()

    # Cache primitive values before building context (which may touch the network /
    # vector store) so we never depend on the ORM session afterwards.
    course_title = course.title
    course_pass_threshold = course.pass_threshold or 70

    context = build_course_context(
        course,
        query=f"key concepts and topics across all modules of {course.title} for a comprehensive oral assessment",
        db=db,
    )
    graph_state = start_interview(course_title, context, course_pass_threshold)

    session = InterviewSession(
        user_id=current_user.id,
        chapter_id=None,
        course_id=data.course_id,
        status="active",
        transcript=graph_state.get("transcript", []),
        pause_metrics=[],
        question_count=graph_state.get("question_count", 1),
        graph_state=graph_state,
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return InterviewTurnResponse(
        session_id=session.id,
        speaker="ai",
        text=graph_state.get("next_question", ""),
        is_complete=False,
        waiting_for_student=True,
        question_number=graph_state.get("question_count", 1),
        total_questions=MAX_QUESTIONS,
        greeting=graph_state.get("greeting"),
        greeting_completed=False,
    )


@router.post("/answer", response_model=Union[InterviewTurnResponse, InterviewResultResponse])
def submit_answer(
    data: InterviewAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    session = db.query(InterviewSession).filter(
        InterviewSession.id == data.session_id,
        InterviewSession.user_id == current_user.id,
        InterviewSession.status == "active",
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Active interview session not found")

    if not data.answer_text.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")

    _t0 = time.perf_counter()
    graph_state = process_answer(
        session.graph_state,
        data.answer_text.strip(),
        data.response_time_ms,
        data.pause_count,
        data.long_pause_ms,
        data.filler_word_count,
    )
    logger.info(
        "interview/answer process_answer=%.0fms (complete=%s chitchat=%s)",
        (time.perf_counter() - _t0) * 1000,
        graph_state.get("is_complete"), graph_state.get("is_chitchat"),
    )

    session.graph_state = graph_state
    session.transcript = graph_state.get("transcript", [])
    session.pause_metrics = graph_state.get("pause_metrics", [])
    session.question_count = graph_state.get("question_count", session.question_count)

    if graph_state.get("is_complete"):
        return _finalize_session(db, session, current_user)

    db.commit()

    is_chitchat = graph_state.get("is_chitchat", False)
    return InterviewTurnResponse(
        session_id=session.id,
        speaker="ai",
        text=graph_state.get("next_question", ""),
        is_complete=False,
        waiting_for_student=True,
        # During chitchat, hold the question number at the current displayed count
        question_number=graph_state.get("question_count", 1),
        total_questions=MAX_QUESTIONS,
        is_chitchat=is_chitchat,
    )


@router.post("/end/{session_id}", response_model=InterviewResultResponse)
def end_interview_early(
    session_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    session = db.query(InterviewSession).filter(
        InterviewSession.id == session_id,
        InterviewSession.user_id == current_user.id,
        InterviewSession.status == "active",
    ).first()
    if not session:
        raise HTTPException(status_code=404, detail="Active interview session not found")

    from app.services.interview_graph import _score_interview
    graph_state = dict(session.graph_state or {})
    graph_state = _score_interview(graph_state)
    session.graph_state = graph_state
    return _finalize_session(db, session, current_user)


def _finalize_session(db: Session, session: InterviewSession, user: User) -> InterviewResultResponse:
    graph_state = session.graph_state or {}
    evaluation = graph_state.get("evaluation", {})

    # ── Course-wide final interview ──
    # Optional and ungated: it records a CAPSTONE evaluation but never alters the
    # student's module progression (that is driven entirely by passing quizzes).
    if session.course_id and not session.chapter_id:
        course = db.query(Course).filter(Course.id == session.course_id).first()

        prev_attempts = db.query(Evaluation).filter(
            Evaluation.user_id == user.id,
            Evaluation.type == EvaluationType.CAPSTONE,
            Evaluation.chapter_id.is_(None),
        ).count()

        ev = Evaluation(
            user_id=user.id,
            chapter_id=None,
            course_id=session.course_id,
            type=EvaluationType.CAPSTONE,
            transcript=graph_state.get("transcript", []),
            technical_score=evaluation.get("technical_score", 0),
            communication_score=evaluation.get("communication_score", 0),
            confidence_score=evaluation.get("confidence_score", 0),
            overall_score=evaluation.get("overall_score", 0),
            passed=evaluation.get("passed", False),
            strengths=evaluation.get("strengths", []),
            weak_areas=evaluation.get("weak_areas", []),
            suggested_review=evaluation.get("suggested_review", []),
            attempt_number=prev_attempts + 1,
        )
        db.add(ev)

        session.status = "completed"
        session.transcript = graph_state.get("transcript", [])
        db.commit()

        return InterviewResultResponse(
            session_id=session.id,
            passed=evaluation.get("passed", False),
            technical_score=evaluation.get("technical_score", 0),
            communication_score=evaluation.get("communication_score", 0),
            confidence_score=evaluation.get("confidence_score", 0),
            overall_score=evaluation.get("overall_score", 0),
            strengths=evaluation.get("strengths", []),
            weak_areas=evaluation.get("weak_areas", []),
            suggested_review=evaluation.get("suggested_review", []),
            transcript=graph_state.get("transcript", []),
            next_chapter_unlocked=False,
            chapter_title=course.title if course else "",
        )

    # ── Per-module interview (legacy path) ──
    chapter = db.query(Chapter).filter(Chapter.id == session.chapter_id).first()

    prev_attempts = db.query(Evaluation).filter(
        Evaluation.user_id == user.id,
        Evaluation.chapter_id == session.chapter_id,
    ).count()

    ev = Evaluation(
        user_id=user.id,
        chapter_id=session.chapter_id,
        course_id=chapter.course_id if chapter else None,
        type=EvaluationType.CHAPTER,
        transcript=graph_state.get("transcript", []),
        technical_score=evaluation.get("technical_score", 0),
        communication_score=evaluation.get("communication_score", 0),
        confidence_score=evaluation.get("confidence_score", 0),
        overall_score=evaluation.get("overall_score", 0),
        passed=evaluation.get("passed", False),
        strengths=evaluation.get("strengths", []),
        weak_areas=evaluation.get("weak_areas", []),
        suggested_review=evaluation.get("suggested_review", []),
        attempt_number=prev_attempts + 1,
    )
    db.add(ev)

    session.status = "completed"
    session.transcript = graph_state.get("transcript", [])

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()

    next_unlocked = False
    if evaluation.get("passed") and enrollment:
        sorted_chapters = sorted(chapter.course.chapters, key=lambda c: c.order_index)
        if enrollment.current_chapter_index + 1 < len(sorted_chapters):
            enrollment.current_chapter_index += 1
            enrollment.video_watched = False
            enrollment.article_read = False
            next_unlocked = True
        else:
            from app.models.models import EnrollmentStatus
            enrollment.status = EnrollmentStatus.CAPSTONE_READY
            next_unlocked = True
    elif enrollment and not evaluation.get("passed"):
        enrollment.video_watched = False
        enrollment.article_read = False

    db.commit()

    return InterviewResultResponse(
        session_id=session.id,
        passed=evaluation.get("passed", False),
        technical_score=evaluation.get("technical_score", 0),
        communication_score=evaluation.get("communication_score", 0),
        confidence_score=evaluation.get("confidence_score", 0),
        overall_score=evaluation.get("overall_score", 0),
        strengths=evaluation.get("strengths", []),
        weak_areas=evaluation.get("weak_areas", []),
        suggested_review=evaluation.get("suggested_review", []),
        transcript=graph_state.get("transcript", []),
        next_chapter_unlocked=next_unlocked and evaluation.get("passed", False),
        chapter_title=chapter.title,
    )
