"""
Quiz router — generate MCQ questions per chapter and grade submissions.

GET  /api/quiz/{chapter_id}  — return questions (generate & store if none exist)
POST /api/quiz/submit        — grade answers server-side, save attempt
GET  /api/quiz/{chapter_id}/status — check if student has passed this chapter's quiz
"""
import logging
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from typing import List, Optional

from app.database import get_db
from app.models.models import (
    Chapter, Course, Enrollment, QuizAttempt, QuizQuestion, User,
)
from app.auth.dependencies import require_student
from app.services.chapter_context import build_chapter_context
from app.services.llm import llm_generate_quiz_questions

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/quiz", tags=["Quiz"])

NUM_QUIZ_QUESTIONS = 5


# ── Schemas (kept local to avoid circular imports) ────────────────────
from pydantic import BaseModel
from datetime import datetime


class QuizQuestionOut(BaseModel):
    """Question sent to the student — correct_option is NOT included."""
    id: str
    question_text: str
    options: dict  # {"A": "...", "B": "...", ...}
    order_index: int


class QuizSubmitRequest(BaseModel):
    chapter_id: str
    answers: dict  # {question_id: "A" | "B" | "C" | "D"}


class QuizResultResponse(BaseModel):
    attempt_id: str
    chapter_id: str
    score: int        # 0-100
    passed: bool
    pass_threshold: int
    total_questions: int
    correct_count: int
    details: list     # per-question breakdown


class QuizStatusResponse(BaseModel):
    attempted: bool
    passed: bool
    best_score: int = 0
    attempts: int = 0


# ── GET /api/quiz/{chapter_id} ────────────────────────────────────────
@router.get("/{chapter_id}", response_model=List[QuizQuestionOut])
def get_quiz_questions(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """Return quiz questions for a chapter. Generates & stores them on first call."""
    chapter = db.query(Chapter).filter(Chapter.id == chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    # Verify enrollment
    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this course")

    # Check if questions already exist for this chapter
    existing = (
        db.query(QuizQuestion)
        .filter(QuizQuestion.chapter_id == chapter_id)
        .order_by(QuizQuestion.order_index)
        .all()
    )

    if existing:
        return [
            QuizQuestionOut(
                id=q.id,
                question_text=q.question_text,
                options=q.options,
                order_index=q.order_index,
            )
            for q in existing
        ]

    # Generate questions via LLM (use RAG context if available)
    context = build_chapter_context(
        chapter,
        query=f"key concepts and topics in {chapter.title}",
        db=db,
    )
    raw_questions = llm_generate_quiz_questions(chapter.title, context, NUM_QUIZ_QUESTIONS)

    created = []
    for i, q_data in enumerate(raw_questions):
        q = QuizQuestion(
            chapter_id=chapter_id,
            question_text=q_data["question_text"],
            options=q_data["options"],
            correct_option=q_data["correct_option"],
            order_index=i,
        )
        db.add(q)
        created.append(q)

    db.commit()
    for q in created:
        db.refresh(q)

    logger.info(f"Generated {len(created)} quiz questions for chapter {chapter_id}")

    return [
        QuizQuestionOut(
            id=q.id,
            question_text=q.question_text,
            options=q.options,
            order_index=q.order_index,
        )
        for q in created
    ]


# ── POST /api/quiz/submit ────────────────────────────────────────────
@router.post("/submit", response_model=QuizResultResponse)
def submit_quiz(
    data: QuizSubmitRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """Grade quiz answers server-side and save the attempt."""
    chapter = db.query(Chapter).filter(Chapter.id == data.chapter_id).first()
    if not chapter:
        raise HTTPException(status_code=404, detail="Chapter not found")

    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == current_user.id,
        Enrollment.course_id == chapter.course_id,
    ).first()
    if not enrollment:
        raise HTTPException(status_code=403, detail="Not enrolled in this course")

    course = db.query(Course).filter(Course.id == chapter.course_id).first()

    # Fetch the stored questions for this chapter
    questions = (
        db.query(QuizQuestion)
        .filter(QuizQuestion.chapter_id == data.chapter_id)
        .order_by(QuizQuestion.order_index)
        .all()
    )
    if not questions:
        raise HTTPException(status_code=400, detail="No quiz questions found — load them first via GET")

    # Grade
    correct_count = 0
    details = []
    for q in questions:
        student_answer = data.answers.get(q.id)
        is_correct = student_answer == q.correct_option
        if is_correct:
            correct_count += 1
        details.append({
            "question_id": q.id,
            "question_text": q.question_text,
            "selected": student_answer,
            "correct": q.correct_option,
            "is_correct": is_correct,
        })

    total = len(questions)
    score = round((correct_count / total) * 100) if total > 0 else 0
    passed = score >= course.pass_threshold

    # Save attempt
    attempt = QuizAttempt(
        user_id=current_user.id,
        chapter_id=data.chapter_id,
        questions=details,
        score=score,
        passed=passed,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)

    return QuizResultResponse(
        attempt_id=attempt.id,
        chapter_id=data.chapter_id,
        score=score,
        passed=passed,
        pass_threshold=course.pass_threshold,
        total_questions=total,
        correct_count=correct_count,
        details=details,
    )


# ── GET /api/quiz/{chapter_id}/status ─────────────────────────────────
@router.get("/{chapter_id}/status", response_model=QuizStatusResponse)
def get_quiz_status(
    chapter_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student),
):
    """Check whether the current student has passed this chapter's quiz."""
    attempts = (
        db.query(QuizAttempt)
        .filter(
            QuizAttempt.user_id == current_user.id,
            QuizAttempt.chapter_id == chapter_id,
        )
        .all()
    )
    if not attempts:
        return QuizStatusResponse(attempted=False, passed=False)

    best_score = max(a.score for a in attempts)
    any_passed = any(a.passed for a in attempts)

    return QuizStatusResponse(
        attempted=True,
        passed=any_passed,
        best_score=best_score,
        attempts=len(attempts),
    )
