from typing import Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Chapter, Course, Enrollment, Evaluation, EvaluationType,
    InterviewSession, QuizAttempt, User,
)
from app.schemas.schemas import (
    InterviewStartRequest, CourseInterviewStartRequest, InterviewAnswerRequest,
    InterviewTurnResponse, InterviewResultResponse, InterviewEligibilityResponse,
)
from app.auth.dependencies import require_student
from app.services.chapter_context import build_chapter_context, build_course_context
from app.services.interview_graph import start_interview, process_answer, MAX_QUESTIONS

router = APIRouter(prefix="/api/interview", tags=["Interview"])


def _get_chapter_and_enrollment(db: Session, user_id: str, chapter_id: str):
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == user_id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=400, detail="Not enrolled in this course")

    sorted_chapters = sorted(chapter.course.chapters, key=lambda c: c.order_index)
    current = sorted_chapters[enrollment.current_chapter_index] if sorted_chapters else None
    if not current or current.id != chapter_id:
        raise HTTPException(status_code=403, detail="This module is not your current active chapter")

    return chapter, enrollment, sorted_chapters


@router.get("/eligibility/{chapter_id}", response_model=InterviewEligibilityResponse)
def check_eligibility(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        return InterviewEligibilityResponse(eligible=False, reason="Not enrolled in this course")

    sorted_chapters = sorted(chapter.course.chapters, key=lambda c: c.order_index)
    current = sorted_chapters[enrollment.current_chapter_index] if sorted_chapters else None
    if not current or current.id != chapter_id:
        return InterviewEligibilityResponse(
            eligible=False,
            reason="Complete previous modules first",
            video_watched=enrollment.video_watched,
            article_read=enrollment.article_read,
            enrollment_id=enrollment.id,
        )

    if not enrollment.video_watched:
        return InterviewEligibilityResponse(
            eligible=False,
            reason="Watch the module video first",
            video_watched=False,
            article_read=enrollment.article_read,
            enrollment_id=enrollment.id,
        )

    if not enrollment.article_read:
        return InterviewEligibilityResponse(
            eligible=False,
            reason="Read the module article first",
            video_watched=True,
            article_read=False,
            enrollment_id=enrollment.id,
        )

    # Check quiz passed
    quiz_passed = db.query(QuizAttempt).filter(
        QuizAttempt.user_id == current_user.id,
        QuizAttempt.chapter_id == chapter_id,
        QuizAttempt.passed == True,
    ).first()
    if not quiz_passed:
        return InterviewEligibilityResponse(
            eligible=False,
            reason="Pass the chapter quiz first",
            video_watched=True,
            article_read=True,
            enrollment_id=enrollment.id,
        )

    active = db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.chapter_id == chapter_id,
        InterviewSession.status == "active",
    ).first()
    if active:
        return InterviewEligibilityResponse(
            eligible=True,
            reason="Resuming active session",
            video_watched=True,
            article_read=True,
            enrollment_id=enrollment.id,
        )

    return InterviewEligibilityResponse(
        eligible=True,
        video_watched=True,
        article_read=True,
        enrollment_id=enrollment.id,
    )


@router.post("/start", response_model=InterviewTurnResponse)
def start_interview_session(
    data: InterviewStartRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    chapter, enrollment, _ = _get_chapter_and_enrollment(db, current_user.id, data.chapter_id)

    if not enrollment.video_watched or not enrollment.article_read:
        raise HTTPException(
            status_code=400,
            detail="Complete the video and article before starting the interview",
        )

    # Enforce quiz-pass gating
    quiz_passed = db.query(QuizAttempt).filter(
        QuizAttempt.user_id == current_user.id,
        QuizAttempt.chapter_id == data.chapter_id,
        QuizAttempt.passed == True,
    ).first()
    if not quiz_passed:
        raise HTTPException(
            status_code=400,
            detail="Pass the chapter quiz before starting the interview",
        )

    db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.chapter_id == data.chapter_id,
        InterviewSession.status == "active",
    ).update({"status": "abandoned"})
    db.commit()

    # Cache the values we need BEFORE build_chapter_context runs.
    # build_chapter_context may trigger a vector-search SQL error that causes a
    # DB rollback (poisoning the transaction).  Reading these values first means
    # we don't need to issue any further DB queries after that point.
    course = db.query(Course).filter(Course.id == chapter.course_id).first()
    course_pass_threshold = course.pass_threshold if course else 70
    chapter_title = chapter.title
    chapter_course_id = chapter.course_id

    context = build_chapter_context(
        chapter,
        query=f"important concepts and topics in {chapter.title} for oral assessment",
        db=db,
    )
    graph_state = start_interview(chapter_title, context, course_pass_threshold)

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

    graph_state = process_answer(
        session.graph_state,
        data.answer_text.strip(),
        data.response_time_ms,
        data.pause_count,
        data.long_pause_ms,
        data.filler_word_count,
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
