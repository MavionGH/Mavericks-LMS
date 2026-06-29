import logging
import os
import shutil
import tempfile
import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, File, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, load_only
from typing import List, Optional

from app.database import get_db
from app.models.models import Course, Chapter, User, UserRole
from app.schemas.schemas import (
    CourseCreate, CourseResponse, CourseListResponse,
    ChapterCreate, ChapterResponse, ChapterMinResponse, ChapterDetailResponse
)
from app.auth.dependencies import get_current_user, require_teacher, require_admin
from app.services.transcript import fetch_youtube_transcript
from app.services.storage import upload_video_to_r2
from app.services.pinecone_store import index_module_content
from app.services.video_transcription import transcribe_video_bytes
from app.services.document_parser import extract_text_from_document

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/courses", tags=["Courses"])


def _assert_course_owner(course: Course, current_user: User) -> None:
    """Raise 403 if the user is not the course owner (admins bypass this check)."""
    if current_user.role == UserRole.ADMIN:
        return
    if course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not own this course")


# ─── TEACHER / ADMIN MANAGEMENT VIEWS ───

@router.get("/manage/all", response_model=List[CourseResponse])
def list_managed_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """
    Teachers see only their own courses (all statuses).
    Admins see every course.
    """
    q = db.query(Course).options(
        joinedload(Course.chapters),
        joinedload(Course.enrollments)
    )
    if current_user.role != UserRole.ADMIN:
        q = q.filter(Course.teacher_id == current_user.id)
    courses = q.order_by(Course.created_at.desc()).all()
    return [CourseResponse.model_validate(c) for c in courses]



@router.get("/youtube-transcript/preview")
def preview_youtube_transcript(
    youtube_url: str,
    title: Optional[str] = "this topic",
    current_user: User = Depends(require_teacher),
):
    """
    Fetch and return the transcript of a YouTube video for preview in the teacher UI.
    Falls back to an LLM-generated mock transcript when captions are unavailable.
    """
    if not youtube_url:
        raise HTTPException(status_code=400, detail="youtube_url is required")

    transcript = fetch_youtube_transcript(youtube_url)
    if transcript:
        return {"transcript": transcript, "is_mock": False}

    try:
        from app.services.llm import llm_generate_mock_transcript
        mock = llm_generate_mock_transcript(title or "this topic")
        return {"transcript": mock, "is_mock": True}
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not fetch or generate transcript: {exc}",
        )


# ─── PUBLIC LISTING ───

@router.get("/", response_model=List[CourseListResponse])
def list_courses(db: Session = Depends(get_db)):
    """Public — lists all courses published by an approved teacher."""
    query_results = db.query(
        Course,
        func.count(Chapter.id).label("chapter_count")
    ).outerjoin(
        Chapter, Course.id == Chapter.course_id
    ).filter(
        Course.is_published == True,
    ).group_by(
        Course.id
    ).all()

    result = []
    for c, count in query_results:
        result.append(CourseListResponse(
            id=c.id,
            title=c.title,
            description=c.description,
            thumbnail=c.thumbnail,
            is_published=c.is_published,
            chapter_count=count,
        ))
    return result


@router.get("/{course_id}", response_model=CourseResponse)
def get_course(course_id: str, db: Session = Depends(get_db)):
    """Public — returns course details."""
    course = db.query(Course).options(
        joinedload(Course.chapters)
    ).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return CourseResponse.model_validate(course)


# ─── COURSE CRUD (teacher owns) ───

@router.post("/", response_model=CourseResponse)
def create_course(
    data: CourseCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = Course(
        title=data.title,
        description=data.description,
        thumbnail=data.thumbnail,
        pass_threshold=data.pass_threshold,
        teacher_id=current_user.id,
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
    _assert_course_owner(course, current_user)

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
    current_user: User = Depends(require_admin),
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
    """
    Teacher submits (or retracts) a course for admin review.
    Submitting resets any previous approval so admin must re-approve.
    """
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_owner(course, current_user)

    course.is_published = not course.is_published
    db.commit()
    if course.is_published:
        return {"message": "Course published — students can now see it", "status": "published"}
    return {"message": "Course retracted to draft", "status": "draft"}



# ─── CHAPTER ROUTES ───

@router.get("/chapters/{chapter_id}", response_model=ChapterDetailResponse)
def get_chapter(chapter_id: str, db: Session = Depends(get_db)):
    """Get details of a single chapter for the learner view (article + video).

    Only the columns the UI needs are loaded — the potentially large
    `video_transcript` is intentionally not fetched or returned here.
    """
    chapter = (
        db.query(Chapter)
        .options(
            load_only(
                Chapter.title,
                Chapter.order_index,
                Chapter.article_content,
                Chapter.youtube_url,
                Chapter.course_id,
            )
        )
        .filter(Chapter.id == chapter_id)
        .first()
    )
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return ChapterDetailResponse.model_validate(chapter)


@router.post("/{course_id}/chapters", response_model=ChapterResponse)
def add_chapter(
    course_id: str,
    data: ChapterCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_owner(course, current_user)

    video_transcript = data.video_transcript
    if not video_transcript and data.youtube_url:
        try:
            video_transcript = fetch_youtube_transcript(data.youtube_url)
        except Exception as exc:
            logger.warning("Inline transcript fetch failed for %s: %s", data.youtube_url, exc)

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

    # Embed transcript + article with OpenAI and store the vectors in
    # Pinecone (the single source of truth for vectors). The transcript/article
    # text itself stays in Supabase (the Chapter row above) for quiz generation.
    background_tasks.add_task(
        index_module_content,
        course_id, chapter.id, data.article_content, video_transcript,
    )

    return ChapterResponse.model_validate(chapter)


@router.put("/chapters/{chapter_id}", response_model=ChapterResponse)
def update_chapter(
    chapter_id: str,
    data: ChapterCreate,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    _assert_course_owner(chapter.course, current_user)

    video_transcript = data.video_transcript
    if not video_transcript and data.youtube_url:
        try:
            video_transcript = fetch_youtube_transcript(data.youtube_url)
        except Exception as exc:
            logger.warning("Inline transcript fetch failed for %s: %s", data.youtube_url, exc)

    chapter.title = data.title
    chapter.order_index = data.order_index
    chapter.article_content = data.article_content
    chapter.youtube_url = data.youtube_url
    chapter.video_transcript = video_transcript
    db.commit()
    db.refresh(chapter)
    course_id = chapter.course_id

    # Re-embed into Pinecone (vectors only live in Pinecone). The updated
    # transcript/article text is already persisted on the Chapter row above.
    background_tasks.add_task(
        index_module_content,
        course_id, chapter_id, data.article_content, video_transcript,
    )

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
    _assert_course_owner(chapter.course, current_user)
    db.delete(chapter)
    db.commit()
    return {"message": "Chapter deleted"}


# ─── VIDEO UPLOAD ───

MAX_FILE_SIZE = 100 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


@router.post("/upload-video")
def upload_video(
    file: UploadFile = File(...),
    current_user: User = Depends(require_teacher),
):
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type. Allowed formats: {', '.join(ALLOWED_EXTENSIONS)}"
        )

    # Read the bytes once so we can both store the video and transcribe it.
    data = file.file.read()
    if len(data) > MAX_FILE_SIZE:
        raise HTTPException(status_code=400, detail="File is too large. Max size is 100MB.")
    file.file.seek(0)

    url = upload_video_to_r2(file)

    # Auto-generate the transcript from the uploaded video (OpenAI Whisper).
    # Returns "" on any failure so the teacher can still fill it in manually.
    transcript = transcribe_video_bytes(data, file.filename) or ""
    return {"video_url": url, "transcript": transcript}


# ─── ARTICLE DOCUMENT IMPORT ───

@router.post("/extract-article")
def extract_article(
    file: UploadFile = File(...),
    current_user: User = Depends(require_teacher),
):
    """
    Convert an uploaded article document (.txt / .md / .pdf / .docx) into plain
    text. The text is returned to the teacher UI to populate the article box —
    it is then saved to Chapter.article_content exactly like typed text, so the
    rest of the pipeline (embeddings, quiz generation) is unchanged.
    """
    data = file.file.read()
    text = extract_text_from_document(file.filename, data)
    return {
        "article_content": text,
        "filename": file.filename,
        "char_count": len(text),
    }
