from typing import Union
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Chapter, Course, Enrollment, Evaluation, EvaluationType,
    InterviewSession, User,
)
from app.schemas.schemas import (
    InterviewStartRequest, InterviewAnswerRequest,
    InterviewTurnResponse, InterviewResultResponse, InterviewEligibilityResponse,
)
from app.auth.dependencies import require_student
from app.services.chapter_context import build_chapter_context
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

    existing = db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.chapter_id == data.chapter_id,
        InterviewSession.status == "active",
    ).first()
    if existing and existing.graph_state:
        gs = existing.graph_state
        last_msg = gs.get("transcript", [])[-1] if gs.get("transcript") else None
        return InterviewTurnResponse(
            session_id=existing.id,
            speaker="ai",
            text=last_msg["text"] if last_msg else gs.get("next_question", ""),
            is_complete=gs.get("is_complete", False),
            waiting_for_student=not gs.get("is_complete", False),
            question_number=gs.get("question_count", 1),
            total_questions=MAX_QUESTIONS,
        )

    context = build_chapter_context(chapter)
    course = db.query(Course).filter(Course.id == chapter.course_id).first()
    graph_state = start_interview(chapter.title, context, course.pass_threshold)

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
    )

    session.graph_state = graph_state
    session.transcript = graph_state.get("transcript", [])
    session.pause_metrics = graph_state.get("pause_metrics", [])
    session.question_count = graph_state.get("question_count", session.question_count)

    if graph_state.get("is_complete"):
        return _finalize_session(db, session, current_user)

    db.commit()

    return InterviewTurnResponse(
        session_id=session.id,
        speaker="ai",
        text=graph_state.get("next_question", ""),
        is_complete=False,
        waiting_for_student=True,
        question_number=graph_state.get("question_count", 1),
        total_questions=MAX_QUESTIONS,
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
    chapter = db.query(Chapter).filter(Chapter.id == session.chapter_id).first()
    course = db.query(Course).filter(Course.id == chapter.course_id).first()

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
