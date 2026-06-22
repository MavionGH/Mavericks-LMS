from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

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


@router.get("/youtube-transcript/preview")
def preview_youtube_transcript(
    youtube_url: str,
    title: Optional[str] = "this topic",
    current_user: User = Depends(require_teacher),
):
    """Fetch and return the transcript of a YouTube video for preview."""
    if not youtube_url:
        raise HTTPException(status_code=400, detail="youtube_url query parameter is required")
    try:
        from app.services.transcript import fetch_youtube_transcript
        transcript = fetch_youtube_transcript(youtube_url)
        if transcript:
            return {"transcript": transcript, "is_mock": False}
    except Exception:
        pass

    # Fallback to LLM mock transcript if fetching fails (e.g. rate limit, captcha)
    try:
        from app.services.llm import llm_generate_mock_transcript
        mock_transcript = llm_generate_mock_transcript(title)
        return {"transcript": mock_transcript, "is_mock": True}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch or generate transcript: {str(e)}")


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

    # Auto-fetch YouTube transcript if not manually provided
    video_transcript = data.video_transcript
    transcript_auto_fetched = False
    if not video_transcript and data.youtube_url:
        try:
            from app.services.transcript import fetch_youtube_transcript
            video_transcript = fetch_youtube_transcript(data.youtube_url)
            if video_transcript:
                transcript_auto_fetched = True
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                f"Auto-transcript fetch failed for {data.youtube_url}: {e}"
            )

    chapter = Chapter(
        title=data.title,
        order_index=data.order_index,
        article_content=data.article_content,
        youtube_url=data.youtube_url,
        video_transcript=video_transcript,
        course_id=course_id,
    )
    db.add(chapter)
    db.commit()
    db.refresh(chapter)

    # Chunk and embed for RAG (non-blocking best-effort)
    try:
        from app.services.embeddings import chunk_and_embed_chapter, ensure_pgvector_extension
        ensure_pgvector_extension(db)
        chunk_and_embed_chapter(
            db=db,
            chapter_id=chapter.id,
            course_id=course_id,
            article_content=chapter.article_content,
            video_transcript=chapter.video_transcript,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Chunking/embedding failed for chapter {chapter.id}: {e}")

    response = ChapterResponse.model_validate(chapter)
    return response


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

    # Auto-fetch transcript if not manually provided and URL changed or transcript is empty
    video_transcript = data.video_transcript
    if not video_transcript and data.youtube_url:
        try:
            from app.services.transcript import fetch_youtube_transcript
            video_transcript = fetch_youtube_transcript(data.youtube_url)
        except Exception as e:
            import logging
            logging.getLogger(__name__).warning(
                f"Auto-transcript fetch failed for {data.youtube_url}: {e}"
            )

    chapter.title = data.title
    chapter.order_index = data.order_index
    chapter.article_content = data.article_content
    chapter.youtube_url = data.youtube_url
    chapter.video_transcript = video_transcript
    db.commit()
    db.refresh(chapter)

    # Re-chunk and re-embed (content may have changed)
    try:
        from app.services.embeddings import chunk_and_embed_chapter, ensure_pgvector_extension
        ensure_pgvector_extension(db)
        chunk_and_embed_chapter(
            db=db,
            chapter_id=chapter.id,
            course_id=chapter.course_id,
            article_content=chapter.article_content,
            video_transcript=chapter.video_transcript,
        )
    except Exception as e:
        import logging
        logging.getLogger(__name__).warning(f"Re-chunking/embedding failed for chapter {chapter.id}: {e}")

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
