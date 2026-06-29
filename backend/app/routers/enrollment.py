from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.models import Enrollment, EnrollmentStatus, Course, User
from app.schemas.schemas import EnrollRequest, EnrollmentResponse
from app.auth.dependencies import require_student

router = APIRouter(prefix="/api/enrollment", tags=["Enrollment"])


@router.post("/enroll", response_model=EnrollmentResponse)
def enroll_in_course(
    data: EnrollRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    course = db.query(Course).filter(Course.id == data.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    # A course is enrollable once a teacher has published it — this matches the
    # public catalog visibility (list_courses filters on is_published). The
    # separate is_approved flag has no admin approval workflow yet, so gating
    # enrollment on it would make every published course impossible to join.
    if not course.is_published:
        raise HTTPException(status_code=403, detail="Course is not available for enrollment")

    existing = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == data.course_id
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail="Already enrolled")

    enrollment = Enrollment(
        user_id=current_user.id,
        course_id=data.course_id,
    )
    db.add(enrollment)
    db.commit()
    db.refresh(enrollment)
    return EnrollmentResponse.model_validate(enrollment)


@router.get("/my-courses", response_model=List[EnrollmentResponse])
def my_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    enrollments = db.query(Enrollment).filter(Enrollment.user_id == current_user.id).all()
    return [EnrollmentResponse.model_validate(e) for e in enrollments]


@router.get("/course/{course_id}", response_model=EnrollmentResponse)
def get_course_enrollment(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Not enrolled in this course")
    return EnrollmentResponse.model_validate(enrollment)


@router.put("/progress/{enrollment_id}/video-watched")
def mark_video_watched(
    enrollment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.user_id == current_user.id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    enrollment.video_watched = True
    db.commit()
    return {"message": "Video marked as watched"}


@router.put("/progress/{enrollment_id}/article-read")
def mark_article_read(
    enrollment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.user_id == current_user.id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")
    enrollment.article_read = True
    db.commit()
    return {"message": "Article marked as read"}


@router.put("/progress/{enrollment_id}/advance")
def advance_chapter(
    enrollment_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    enrollment = db.query(Enrollment).filter(
        Enrollment.id == enrollment_id,
        Enrollment.user_id == current_user.id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=404, detail="Enrollment not found")

    course = db.query(Course).filter(Course.id == enrollment.course_id).first()
    total_chapters = len(course.chapters)

    if enrollment.current_chapter_index + 1 >= total_chapters:
        enrollment.status = EnrollmentStatus.CAPSTONE_READY
    else:
        enrollment.current_chapter_index += 1
        enrollment.video_watched = False
        enrollment.article_read = False

    db.commit()
    return {"message": "Advanced to next chapter", "new_index": enrollment.current_chapter_index}
