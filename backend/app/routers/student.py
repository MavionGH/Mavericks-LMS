from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models.models import Enrollment, Evaluation, Course, Chapter, User, Certificate, EnrollmentStatus
from app.schemas.schemas import DashboardStats, DashboardCourse, DashboardEvaluation
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
    
    # Modules completed: count of passed evaluations of type CHAPTER
    modules_completed = db.query(Evaluation).filter(
        Evaluation.user_id == current_user.id,
        Evaluation.type == "chapter",
        Evaluation.passed == True
    ).count()
    
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
        completed_chapters = e.current_chapter_index
        
        if e.status == EnrollmentStatus.COMPLETED or e.status == EnrollmentStatus.CAPSTONE_READY:
            progress = 100
        else:
            progress = int((completed_chapters / total_chapters * 100)) if total_chapters > 0 else 0
            
        current_chapter_title = "Completed"
        if progress < 100 and completed_chapters < total_chapters:
            current_chapter_title = course.chapters[completed_chapters].title
            
        status_str = "Not started"
        if progress == 100:
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
            if not course:
                # Fallback for older capstones: get the latest capstone interview session
                from app.models.models import InterviewSession
                session = db.query(InterviewSession).filter(
                    InterviewSession.user_id == ev.user_id,
                    InterviewSession.chapter_id.is_(None),
                    InterviewSession.course_id.isnot(None)
                ).order_by(InterviewSession.created_at.desc()).first()
                if session:
                    course = db.query(Course).filter(Course.id == session.course_id).first()

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
            confidence=int(ev.confidence_score)
        ))
        
    return DashboardStats(
        active_tracks=active_tracks,
        modules_completed=modules_completed,
        oral_assessments=oral_assessments,
        earned_credentials=earned_credentials,
        enrolled_courses=enrolled_courses,
        recent_evaluations=recent_evaluations
    )
