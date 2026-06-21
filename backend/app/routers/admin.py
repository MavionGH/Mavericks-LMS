from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models.models import User, Course, Enrollment, Evaluation, Certificate, UserRole
from app.schemas.schemas import AnalyticsResponse, UserResponse
from app.auth.dependencies import require_admin

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    total_students = db.query(User).filter(User.role == UserRole.STUDENT).count()
    total_courses = db.query(Course).count()
    published_courses = db.query(Course).filter(Course.is_published == True).count()
    total_enrollments = db.query(Enrollment).count()
    completed = db.query(Enrollment).filter(Enrollment.status == "completed").count()
    certs = db.query(Certificate).count()

    avg_score = db.query(func.avg(Evaluation.overall_score)).scalar() or 0
    total_evals = db.query(Evaluation).count()
    passed_evals = db.query(Evaluation).filter(Evaluation.passed == True).count()
    pass_rate = (passed_evals / total_evals * 100) if total_evals > 0 else 0

    return AnalyticsResponse(
        total_students=total_students,
        active_students=total_enrollments,
        total_courses=total_courses,
        published_courses=published_courses,
        total_enrollments=total_enrollments,
        completed_courses=completed,
        certificates_issued=certs,
        average_score=round(avg_score, 1),
        pass_rate=round(pass_rate, 1),
    )


@router.get("/students")
def list_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    students = db.query(User).filter(User.role == UserRole.STUDENT).all()
    result = []
    for s in students:
        enrollments = db.query(Enrollment).filter(Enrollment.user_id == s.id).count()
        evals = db.query(Evaluation).filter(Evaluation.user_id == s.id).all()
        avg_score = sum(e.overall_score for e in evals) / len(evals) if evals else 0
        result.append({
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "enrollments": enrollments,
            "evaluations": len(evals),
            "average_score": round(avg_score, 1),
            "joined": s.created_at.isoformat(),
        })
    return result


@router.get("/students/{student_id}")
def get_student_detail(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    enrollments = db.query(Enrollment).filter(Enrollment.user_id == student_id).all()
    evaluations = db.query(Evaluation).filter(Evaluation.user_id == student_id).all()
    certificates = db.query(Certificate).filter(Certificate.user_id == student_id).all()

    return {
        "student": {
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "joined": student.created_at.isoformat(),
        },
        "enrollments": [{"course_id": e.course_id, "status": e.status.value, "chapter": e.current_chapter_index} for e in enrollments],
        "evaluations": [{"chapter_id": e.chapter_id, "score": e.overall_score, "passed": e.passed, "type": e.type.value} for e in evaluations],
        "certificates": [{"course_id": c.course_id, "verify_code": c.verify_code, "issued": c.issue_date.isoformat()} for c in certificates],
    }


@router.get("/teachers")
def list_teachers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    teachers = db.query(User).filter(User.role == UserRole.TEACHER).all()
    return [{"id": t.id, "name": t.name, "email": t.email, "joined": t.created_at.isoformat()} for t in teachers]


@router.patch("/users/{user_id}/role")
def change_user_role(
    user_id: str,
    role: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin can promote/demote any user's role."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    role_map = {"student": UserRole.STUDENT, "teacher": UserRole.TEACHER, "admin": UserRole.ADMIN}
    if role not in role_map:
        raise HTTPException(status_code=400, detail="Invalid role. Use: student, teacher, or admin")
    user.role = role_map[role]
    db.commit()
    return {"message": f"User role updated to {role}", "user_id": user_id}
