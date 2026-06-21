from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List

from app.database import get_db
from app.models.models import Course, Chapter, User
from app.schemas.schemas import (
    CourseCreate, CourseResponse, CourseListResponse,
    ChapterCreate, ChapterResponse
)
from app.auth.dependencies import get_current_user, require_teacher, require_admin

router = APIRouter(prefix="/api/courses", tags=["Courses"])


@router.get("/manage/all", response_model=List[CourseResponse])
def list_all_courses_teacher(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """Teacher/admin — lists all courses including drafts."""
    courses = db.query(Course).order_by(Course.created_at.desc()).all()
    return [CourseResponse.model_validate(c) for c in courses]


@router.get("/", response_model=List[CourseListResponse])
def list_courses(db: Session = Depends(get_db)):
    """Public endpoint — lists all published courses."""
    courses = db.query(Course).filter(Course.is_published == True).all()
    result = []
    for c in courses:
        result.append(CourseListResponse(
            id=c.id,
            title=c.title,
            description=c.description,
            thumbnail=c.thumbnail,
            is_published=c.is_published,
            chapter_count=len(c.chapters),
        ))
    return result


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: str, db: Session = Depends(get_db)):
    """Public endpoint — returns course details."""
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return CourseResponse.model_validate(course)


@router.post("/", response_model=CourseResponse)
def create_course(
    data: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),   # Teacher or Admin only
):
    course = Course(
        title=data.title,
        description=data.description,
        thumbnail=data.thumbnail,
        pass_threshold=data.pass_threshold,
    )
    db.add(course)
    db.commit()
    db.refresh(course)
    return CourseResponse.model_validate(course)


@router.put("/{course_id}", response_model=CourseResponse)
def update_course(
    course_id: str,
    data: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    course.title = data.title
    course.description = data.description
    course.thumbnail = data.thumbnail
    course.pass_threshold = data.pass_threshold
    db.commit()
    db.refresh(course)
    return CourseResponse.model_validate(course)


@router.delete("/{course_id}")
def delete_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),    # Admin only
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    db.delete(course)
    db.commit()
    return {"message": "Course deleted"}


@router.put("/{course_id}/publish")
def publish_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    course.is_published = not course.is_published
    db.commit()
    return {"message": f"Course {'published' if course.is_published else 'unpublished'}"}


# ─── CHAPTER ROUTES ───
@router.post("/{course_id}/chapters", response_model=ChapterResponse)
def add_chapter(
    course_id: str,
    data: ChapterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    chapter = Chapter(
        title=data.title,
        order_index=data.order_index,
        article_content=data.article_content,
        youtube_url=data.youtube_url,
        video_transcript=data.video_transcript,
        course_id=course_id,
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)
    return ChapterResponse.model_validate(chapter)


@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
def update_chapter(
    chapter_id: str,
    data: ChapterCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    chapter.title = data.title
    chapter.order_index = data.order_index
    chapter.article_content = data.article_content
    chapter.youtube_url = data.youtube_url
    chapter.video_transcript = data.video_transcript
    db.commit()
    db.refresh(chapter)
    return ChapterResponse.model_validate(chapter)


@router.delete("/chapters/{chapter_id}")
def delete_chapter(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    db.delete(chapter)
    db.commit()
    return {"message": "Chapter deleted"}
