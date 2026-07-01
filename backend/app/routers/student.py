from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models.models import Enrollment, Evaluation, Course, Chapter, User, Certificate, EnrollmentStatus
from app.schemas.schemas import DashboardStats, DashboardCourse, DashboardEvaluation, CertificateResponse
from app.auth.dependencies import require_student

router = APIRouter(prefix="/api/student", tags=["Student"])

@router.get("/dashboard", response_model=DashboardStats)
def get_student_dashboard(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    # Active tracks: enrollments that are not completed
    enrollments = db.query(Enrollment).filter(Enrollment.user_id == current_user.id).all()
    active_tracks = sum(1 for e in enrollments if e.status != EnrollmentStatus.COMPLETED)
    
    # Modules completed: count of distinct chapters passed via quiz or oral evaluation
    from app.models.models import QuizAttempt, Evaluation
    passed_chapters_count = (
        db.query(QuizAttempt.chapter_id)
        .filter(QuizAttempt.user_id == current_user.id, QuizAttempt.passed == True)
        .union(
            db.query(Evaluation.chapter_id)
            .filter(Evaluation.user_id == current_user.id, Evaluation.type == "chapter", Evaluation.passed == True)
        )
        .distinct()
        .count()
    )
    modules_completed = passed_chapters_count
    
    # Oral Assessments: count of all evaluations
    oral_assessments = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id
    ).count()
    
    # Earned credentials: count of certificates
    earned_credentials = db.query(Certificate).filter(
        Certificate.user_id == current_user.id
    ).count()
    
    # Enrolled courses list
    enrolled_courses: List[DashboardCourse] = []
    for e in enrollments:
        course = db.query(Course).filter(Course.id == e.course_id).first()
        if not course:
            continue
            
        total_chapters = len(course.chapters)
        
        # Calculate how many chapters have been passed for this course
        course_passed_chapters = 0
        for chapter in course.chapters:
            passed_quiz = db.query(QuizAttempt).filter(
                QuizAttempt.user_id == current_user.id,
                QuizAttempt.chapter_id == chapter.id,
                QuizAttempt.passed == True
            ).first() is not None
            passed_interview = db.query(Evaluation).filter(
                Evaluation.user_id == current_user.id,
                Evaluation.chapter_id == chapter.id,
                Evaluation.passed == True
            ).first() is not None
            if passed_quiz or passed_interview:
                course_passed_chapters += 1

        # Check if they passed the capstone for this course
        passed_capstone = db.query(Evaluation).filter(
            Evaluation.user_id == current_user.id,
            Evaluation.course_id == course.id,
            Evaluation.type == "capstone",
            Evaluation.passed == True
        ).first() is not None

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
            icon=icon_str
        ))
        
    # Recent evaluations
    evals = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id
    ).order_by(Evaluation.created_at.desc()).limit(10).all()
    
    recent_evaluations: List[DashboardEvaluation] = []
    for ev in evals:
        chapter_title = "Capstone"
        course_title = "Unknown Course"
        
        course = None
        if getattr(ev, "course_id", None):
            course = db.query(Course).filter(Course.id == ev.course_id).first()

        if ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                chapter_title = chapter.title
                if not course:
                    course = db.query(Course).filter(Course.id == chapter.course_id).first()
        else:
            chapter_title = "Course Capstone"
            
        # Get matching interview session to fetch teacher_score
        from app.models.models import InterviewSession
        session_query = db.query(InterviewSession).filter(
            InterviewSession.user_id == ev.user_id
        )
        if ev.chapter_id:
            session_query = session_query.filter(InterviewSession.chapter_id == ev.chapter_id)
        else:
            session_query = session_query.filter(InterviewSession.chapter_id.is_(None))
            if getattr(ev, "course_id", None):
                session_query = session_query.filter(InterviewSession.course_id == ev.course_id)
                
        matching_session = session_query.filter(
            InterviewSession.created_at <= ev.created_at
        ).order_by(InterviewSession.created_at.desc()).first()
        
        t_score = matching_session.teacher_score if matching_session else None
        
        if not course and not ev.chapter_id and matching_session:
            course = db.query(Course).filter(Course.id == matching_session.course_id).first()

        if course:
            course_title = course.title
        recent_evaluations.append(DashboardEvaluation(
            chapter=chapter_title,
            course=course_title,
            score=int(ev.overall_score),
            passed=ev.passed,
            date=ev.created_at.strftime("%Y-%m-%d"),
            technical=int(ev.technical_score),
            communication=int(ev.communication_score),
            confidence=int(ev.confidence_score),
            teacher_score=int(t_score) if t_score is not None else None
        ))
        
    return DashboardStats(
        active_tracks=active_tracks,
        modules_completed=modules_completed,
        oral_assessments=oral_assessments,
        earned_credentials=earned_credentials,
        enrolled_courses=enrolled_courses,
        recent_evaluations=recent_evaluations
    )


@router.get("/courses/{course_id}/evaluations", response_model=List[DashboardEvaluation])
def get_course_evaluations(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    evals = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id
    ).order_by(Evaluation.created_at.desc()).all()
    
    course_evaluations: List[DashboardEvaluation] = []
    
    for ev in evals:
        # Resolve course_id for this evaluation
        ev_course_id = getattr(ev, "course_id", None)
        if not ev_course_id and ev.chapter_id:
            chapter = db.query(Chapter).filter(Chapter.id == ev.chapter_id).first()
            if chapter:
                ev_course_id = chapter.course_id
        if not ev_course_id and not ev.chapter_id:
            # Try to guess from interview sessions for old capstones
            from app.models.models import InterviewSession
            session = db.query(InterviewSession).filter(
                InterviewSession.user_id == ev.user_id,
                InterviewSession.chapter_id.is_(None),
                InterviewSession.course_id.isnot(None),
                InterviewSession.created_at <= ev.created_at
            ).order_by(InterviewSession.created_at.desc()).first()
            if session:
                ev_course_id = session.course_id
                
        if ev_course_id == course_id:
            chapter_title = "Course Capstone"
            course_title = ""
            course = db.query(Course).filter(Course.id == course_id).first()
            if course:
                course_title = course.title
                
            # Get matching interview session to fetch teacher_score
            from app.models.models import InterviewSession
            session_query = db.query(InterviewSession).filter(
                InterviewSession.user_id == ev.user_id
            )
            if ev.chapter_id:
                session_query = session_query.filter(InterviewSession.chapter_id == ev.chapter_id)
            else:
                session_query = session_query.filter(InterviewSession.chapter_id.is_(None))
                if getattr(ev, "course_id", None):
                    session_query = session_query.filter(InterviewSession.course_id == ev.course_id)
                    
            matching_session = session_query.filter(
                InterviewSession.created_at <= ev.created_at
            ).order_by(InterviewSession.created_at.desc()).first()
            
            t_score = matching_session.teacher_score if matching_session else None

            course_evaluations.append(DashboardEvaluation(
                chapter=chapter_title,
                course=course_title,
                score=int(ev.overall_score),
                passed=ev.passed,
                date=ev.created_at.strftime("%Y-%m-%d"),
                technical=int(ev.technical_score),
                communication=int(ev.communication_score),
                confidence=int(ev.confidence_score),
                teacher_score=int(t_score) if t_score is not None else None
            ))
            
    return course_evaluations


@router.get("/certificates", response_model=List[CertificateResponse])
def get_student_certificates(
    db: Session = Depends(get_db),  
    current_user: User = Depends(require_student)
):
    certs = db.query(Certificate).filter(Certificate.user_id == current_user.id).all()
    results = []
    for c in certs:
        res = CertificateResponse.model_validate(c)
        res.course_title = c.course.title if c.course else "Unknown Course"
        res.pdf_url = getattr(c, "pdf_url", None)
        results.append(res)
    return results
