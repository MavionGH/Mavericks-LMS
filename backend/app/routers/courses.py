import logging
import os
import shutil
import tempfile
import uuid
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks, File, UploadFile
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload
from typing import List, Optional

from app.database import get_db
from app.models.models import Course, Chapter, User
from app.schemas.schemas import (
    CourseCreate, CourseResponse, CourseListResponse,
    ChapterCreate, ChapterResponse, ChapterMinResponse
)
from app.auth.dependencies import get_current_user, require_teacher, require_admin
from app.services.transcript import fetch_youtube_transcript
from app.services.embeddings import embed_and_store_chapter
from app.services.storage import upload_video_to_r2
from app.services.pinecone_store import index_module_content
from app.services.video_transcription import extract_audio, split_audio, transcribe_chunks

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/courses", tags=["Courses"])


@router.get("/manage/all", response_model=List[CourseResponse])
def list_all_courses_teacher(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """Teacher/admin — lists all courses including drafts."""
    courses = db.query(Course).options(
        joinedload(Course.chapters)
    ).order_by(Course.created_at.desc()).all()
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

    # Fallback: generate a mock transcript via LLM
    try:
        from app.services.llm import llm_generate_mock_transcript
        mock = llm_generate_mock_transcript(title or "this topic")
        return {"transcript": mock, "is_mock": True}
    except Exception as exc:
        raise HTTPException(
            status_code=400,
            detail=f"Could not fetch or generate transcript: {exc}",
        )


@router.get("/", response_model=List[CourseListResponse])
def list_courses(db: Session = Depends(get_db)):
    """Public endpoint — lists all published courses."""
    query_results = db.query(
        Course,
        func.count(Chapter.id).label("chapter_count")
    ).outerjoin(
        Chapter, Course.id == Chapter.course_id
    ).filter(
        Course.is_published == True
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
    """Public endpoint — returns course details."""
    course = db.query(Course).options(
        joinedload(Course.chapters)
    ).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    return CourseResponse.model_validate(course)


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
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    course.is_published = not course.is_published
    db.commit()
    return {"message": f"Course {'published' if course.is_published else 'unpublished'}"}


# ─── CHAPTER ROUTES ───

@router.get("/chapters/{chapter_id}", response_model=ChapterResponse)
def get_chapter(chapter_id: str, db: Session = Depends(get_db)):
    """Get details of a single chapter (includes article_content)."""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    return ChapterResponse.model_validate(chapter)


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

    # Attempt inline transcript fetch so the response already contains it
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

    # Embed in background (non-blocking — sentence-transformers can take a few seconds)
    background_tasks.add_task(
        embed_and_store_chapter,
        chapter.id, course_id, data.article_content, video_transcript,
    )
    # Chunk + embed + upsert module content into Pinecone (course-namespaced RAG store)
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

    # Re-fetch transcript if URL provided but no transcript given
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

    # Re-embed updated content in background
    background_tasks.add_task(
        embed_and_store_chapter,
        chapter_id, course_id, data.article_content, video_transcript,
    )
    # Re-index module content into Pinecone (re-upserts only this module's vectors)
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
    db.delete(chapter)
    db.commit()
    return {"message": "Chapter deleted"}


# Limit file uploads: max 100MB
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
        
    # Read size to validate
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    
    if file_size > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=400,
            detail="File is too large. Max size is 100MB."
        )
        
    url = upload_video_to_r2(file)
    return {"video_url": url}


# ─── VIDEO TRANSCRIPTION ───

# Separate upload cap for transcription (larger since we discard the file after)
MAX_TRANSCRIBE_MB = 500
MAX_TRANSCRIBE_BYTES = MAX_TRANSCRIBE_MB * 1024 * 1024
ALLOWED_VIDEO_EXTENSIONS = {".mp4", ".mkv", ".avi", ".mov", ".webm"}


@router.post("/transcribe-video")
def transcribe_video(
    file: UploadFile = File(...),
    current_user: User = Depends(require_teacher),
):
    """
    Extract audio from an uploaded video file and transcribe it using
    Groq Whisper (whisper-large-v3-turbo).  Returns the full transcript text.

    Processing pipeline:
      1. Save video to a temporary job directory.
      2. Extract mono 16 kHz 64 kbps MP3 via ffmpeg.
      3. If audio > 25 MB, split into time-based chunks via ffmpeg/ffprobe.
      4. Transcribe each chunk sequentially with the Groq Whisper API.
      5. Merge and return results; always clean up temp files in finally.
    """
    # ── Validate extension ──────────────────────────────────────────────────
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED_VIDEO_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid file type '{ext}'. Allowed: {', '.join(ALLOWED_VIDEO_EXTENSIONS)}",
        )

    # ── Validate size ───────────────────────────────────────────────────────
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)
    if file_size > MAX_TRANSCRIBE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File is too large for transcription. Maximum allowed: {MAX_TRANSCRIBE_MB} MB.",
        )

    # ── Set up isolated temp directory for this job ─────────────────────────
    job_id = str(uuid.uuid4())
    job_dir = os.path.join(tempfile.gettempdir(), f"vidscribe_{job_id}")
    os.makedirs(job_dir, exist_ok=True)

    video_path = os.path.join(job_dir, f"input{ext}")
    audio_path = os.path.join(job_dir, "audio.mp3")
    chunks_dir = os.path.join(job_dir, "chunks")

    try:
        # ── 1. Save video to disk ───────────────────────────────────────────
        logger.info("[%s] Saving uploaded video (%s MB)", job_id, round(file_size / 1024 / 1024, 1))
        with open(video_path, "wb") as fout:
            shutil.copyfileobj(file.file, fout)

        # ── 2. Extract audio ────────────────────────────────────────────────
        logger.info("[%s] Extracting audio", job_id)
        try:
            extract_audio(video_path, audio_path)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Audio extraction failed. Ensure ffmpeg is installed and on PATH. Details: {exc}",
            )

        # ── 3. Split if necessary ───────────────────────────────────────────
        logger.info("[%s] Splitting audio if needed", job_id)
        try:
            chunk_paths = split_audio(audio_path, chunks_dir)
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Audio splitting failed. Details: {exc}",
            )

        # ── 4. Transcribe ───────────────────────────────────────────────────
        logger.info("[%s] Transcribing %d chunk(s) with Groq Whisper", job_id, len(chunk_paths))
        try:
            transcript = transcribe_chunks(chunk_paths)
        except EnvironmentError as exc:
            raise HTTPException(status_code=500, detail=str(exc))
        except RuntimeError as exc:
            raise HTTPException(
                status_code=500,
                detail=f"Transcription failed. Details: {exc}",
            )

        logger.info("[%s] Transcription complete: %d chars", job_id, len(transcript))
        return {"transcript": transcript}

    finally:
        # ── 5. Always clean up temp files ───────────────────────────────────
        try:
            shutil.rmtree(job_dir, ignore_errors=True)
            logger.info("[%s] Temp directory cleaned up", job_id)
        except Exception as cleanup_exc:
            logger.warning("[%s] Cleanup failed: %s", job_id, cleanup_exc)
