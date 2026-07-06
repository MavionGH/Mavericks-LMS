import logging
import os
import shutil
import tempfile
import uuid
from fastapi import APIRouter, Depends, HTTPException, File, UploadFile, BackgroundTasks
from sqlalchemy import func
from sqlalchemy.orm import Session, joinedload, load_only
from typing import List, Optional

from app.database import get_db
from app.models.models import Course, Chapter, User, UserRole
from app.schemas.schemas import (
    CourseCreate, CourseResponse, CourseListResponse,
    ChapterCreate, ChapterResponse, ChapterMinResponse, ChapterDetailResponse
)
from app.auth.dependencies import get_current_user, require_teacher, require_admin, get_optional_current_user
from app.services.transcript import fetch_youtube_transcript
from app.services.storage import upload_video_to_r2
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
def list_courses(
    db: Session = Depends(get_db),
    current_user: Optional[User] = Depends(get_optional_current_user),
):
    """Public — lists all courses published by an approved teacher."""
    query_results = db.query(
        Course,
        func.count(Chapter.id).label("chapter_count"),
        User.name.label("teacher_name")
    ).outerjoin(
        Chapter, Course.id == Chapter.course_id
    ).outerjoin(
        User, Course.teacher_id == User.id
    ).filter(
        Course.is_published == True,
    ).group_by(
        Course.id, User.name
    ).all()

    # Fetch user's enrollments if logged in
    enrollments_dict = {}
    if current_user:
        from app.models.models import Enrollment
        user_enrollments = db.query(Enrollment).filter(Enrollment.user_id == current_user.id).all()
        enrollments_dict = {e.course_id: e.status for e in user_enrollments}

    result = []
    for c, count, teacher_name in query_results:
        enroll_status = enrollments_dict.get(c.id, None)
        result.append(CourseListResponse(
            id=c.id,
            title=c.title,
            description=c.description,
            thumbnail=c.thumbnail,
            is_published=c.is_published,
            chapter_count=count,
            teacher_name=teacher_name,
            enrollment_status=enroll_status.value if enroll_status else None
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
        quiz_threshold=data.quiz_threshold,
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
    course.quiz_threshold = data.quiz_threshold
    db.commit()
    db.refresh(course)
    return CourseResponse.model_validate(course)


@router.delete("/{course_id}")
def delete_course(
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    course = db.query(Course).filter(Course.id == course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    _assert_course_owner(course, current_user)
    try:
        db.delete(course)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Error deleting course")
        raise HTTPException(status_code=400, detail=f"Failed to delete course: {exc}")
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

    # The chapter's transcript + article text is persisted on the Chapter row
    # above; it is the single source of truth used directly for quiz generation
    # and interviews (no embedding / vector indexing step).

    return ChapterResponse.model_validate(chapter)


@router.get("/manage/chapters/{chapter_id}", response_model=ChapterResponse)
def get_chapter_for_edit(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher),
):
    """Get full details of a single chapter for the teacher editing view (includes transcript)."""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")
    course = db.query(Course).filter(Course.id == chapter.course_id).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")
    if current_user.role != UserRole.ADMIN and course.teacher_id != current_user.id:
        raise HTTPException(status_code=403, detail="You do not own this course")
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

    # The updated transcript/article text is persisted on the Chapter row above
    # and used directly (no embedding / vector indexing step).

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
    try:
        db.delete(chapter)
        db.commit()
    except Exception as exc:
        db.rollback()
        logger.exception("Error deleting chapter")
        raise HTTPException(status_code=400, detail=f"Failed to delete chapter: {exc}")
    return {"message": "Chapter deleted"}


# ─── VIDEO UPLOAD ───

MAX_FILE_SIZE = 100 * 1024 * 1024
ALLOWED_EXTENSIONS = {".mp4", ".mov", ".webm", ".mkv"}


def _run_transcription_job(job_id: str, data: bytes, filename: str) -> None:
    """Background worker: transcribe `data` and store the result under `job_id`.

    transcribe_video_bytes never raises (returns None on any failure), but we
    still guard so an unexpected error is surfaced to the poller as 'error'
    rather than leaving the job stuck 'pending' forever.
    """
    from app.services.transcription_jobs import set_result, set_error
    try:
        text = transcribe_video_bytes(data, filename) or ""
        set_result(job_id, text)
    except Exception as exc:  # pragma: no cover - defensive
        logger.warning("Async transcription job %s failed: %s", job_id, exc)
        set_error(job_id, str(exc))


@router.post("/upload-video")
def upload_video(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    async_transcript: bool = False,
    current_user: User = Depends(require_teacher),
):
    """Upload a module video to R2 and (by default) return its Whisper transcript.

    Two modes:
      • Synchronous (default): upload + transcription run concurrently and the
        response includes {video_url, transcript}. Unchanged legacy behaviour.
      • Async opt-in (?async_transcript=1): upload only, then return immediately
        with {video_url, transcript: "", transcript_job_id}. Transcription runs
        in the background; the client polls GET /transcript-status/{job_id}. This
        makes the upload feel done in seconds regardless of video length.
    """
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

    if async_transcript:
        # Upload synchronously (the URL must be ready to return), then hand the
        # already-read bytes to a background transcription job and return at once.
        url = upload_video_to_r2(file)
        from app.services.transcription_jobs import create_job
        job_id = create_job()
        background_tasks.add_task(_run_transcription_job, job_id, data, file.filename)
        return {"video_url": url, "transcript": "", "transcript_job_id": job_id}

    # ── Synchronous path (default, unchanged response shape) ──
    # The R2 upload (reads file.file) and the transcription (works from the
    # in-memory `data`) are independent and both I/O-bound — ffmpeg is a
    # subprocess and both R2 and Whisper are network calls, all of which release
    # the GIL. Run them concurrently so the request waits ~max(upload, transcribe)
    # instead of the sum.
    import concurrent.futures

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as executor:
        upload_future = executor.submit(upload_video_to_r2, file)
        transcribe_future = executor.submit(transcribe_video_bytes, data, file.filename)
        # upload_video_to_r2 raises HTTPException on failure — .result() re-raises
        # it here so the endpoint still returns the same 500. transcribe returns
        # None on any failure (never raises), so the teacher can fill it in manually.
        url = upload_future.result()
        transcript = transcribe_future.result() or ""

    return {"video_url": url, "transcript": transcript}


@router.get("/transcript-status/{job_id}")
def transcript_status(
    job_id: str,
    current_user: User = Depends(require_teacher),
):
    """Poll the status of an async transcription job started by /upload-video.

    Returns {status: "pending"|"done"|"error", transcript, error}. 404 once the
    job is unknown or has expired (TTL) — the client should then fall back to
    manual transcript entry.
    """
    from app.services.transcription_jobs import get_job
    job = get_job(job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Transcript job not found or expired")
    return job


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
