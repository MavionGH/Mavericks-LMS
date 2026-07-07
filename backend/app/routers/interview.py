import base64
import logging
import re
import time
from typing import Union
from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile, File
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import Response
from sqlalchemy.orm import Session, joinedload, load_only

from app.database import get_db
from app.models.models import (
    Chapter, Course, Enrollment, Evaluation, EvaluationType,
    InterviewSession, User, Certificate, QuizAttempt,
)
from app.schemas.schemas import (
    InterviewStartRequest, CourseInterviewStartRequest, InterviewAnswerRequest,
    InterviewTurnResponse, InterviewResultResponse, InterviewEligibilityResponse,
    InterviewTTSRequest, RealtimeStartRequest, RealtimeStartResponse,
    RealtimeFinishRequest,
)
from app.auth.dependencies import require_student
from app.services.chapter_context import (
    build_chapter_context, build_course_context, build_course_context_no_vector,
)
from app.services.interview_graph import start_interview, process_answer, MAX_QUESTIONS
from app.services.realtime import (
    build_interview_instructions, create_realtime_session, extract_client_secret,
)
from app.services.llm import score_realtime_interview
from app.services.stt import transcribe_audio
from app.services.tts import synthesize_speech, MEDIA_TYPE
from app.services.storage import upload_recording_to_r2

# Filler words detected/penalised in scoring. Mirrors the client-side regex that
# used to run in the browser — now that transcription happens server-side (in the
# merged /respond endpoint) the count is derived here from the transcript so the
# scoring metrics are unchanged.
_FILLER_RE = re.compile(
    r"\b(um+|uh+|m+hm+|h+m+|err+|erm+|like|you know|basically|literally|"
    r"right\?|i mean|kind of|sort of)\b",
    re.IGNORECASE,
)


def _count_fillers(text: str) -> int:
    return len(_FILLER_RE.findall(text or ""))


def _clean_answer(text: str) -> str:
    """Strip filler words before the answer reaches the LLM (kept counted, not
    sent verbatim) — same transformation the frontend used to do."""
    return re.sub(r"\s{2,}", " ", _FILLER_RE.sub("", text or "")).strip()

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
        .options(joinedload(Chapter.course))
        .filter(Chapter.id == chapter_id)
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    if not chapter.course or not chapter.course.is_published:
        return InterviewEligibilityResponse(eligible=False, reason="This course is not published")

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

    if not chapter.course or not chapter.course.is_published:
        raise HTTPException(status_code=403, detail="This course is not published")

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

    graph_state = start_interview(chapter_title, context, course_pass_threshold, current_user.name)
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
    if not course.is_published:
        return InterviewEligibilityResponse(eligible=False, reason="This course is not published")

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
    if not course.is_published:
        raise HTTPException(status_code=403, detail="This course is not published")

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
    graph_state = start_interview(course_title, context, course_pass_threshold, current_user.name)

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


# ─── REALTIME (speech-to-speech) interview ───
# The browser connects DIRECTLY to Gemini's Live API over WebSocket. These two
# endpoints are all the backend does: /realtime/start authenticates the student,
# builds the interview context (name + course name + raw module text, NO vector
# search) and mints a short-lived ephemeral token; /realtime/finish receives the
# transcript the browser captured, grades it, and saves the evaluation.

@router.post("/realtime/start", response_model=RealtimeStartResponse)
def start_realtime_interview(
    data: RealtimeStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    if bool(data.course_id) == bool(data.chapter_id):
        raise HTTPException(
            status_code=400,
            detail="Provide exactly one of course_id or chapter_id",
        )

    # ── Resolve scope, check enrollment, and build context (no vector search) ──
    if data.chapter_id:
        chapter = (
            db.query(Chapter)
            .options(joinedload(Chapter.course))
            .filter(Chapter.id == data.chapter_id)
            .first()
        )
        if not chapter:
            raise HTTPException(status_code=404, detail="Chapter not found")
        course = chapter.course
        if not course or not course.is_published:
            raise HTTPException(status_code=403, detail="This course is not published")
        course_id = course.id
        enrollment = db.query(Enrollment).filter(
            Enrollment.user_id == current_user.id,
            Enrollment.course_id == course_id,
        ).first()
        if not enrollment:
            raise HTTPException(status_code=400, detail="Not enrolled in this course")
        scope_name = chapter.title
        pass_threshold = (course.pass_threshold if course else 70) or 70
        context = build_chapter_context(chapter)
        session_course_id = None
        session_chapter_id = chapter.id
    else:
        course = db.query(Course).filter(Course.id == data.course_id).first()
        if not course:
            raise HTTPException(status_code=404, detail="Course not found")
        if not course.is_published:
            raise HTTPException(status_code=403, detail="This course is not published")
        enrollment = db.query(Enrollment).filter(
            Enrollment.user_id == current_user.id,
            Enrollment.course_id == course.id,
        ).first()
        if not enrollment:
            raise HTTPException(status_code=400, detail="Not enrolled in this course")
        if not course.chapters:
            raise HTTPException(status_code=400, detail="This course has no modules yet")
        scope_name = course.title
        pass_threshold = course.pass_threshold or 70
        context = build_course_context_no_vector(course)
        session_course_id = course.id
        session_chapter_id = None

    # Abandon any prior active realtime/legacy session for this scope so a restart
    # is clean (mirrors the legacy /start behaviour).
    db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.chapter_id == session_chapter_id,
        InterviewSession.course_id == session_course_id,
        InterviewSession.status == "active",
    ).update({"status": "abandoned"})
    db.commit()

    # ── Build instructions + mint the ephemeral Realtime token ──
    instructions = build_interview_instructions(
        student_name=current_user.name,
        course_name=scope_name,
        context=context,
        pass_threshold=pass_threshold,
    )
    try:
        rt_session = create_realtime_session(instructions)
    except RuntimeError as exc:
        raise HTTPException(status_code=502, detail=str(exc))
    client_secret = extract_client_secret(rt_session)
    if not client_secret:
        logger.error("Realtime session response missing client secret: %s", rt_session)
        raise HTTPException(status_code=502, detail="OpenAI did not return an ephemeral token")

    # Persist scoring context on the session so /realtime/finish can grade without
    # recomputing it. transcript stays empty until the browser sends it back.
    session = InterviewSession(
        user_id=current_user.id,
        chapter_id=session_chapter_id,
        course_id=session_course_id,
        status="active",
        transcript=[],
        pause_metrics=[],
        question_count=0,
        graph_state={
            "mode": "realtime",
            "course_name": scope_name,
            "context": context,
            "pass_threshold": pass_threshold,
            "student_name": current_user.name,
        },
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    return RealtimeStartResponse(
        session_id=session.id,
        client_secret=client_secret,
        realtime_session=rt_session,
        model=rt_session.get("model", ""),
        voice=rt_session.get("voice", ""),
        instructions=instructions,
        course_name=scope_name,
        student_name=current_user.name,
    )


@router.post("/realtime/finish", response_model=InterviewResultResponse)
def finish_realtime_interview(
    data: RealtimeFinishRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    session = db.query(InterviewSession).filter(
        InterviewSession.id == data.session_id,
        InterviewSession.user_id == current_user.id,
    ).with_for_update().first()
    if not session or session.status != "active":
        raise HTTPException(status_code=404, detail="Active interview session not found")

    state = dict(session.graph_state or {})
    transcript = [{"speaker": m.speaker, "text": m.text} for m in data.transcript]

    evaluation = score_realtime_interview(
        state.get("course_name", ""),
        state.get("context", ""),
        transcript,
        state.get("pass_threshold", 70),
    )

    # Hand off to the shared finalizer, which persists the Evaluation, advances
    # progression, and issues a certificate where applicable — identical to the
    # legacy interview path.
    state["transcript"] = transcript
    state["evaluation"] = evaluation
    session.graph_state = state
    session.transcript = transcript
    return _finalize_session(db, session, current_user)


def _advance_interview(
    db: Session,
    session: InterviewSession,
    current_user: User,
    answer_text: str,
    response_time_ms: int,
    pause_count: int,
    long_pause_ms: int,
    filler_word_count: int,
) -> Union[InterviewTurnResponse, InterviewResultResponse]:
    """Run one interview turn for an already-loaded active session.

    Shared by /answer (typed answers) and /respond (the merged voice path) so the
    LangGraph orchestration, persistence, and completion handling are identical.
    """
    _t0 = time.perf_counter()
    graph_state = process_answer(
        session.graph_state,
        answer_text,
        response_time_ms,
        pause_count,
        long_pause_ms,
        filler_word_count,
    )
    logger.info(
        "interview turn process_answer=%.0fms (complete=%s chitchat=%s)",
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


@router.post("/answer", response_model=Union[InterviewTurnResponse, InterviewResultResponse])
def submit_answer(
    data: InterviewAnswerRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    session = db.query(InterviewSession).filter(
        InterviewSession.id == data.session_id,
        InterviewSession.user_id == current_user.id,
    ).with_for_update().first()
    if not session or session.status != "active":
        raise HTTPException(status_code=404, detail="Active interview session not found")

    if not data.answer_text.strip():
        raise HTTPException(status_code=400, detail="Answer cannot be empty")

    return _advance_interview(
        db, session, current_user,
        data.answer_text.strip(),
        data.response_time_ms,
        data.pause_count,
        data.long_pause_ms,
        data.filler_word_count,
    )


@router.post("/respond")
async def respond_to_answer(
    audio: UploadFile = File(...),
    session_id: str = Form(...),
    response_time_ms: int = Form(0),
    pause_count: int = Form(0),
    long_pause_ms: int = Form(0),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """Merged voice turn: transcribe + process + TTS in a single round-trip.

    Pipeline (fully logged for latency measurement):
      1. Read + validate audio upload
      2. STT  — Whisper transcription   (~2–4 s)
      3. LLM  — classify + next question (~3–6 s, often skipped classify step)
      4. TTS  — synthesize Mav's reply  (~1–3 s, runs in threadpool)
    Steps 3 and 4 are chained but TTS starts the instant the LLM finishes,
    so the total wall-clock time is STT + max(LLM, 0) + TTS instead of their sum.
    """
    _t_total = time.perf_counter()

    session = db.query(InterviewSession).filter(
        InterviewSession.id == session_id,
        InterviewSession.user_id == current_user.id,
    ).with_for_update().first()
    if not session or session.status != "active":
        raise HTTPException(status_code=404, detail="Active interview session not found")

    audio_bytes = await audio.read()
    if not audio_bytes:
        raise HTTPException(status_code=400, detail="Empty audio upload")
    if len(audio_bytes) > 25 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Audio too large")

    # ── Stage 1: STT (Whisper) ───────────────────────────────────────────
    _t0 = time.perf_counter()
    student_text = await run_in_threadpool(
        transcribe_audio, audio_bytes, audio.filename or "answer.webm"
    )
    student_text = (student_text or "").strip()
    _t_stt = time.perf_counter()
    logger.info("respond stt=%.0fms (chars=%d)", (_t_stt - _t0) * 1000, len(student_text))

    if not student_text:
        return {"student_text": "", "no_speech": True}

    filler_word_count = _count_fillers(student_text)
    cleaned = _clean_answer(student_text) or student_text

    # ── Stage 2: LLM turn (classify + generate next question) ──────────────
    # The LangGraph turn is blocking (LLM calls) — run it off the event loop.
    _t1 = time.perf_counter()
    result = await run_in_threadpool(
        _advance_interview,
        db, session, current_user,
        cleaned,
        response_time_ms,
        pause_count,
        long_pause_ms,
        filler_word_count,
    )
    _t_llm = time.perf_counter()
    logger.info("respond llm=%.0fms", (_t_llm - _t1) * 1000)

    payload = result.model_dump()
    payload["student_text"] = student_text

    # ── Stage 3: TTS (synthesize Mav's reply) ─────────────────────────
    # Embed the audio directly in the JSON response so the browser can play
    # Mav's voice immediately without a second /tts round-trip.
    ai_text = payload.get("text")
    if ai_text:
        _t2 = time.perf_counter()
        tts_bytes = await run_in_threadpool(synthesize_speech, ai_text)
        if tts_bytes:
            payload["audio_b64"] = base64.b64encode(tts_bytes).decode("ascii")
            payload["audio_mime"] = MEDIA_TYPE
        logger.info("respond tts=%.0fms", (time.perf_counter() - _t2) * 1000)

    logger.info(
        "respond TOTAL=%.0fms (stt=%.0fms llm=%.0fms)",
        (time.perf_counter() - _t_total) * 1000,
        (_t_stt - _t0) * 1000,
        (_t_llm - _t1) * 1000,
    )
    return payload


@router.post("/tts")
async def interview_tts(
    data: InterviewTTSRequest,
    current_user: User = Depends(require_student),
):
    """Synthesize Mav's line with OpenAI TTS (natural, human-like voice) and return
    the audio for the browser to play via an <audio> element.

    Falls back transparently: if TTS is unavailable we return 503, and the
    frontend then uses the browser's built-in speech synthesis instead.
    """
    text = (data.text or "").strip()
    if not text:
        raise HTTPException(status_code=400, detail="No text to speak")
    if len(text) > 4000:
        text = text[:4000]

    # OpenAI TTS is a blocking HTTP call — run it off the event loop.
    audio = await run_in_threadpool(synthesize_speech, text, data.voice)
    if not audio:
        raise HTTPException(status_code=503, detail="TTS unavailable")
    return Response(
        content=audio,
        media_type=MEDIA_TYPE,
        headers={"Cache-Control": "no-store"},
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
    ).with_for_update().first()
    if not session or session.status != "active":
        raise HTTPException(status_code=400, detail="Interview session is already finalized")

    from app.services.interview_graph import _score_interview
    graph_state = dict(session.graph_state or {})
    graph_state = _score_interview(graph_state)
    session.graph_state = graph_state
    return _finalize_session(db, session, current_user)


def _finalize_session(db: Session, session: InterviewSession, user: User) -> InterviewResultResponse:
    graph_state = session.graph_state or {}
    evaluation = graph_state.get("evaluation", {})

    # Resolve the interview pass threshold for this session. Priority order:
    # 1. graph_state (stored when the session started — most reliable)
    # 2. course.pass_threshold (live DB value)
    # 3. fallback default of 70
    pass_threshold = graph_state.get("pass_threshold")
    if pass_threshold is None:
        if session.course_id:
            _course_tmp = db.query(Course).filter(Course.id == session.course_id).first()
            pass_threshold = _course_tmp.pass_threshold if _course_tmp else None
        elif session.chapter_id:
            _chapter_tmp = db.query(Chapter).filter(Chapter.id == session.chapter_id).first()
            if _chapter_tmp and _chapter_tmp.course:
                pass_threshold = _chapter_tmp.course.pass_threshold
    pass_threshold = int(pass_threshold or 70)

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

        # Update enrollment and issue certificate if passed
        if evaluation.get("passed", False):
            from app.services.certificate import issue_certificate_if_eligible
            issue_certificate_if_eligible(db, user.id, session.course_id)


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
            pass_threshold=pass_threshold,
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
        pass_threshold=pass_threshold,
    )
