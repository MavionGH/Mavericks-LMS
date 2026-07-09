from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, selectinload, joinedload
from sqlalchemy import func
from typing import List, Optional

from app.database import get_db
from app.models.models import (
    Enrollment, Evaluation, Course, Chapter, User, Certificate, EnrollmentStatus,
    EvaluationType, QuizAttempt,
)
from app.schemas.schemas import DashboardStats, DashboardCourse, DashboardEvaluation, CertificateResponse
from app.auth.dependencies import require_student

router = APIRouter(prefix="/api/student", tags=["Student"])

@router.get("/dashboard", response_model=DashboardStats)
def get_student_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    # One query: enrollments + their course + that course's chapters, all
    # eager-loaded up front so the loop below never re-queries per course.
    all_enrollments = (
        db.query(Enrollment)
        .options(selectinload(Enrollment.course).selectinload(Course.chapters))
        .filter(Enrollment.user_id == current_user.id)
        .all()
    )
    # Filter to only keep enrollments where the course is published
    enrollments = [e for e in all_enrollments if e.course and e.course.is_published]
    active_tracks = sum(1 for e in enrollments if e.status != EnrollmentStatus.COMPLETED)

    # One query each (not per-chapter/per-course): every passed QuizAttempt
    # chapter_id, and every Evaluation row this user has — everything below
    # (modules_completed, oral_assessments, per-course pass state) is derived
    # from these two already-fetched sets instead of querying in a loop.
    passed_quiz_chapter_ids = {
        row.chapter_id for row in
        db.query(QuizAttempt.chapter_id)
        .filter(QuizAttempt.user_id == current_user.id, QuizAttempt.passed == True)
        .all()
    }
    all_evaluations = (
        db.query(Evaluation)
        .options(joinedload(Evaluation.chapter))
        .filter(Evaluation.user_id == current_user.id)
        .all()
    )

    published_course_ids = {e.course_id for e in enrollments}
    published_chapter_ids = {
        c.id for e in enrollments for c in e.course.chapters
    }

    passed_quiz_chapter_ids = {
        ch_id for ch_id in passed_quiz_chapter_ids if ch_id in published_chapter_ids
    }
    passed_chapter_eval_ids = {
        ev.chapter_id for ev in all_evaluations
        if ev.type == EvaluationType.CHAPTER and ev.passed and ev.chapter_id and ev.chapter_id in published_chapter_ids
    }
    passed_capstone_course_ids = {
        ev.course_id for ev in all_evaluations
        if ev.type == EvaluationType.CAPSTONE and ev.passed and ev.course_id and ev.course_id in published_course_ids
    }

    modules_completed = len(passed_quiz_chapter_ids | passed_chapter_eval_ids)

    # Evals list filter: only for published courses
    all_evaluations = [
        ev for ev in all_evaluations
        if (ev.course_id in published_course_ids) or (ev.chapter and ev.chapter.course_id in published_course_ids)
    ]
    oral_assessments = len(all_evaluations)

    # Earned credentials: count of certificates
    earned_credentials = db.query(Certificate).join(Course).filter(
        Certificate.user_id == current_user.id,
        Course.is_published == True
    ).count()

    # Enrolled courses list
    enrolled_courses: List[DashboardCourse] = []
    for e in enrollments:
        if e.status == EnrollmentStatus.COMPLETED:
            continue
        course = e.course
        if not course:
            continue

        total_chapters = len(course.chapters)

        # Chapters passed for this course — no query, just set membership
        # against the two sets fetched once above.
        course_passed_chapters = sum(
            1 for chapter in course.chapters
            if chapter.id in passed_quiz_chapter_ids or chapter.id in passed_chapter_eval_ids
        )

        # Did they pass the capstone for this course?
        passed_capstone = course.id in passed_capstone_course_ids

        if e.status == EnrollmentStatus.COMPLETED:
            progress = 100
        else:
            if total_chapters > 0:
                modules_part = (66.0 * course_passed_chapters) / total_chapters
            else:
                modules_part = 66.0
            capstone_part = 34.0 if passed_capstone else 0.0
            progress = int(round(modules_part + capstone_part))
            if progress > 100:
                progress = 100
            
        current_chapter_title = "Completed"
        if progress < 100 and e.current_chapter_index < total_chapters:
            current_chapter_title = course.chapters[e.current_chapter_index].title
            
        status_str = "Not started"
        if e.status == EnrollmentStatus.COMPLETED:
            status_str = "Passed"
        elif progress == 100:
            status_str = "Completed"
        elif progress > 0 or e.video_watched or e.article_read:
            status_str = "In progress"
            
        # Get an icon abbreviation from title
        words = course.title.split()
        icon_str = ("".join([w[0].upper() for w in words[:2]])) if words else "C"
            
        enrolled_courses.append(DashboardCourse(
            id=course.id,
            title=course.title,
            progress=progress,
            currentChapter=current_chapter_title,
            status=status_str,
            icon=icon_str,
            thumbnail=course.thumbnail
        ))

    return DashboardStats(
        active_tracks=active_tracks,
        modules_completed=modules_completed,
        oral_assessments=oral_assessments,
        earned_credentials=earned_credentials,
        enrolled_courses=enrolled_courses,
    )


@router.get("/evaluations", response_model=List[DashboardEvaluation])
def get_all_student_evaluations(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    from app.models.models import InterviewSession
    from collections import defaultdict

    # Fetch all evaluations for the student chronologically (asc)
    evals = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id
    ).order_by(Evaluation.created_at.asc()).all()

    # Fetch all completed interview sessions with recordings chronologically (asc)
    sessions = db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.recording_url.isnot(None)
    ).order_by(InterviewSession.created_at.asc()).all()

    # Get published course IDs
    published_course_ids = {c_id for (c_id,) in db.query(Course.id).filter(Course.is_published == True).all()}
    
    # Eagerly fetch chapter course mappings
    chapter_course_map = {ch.id: ch.course_id for ch in db.query(Chapter).all()}

    def _is_published(scope_obj):
        if scope_obj.course_id:
            return scope_obj.course_id in published_course_ids
        if scope_obj.chapter_id:
            c_id = chapter_course_map.get(scope_obj.chapter_id)
            return c_id in published_course_ids
        return False

    evals = [e for e in evals if _is_published(e)]
    sessions = [s for s in sessions if _is_published(s)]

    # Group evals and sessions by scope
    evals_by_scope = defaultdict(list)
    for ev in evals:
        if ev.chapter_id:
            evals_by_scope[f"chapter_{ev.chapter_id}"].append(ev)
        elif ev.course_id:
            evals_by_scope[f"course_{ev.course_id}"].append(ev)

    sessions_by_scope = defaultdict(list)
    for s in sessions:
        if s.chapter_id:
            sessions_by_scope[f"chapter_{s.chapter_id}"].append(s)
        elif s.course_id:
            sessions_by_scope[f"course_{s.course_id}"].append(s)

    # Match evaluations to recordings
    eval_recording_map = {}
    for scope, scope_evals in evals_by_scope.items():
        scope_sessions = sessions_by_scope.get(scope, [])
        for i, ev in enumerate(scope_evals):
            recording_url = None
            if i < len(scope_sessions):
                recording_url = scope_sessions[i].recording_url
            elif scope_sessions:
                recording_url = scope_sessions[-1].recording_url
            eval_recording_map[ev.id] = recording_url

    course_evaluations: List[DashboardEvaluation] = []
    
    for ev in evals:
        course_title = "Unknown Course"
        chapter_title = "Course Capstone"
        
        if ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                chapter_title = chapter.title
                course = db.query(Course).filter(Course.id == chapter.course_id).first()
                if course:
                    course_title = course.title
        elif ev.course_id:
            course = db.query(Course).filter(Course.id == ev.course_id).first()
            if course:
                course_title = course.title
        else:
            # Fallback/guess from interview sessions
            session = db.query(InterviewSession).filter(
                InterviewSession.user_id == ev.user_id,
                InterviewSession.chapter_id.is_(None),
                InterviewSession.course_id.isnot(None),
                InterviewSession.created_at <= ev.created_at
            ).order_by(InterviewSession.created_at.desc()).first()
            if session and session.course:
                course_title = session.course.title

        recording_url = eval_recording_map.get(ev.id)

        course_evaluations.append(DashboardEvaluation(
            chapter=chapter_title,
            course=course_title,
            score=int(ev.overall_score),
            passed=ev.passed,
            date=ev.created_at.strftime("%Y-%m-%d"),
            technical=int(ev.technical_score),
            communication=int(ev.communication_score),
            confidence=int(ev.confidence_score),
            recording_url=recording_url
        ))
        
    return course_evaluations[::-1]


@router.get("/courses/{course_id}/evaluations", response_model=List[DashboardEvaluation])
def get_course_evaluations(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    from app.models.models import InterviewSession
    from collections import defaultdict

    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if not course.is_published:
        raise HTTPException(status_code=403, detail="This course is not published")

    # Fetch all evaluations for the student chronologically (asc)
    evals = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id
    ).order_by(Evaluation.created_at.asc()).all()

    # Fetch all completed interview sessions with recordings chronologically (asc)
    sessions = db.query(InterviewSession).filter(
        InterviewSession.user_id == current_user.id,
        InterviewSession.recording_url.isnot(None)
    ).order_by(InterviewSession.created_at.asc()).all()

    # Group evals and sessions by scope for this course
    evals_by_scope = defaultdict(list)
    for ev in evals:
        # Resolve course_id for this evaluation
        ev_course_id = getattr(ev, "course_id", None)
        if not ev_course_id and ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                ev_course_id = chapter.course_id
        if not ev_course_id and not ev.chapter_id:
            # Try to guess from interview sessions
            session = db.query(InterviewSession).filter(
                InterviewSession.user_id == ev.user_id,
                InterviewSession.chapter_id.is_(None),
                InterviewSession.course_id.isnot(None),
                InterviewSession.created_at <= ev.created_at
            ).order_by(InterviewSession.created_at.desc()).first()
            if session:
                ev_course_id = session.course_id

        if ev_course_id == course_id:
            if ev.chapter_id:
                evals_by_scope[f"chapter_{ev.chapter_id}"].append(ev)
            else:
                evals_by_scope[f"course_{course_id}"].append(ev)

    sessions_by_scope = defaultdict(list)
    for s in sessions:
        # Resolve course_id for this session
        s_course_id = s.course_id
        if not s_course_id and s.chapter:
            s_course_id = s.chapter.course_id
        
        if s_course_id == course_id:
            if s.chapter_id:
                sessions_by_scope[f"chapter_{s.chapter_id}"].append(s)
            else:
                sessions_by_scope[f"course_{course_id}"].append(s)

    # Match evaluations to recordings
    eval_recording_map = {}
    for scope, scope_evals in evals_by_scope.items():
        scope_sessions = sessions_by_scope.get(scope, [])
        for i, ev in enumerate(scope_evals):
            recording_url = None
            if i < len(scope_sessions):
                recording_url = scope_sessions[i].recording_url
            elif scope_sessions:
                recording_url = scope_sessions[-1].recording_url
            eval_recording_map[ev.id] = recording_url

    course_evaluations: List[DashboardEvaluation] = []
    
    # Filter evals belonging to this course
    filtered_evals = []
    for ev in evals:
        ev_course_id = getattr(ev, "course_id", None)
        if not ev_course_id and ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                ev_course_id = chapter.course_id
        if not ev_course_id and not ev.chapter_id:
            session = db.query(InterviewSession).filter(
                InterviewSession.user_id == ev.user_id,
                InterviewSession.chapter_id.is_(None),
                InterviewSession.course_id.isnot(None),
                InterviewSession.created_at <= ev.created_at
            ).order_by(InterviewSession.created_at.desc()).first()
            if session:
                ev_course_id = session.course_id
                
        if ev_course_id == course_id:
            filtered_evals.append(ev)

    course_title = ""
    course = db.query(Course).filter(Course.id == course_id).first()
    if course:
        course_title = course.title

    for ev in reversed(filtered_evals):
        chapter_title = "Course Capstone"
        if ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                chapter_title = chapter.title

        recording_url = eval_recording_map.get(ev.id)
            
        course_evaluations.append(DashboardEvaluation(
            chapter=chapter_title,
            course=course_title,
            score=int(ev.overall_score),
            passed=ev.passed,
            date=ev.created_at.strftime("%Y-%m-%d"),
            technical=int(ev.technical_score),
            communication=int(ev.communication_score),
            confidence=int(ev.confidence_score),
            recording_url=recording_url
        ))
        
    return course_evaluations


@router.get("/certificates", response_model=List[CertificateResponse])
def get_student_certificates(
    db: Session = Depends(get_db),  
    current_user: User = Depends(require_student)
):
    certs = db.query(Certificate).join(Course).filter(
        Certificate.user_id == current_user.id,
        Course.is_published == True
    ).all()
    results = []
    for c in certs:
        res = CertificateResponse.model_validate(c)
        res.course_title = c.course.title if c.course else "Unknown Course"
        res.pdf_url = getattr(c, "pdf_url", None)
        results.append(res)
    return results
