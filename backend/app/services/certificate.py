import logging
import secrets
from datetime import datetime
from sqlalchemy.orm import Session

from app.models.models import (
    Enrollment, EnrollmentStatus, Chapter, QuizAttempt, Evaluation, EvaluationType, Certificate
)

logger = logging.getLogger(__name__)

def issue_certificate_if_eligible(db: Session, user_id: str, course_id: str) -> bool:
    """Check if a user is eligible for a course certificate, and if so, issue it.
    
    A student is eligible if they have:
      1. Passed the final capstone oral interview for the course.
      2. Passed every chapter/module quiz or oral interview in the course.
      
    If eligible:
      - Sets enrollment status to COMPLETED and records completed_at.
      - Creates a Certificate record with a unique verify code (if one does not exist).
      
    Returns True if a certificate was issued or already existed, False otherwise.
    """
    db.flush()
    enrollment = db.query(Enrollment).filter(
        Enrollment.user_id == user_id,
        Enrollment.course_id == course_id
    ).first()
    
    if not enrollment:
        logger.warning("No enrollment found for user_id=%s course_id=%s", user_id, course_id)
        return False

    # 1. Check if capstone evaluation is passed
    passed_capstone = db.query(Evaluation).filter(
        Evaluation.user_id == user_id,
        Evaluation.course_id == course_id,
        Evaluation.type == EvaluationType.CAPSTONE,
        Evaluation.passed == True
    ).first() is not None
    
    if not passed_capstone:
        logger.info("User=%s has not passed capstone for course=%s", user_id, course_id)
        return False

    # 2. Check if all chapters/modules are completed/passed
    all_chapters = db.query(Chapter).filter(Chapter.course_id == course_id).all()
    all_modules_passed = True
    
    for chapter in all_chapters:
        passed_quiz = db.query(QuizAttempt).filter(
            QuizAttempt.user_id == user_id,
            QuizAttempt.chapter_id == chapter.id,
            QuizAttempt.passed == True
        ).first() is not None
        
        passed_interview = db.query(Evaluation).filter(
            Evaluation.user_id == user_id,
            Evaluation.chapter_id == chapter.id,
            Evaluation.passed == True
        ).first() is not None
        
        if not passed_quiz and not passed_interview:
            all_modules_passed = False
            logger.info(
                "User=%s course=%s eligible check failed at chapter '%s' (no passing quiz or evaluation)",
                user_id, course_id, chapter.title
            )
            break

    if not all_modules_passed:
        # If the capstone was passed but not all modules are complete,
        # ensure the status is at least CAPSTONE_READY.
        if enrollment.status != EnrollmentStatus.COMPLETED:
            enrollment.status = EnrollmentStatus.CAPSTONE_READY
        return False

    # If eligible, mark enrollment as completed and issue certificate
    enrollment.status = EnrollmentStatus.COMPLETED
    if not enrollment.completed_at:
        enrollment.completed_at = datetime.utcnow()
        
    # Check/issue certificate
    existing_cert = db.query(Certificate).filter(
        Certificate.user_id == user_id,
        Certificate.course_id == course_id
    ).first()
    
    if not existing_cert:
        cert = Certificate(
            user_id=user_id,
            course_id=course_id,
            verify_code=f"MVK-{secrets.token_hex(4).upper()}"
        )
        db.add(cert)
        logger.info("Certificate issued for user_id=%s course_id=%s", user_id, course_id)
        return True
        
    return True
