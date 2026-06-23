from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import Chapter, QuizAttempt, QuizQuestion, User
from app.schemas.schemas import (
    QuizQuestionsResponse, QuizQuestionItem,
    QuizSubmitRequest, QuizResultResponse, QuizResultItem,
    QuizStatusResponse,
)
from app.auth.dependencies import get_current_user
from app.services.chapter_context import build_chapter_context
from app.services.llm import llm_generate_quiz

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
    """Return 5 MCQ questions for the chapter (correct answers NOT included)."""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Auto-fetch transcript from YouTube if missing
    if not chapter.video_transcript and chapter.youtube_url:
        try:
            from app.services.transcript import fetch_youtube_transcript
            transcript = fetch_youtube_transcript(chapter.youtube_url)
            if transcript:
                chapter.video_transcript = transcript
                db.commit()
                db.refresh(chapter)
                # Embed in a separate DB session so failures don't corrupt our transaction
                try:
                    from app.services.embeddings import embed_and_store_chapter
                    embed_and_store_chapter(
                        chapter.id, chapter.course_id,
                        chapter.article_content, transcript,
                        db=None,  # uses its own session
                    )
                except Exception:
                    pass
        except Exception:
            db.rollback()

    cached = db.query(QuizQuestion).filter(QuizQuestion.chapter_id == chapter_id).first()
    if not cached:
        context = build_chapter_context(chapter, db=db)
        raw_qs = llm_generate_quiz(chapter.title, context)
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
    )
