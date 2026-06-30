import logging
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import (
    Chapter, Enrollment, EnrollmentStatus, QuizAttempt, QuizQuestion, User,
)
from app.schemas.schemas import (
    QuizQuestionsResponse, QuizQuestionItem,
    QuizSubmitRequest, QuizResultResponse, QuizResultItem,
    QuizStatusResponse, QuizWarningLog,
)
from app.auth.dependencies import get_current_user
from app.services.llm import llm_generate_quiz

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/quiz", tags=["Quiz"])


@router.get("/{chapter_id}/my-status", response_model=QuizStatusResponse)
def get_quiz_status(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    latest = (
        db.query(QuizAttempt)
        .filter(QuizAttempt.user_id == current_user.id, QuizAttempt.chapter_id == chapter_id)
        .order_by(QuizAttempt.attempted_at.desc())
        .first()
    )
    if not latest:
        return QuizStatusResponse(attempted=False, passed=False, score=None)
    return QuizStatusResponse(attempted=True, passed=latest.passed, score=latest.score)


@router.get("/{chapter_id}", response_model=QuizQuestionsResponse)
def get_quiz(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return 10 freshly-generated MCQ questions for the chapter (correct answers NOT included)."""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Always regenerate — questions are NOT cached, so each request is different.
    # Built directly from the module's video transcript + article (no vector search).
    raw_qs = llm_generate_quiz(
        chapter.title, chapter.video_transcript, chapter.article_content
    )

    # Persist the current set so /submit can grade this attempt server-side.
    cached = db.query(QuizQuestion).filter(QuizQuestion.chapter_id == chapter_id).first()
    if cached:
        cached.questions = raw_qs
    else:
        cached = QuizQuestion(chapter_id=chapter_id, questions=raw_qs)
        db.add(cached)
    db.commit()
    db.refresh(cached)

    items = [
        QuizQuestionItem(id=q["id"], question=q["question"], options=q["options"])
        for q in cached.questions
    ]
    return QuizQuestionsResponse(chapter_id=chapter_id, questions=items)


@router.post("/submit", response_model=QuizResultResponse)
def submit_quiz(
    data: QuizSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Grade answers server-side and persist the attempt."""
    chapter = db.query(Chapter).filter(Chapter.id == data.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    cached = db.query(QuizQuestion).filter(QuizQuestion.chapter_id == data.chapter_id).first()
    if not cached:
        raise HTTPException(
            status_code=400,
            detail="No quiz questions found — call GET /api/quiz/{chapter_id} first",
        )

    threshold = chapter.course.pass_threshold if chapter.course else 70
    questions = cached.questions
    correct_count = 0
    result_items = []

    for q in questions:
        qid = str(q["id"])
        selected = data.answers.get(qid, "")
        is_correct = selected == q["correct"]
        if is_correct:
            correct_count += 1
        result_items.append(QuizResultItem(
            id=q["id"],
            correct=is_correct,
            selected=selected,
            correct_answer=q["correct"],
        ))

    score = round((correct_count / len(questions)) * 100)
    passed = score >= threshold

    attempt = QuizAttempt(
        user_id=current_user.id,
        chapter_id=data.chapter_id,
        questions=questions,
        score=score,
        passed=passed,
    )
    db.add(attempt)

    # ── Progression ──
    # Passing a module's quiz is now what advances the student to the next module.
    # (The voice interview is no longer a per-module gate; it is an optional,
    # course-wide assessment available at any time.)
    next_chapter_unlocked = False
    course_completed = False
    if passed:
        enrollment = db.query(Enrollment).filter(
            Enrollment.user_id == current_user.id,
            Enrollment.course_id == chapter.course_id,
        ).first()
        if enrollment:
            sorted_chapters = sorted(
                chapter.course.chapters, key=lambda c: c.order_index
            )
            # Only advance when the student is passing the quiz for their CURRENT
            # active module — retaking an earlier module's quiz must not move them.
            current = (
                sorted_chapters[enrollment.current_chapter_index]
                if 0 <= enrollment.current_chapter_index < len(sorted_chapters)
                else None
            )
            if current and current.id == data.chapter_id:
                if enrollment.current_chapter_index + 1 < len(sorted_chapters):
                    enrollment.current_chapter_index += 1
                    enrollment.video_watched = False
                    enrollment.article_read = False
                    next_chapter_unlocked = True
                else:
                    # Passed the final module — all learning content is complete.
                    enrollment.status = EnrollmentStatus.COMPLETED
                    enrollment.completed_at = datetime.utcnow()
                    course_completed = True

    db.commit()
    db.refresh(attempt)

    return QuizResultResponse(
        score=score,
        passed=passed,
        correct_count=correct_count,
        total=len(questions),
        threshold=threshold,
        attempt_id=attempt.id,
        results=result_items,
        next_chapter_unlocked=next_chapter_unlocked,
        course_completed=course_completed,
    )


@router.post("/log-warning", status_code=200)
async def log_quiz_warning(
    log: QuizWarningLog,
    current_user: User = Depends(get_current_user),
):
    """
    Receive an anti-cheating violation event from the quiz frontend.
    Logs the incident server-side for instructor review.
    In a production system this should be persisted to a QuizViolation table.
    """
    logger.warning(
        "[QUIZ INTEGRITY] user=%s  type=%s  code=%s  ts=%s  msg=%s",
        current_user.id,
        log.type,
        log.code,
        log.timestamp,
        log.message,
    )
    return {"status": "logged", "user_id": current_user.id}
