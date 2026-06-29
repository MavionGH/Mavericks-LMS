"""
Teacher-facing read views over student interview activity.

A teacher may only see recordings/evaluations for courses they own; admins see
everything. Ownership is resolved through the interview session's course — either
directly (course-wide final interview) or via its chapter (per-module interview).
"""
import logging

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session, joinedload

from app.database import get_db
from app.models.models import (
    Chapter, Course, Evaluation, InterviewSession, User, UserRole,
)
from app.auth.dependencies import require_teacher

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/teacher", tags=["Teacher"])


def _owned_course_ids(db: Session, current_user: User) -> set:
    """Course IDs the current user may view. Admins get every course."""
    q = db.query(Course.id)
    if current_user.role != UserRole.ADMIN:
        q = q.filter(Course.teacher_id == current_user.id)
    return {row[0] for row in q.all()}


@router.get("/recordings")
def list_interview_recordings(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """Every interview recording for the teacher's courses, newest first.

    Each item carries enough context for the panel: who the student is, which
    course/module the interview covered, the playable R2 URL, and the score if the
    interview was finalized.
    """
    owned = _owned_course_ids(db, current_user)
    if not owned:
        return []

    sessions = (
        db.query(InterviewSession)
        .options(
            joinedload(InterviewSession.user),
            joinedload(InterviewSession.chapter).joinedload(Chapter.course),
            joinedload(InterviewSession.course),
        )
        .filter(InterviewSession.recording_url.isnot(None))
        .order_by(InterviewSession.created_at.desc())
        .all()
    )

    # Pre-load evaluations for these students/chapters in one pass would be ideal,
    # but the volume here is small (one row per finished interview); a per-session
    # lookup keyed on the same (user, chapter) is clear and fast enough.
    results = []
    for s in sessions:
        # Resolve the owning course (chapter path takes precedence over course path).
        if s.chapter and s.chapter.course:
            course = s.chapter.course
        else:
            course = s.course
        if not course or course.id not in owned:
            continue

        evaluation = (
            db.query(Evaluation)
            .filter(
                Evaluation.user_id == s.user_id,
                Evaluation.chapter_id == s.chapter_id,
            )
            .order_by(Evaluation.created_at.desc())
            .first()
        )

        results.append({
            "session_id": s.id,
            "recording_url": s.recording_url,
            "status": s.status,
            "created_at": s.created_at.isoformat() if s.created_at else None,
            "student": {
                "id": s.user.id if s.user else None,
                "name": s.user.name if s.user else "Unknown",
                "email": s.user.email if s.user else None,
            },
            "course": {"id": course.id, "title": course.title},
            "module": s.chapter.title if s.chapter else None,
            "scope": "module" if s.chapter_id else "course",
            "overall_score": round(evaluation.overall_score) if evaluation else None,
            "passed": evaluation.passed if evaluation else None,
        })

    return results
