from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session, joinedload, selectinload
from sqlalchemy import func
from typing import List

from app.database import get_db
from app.models.models import User, Course, Chapter, Enrollment, Evaluation, Certificate, UserRole
from app.schemas.schemas import AnalyticsResponse
from app.auth.dependencies import require_admin

router = APIRouter(prefix="/api/admin", tags=["Admin"])


@router.get("/analytics", response_model=AnalyticsResponse)
def get_analytics(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    total_students = db.query(User).filter(User.role == UserRole.STUDENT).count()
    total_courses = db.query(Course).count()
    # A course is "live" to students once it is published (the enrollment gate).
    published_courses = db.query(Course).filter(
        Course.is_published == True
    ).count()
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


# ─── STUDENT MANAGEMENT ───

@router.get("/students")
def list_students(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    enrollment_sub = (
        db.query(Enrollment.user_id, func.count(Enrollment.id).label("enrollment_count"))
        .group_by(Enrollment.user_id)
        .subquery()
    )
    evaluation_sub = (
        db.query(
            Evaluation.user_id,
            func.count(Evaluation.id).label("evaluation_count"),
            func.avg(Evaluation.overall_score).label("avg_score")
        )
        .group_by(Evaluation.user_id)
        .subquery()
    )
    students_data = (
        db.query(
            User,
            func.coalesce(enrollment_sub.c.enrollment_count, 0).label("enrollments"),
            func.coalesce(evaluation_sub.c.evaluation_count, 0).label("evaluations"),
            func.coalesce(evaluation_sub.c.avg_score, 0.0).label("average_score")
        )
        .outerjoin(enrollment_sub, User.id == enrollment_sub.c.user_id)
        .outerjoin(evaluation_sub, User.id == evaluation_sub.c.user_id)
        .filter(User.role == UserRole.STUDENT)
        .all()
    )
    result = []
    for s, enrollments, evaluations, avg_score in students_data:
        result.append({
            "id": s.id,
            "name": s.name,
            "email": s.email,
            "enrollments": enrollments,
            "evaluations": evaluations,
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
    student = db.query(User).filter(User.id == student_id, User.role == UserRole.STUDENT).first()
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
        "enrollments": [
            {"course_id": e.course_id, "status": e.status.value, "chapter": e.current_chapter_index}
            for e in enrollments
        ],
        "evaluations": [
            {"chapter_id": e.chapter_id, "score": e.overall_score, "passed": e.passed, "type": e.type.value}
            for e in evaluations
        ],
        "certificates": [
            {"course_id": c.course_id, "verify_code": c.verify_code, "issued": c.issue_date.isoformat()}
            for c in certificates
        ],
    }


@router.delete("/students/{student_id}")
def delete_student(
    student_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    student = db.query(User).filter(User.id == student_id, User.role == UserRole.STUDENT).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")
    db.delete(student)
    db.commit()
    return {"message": "Student removed", "user_id": student_id}


# ─── TEACHER MANAGEMENT ───

@router.get("/teachers")
def list_teachers(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    course_sub = (
        db.query(Course.teacher_id, func.count(Course.id).label("course_count"))
        .group_by(Course.teacher_id)
        .subquery()
    )
    teachers_data = (
        db.query(
            User,
            func.coalesce(course_sub.c.course_count, 0).label("course_count")
        )
        .outerjoin(course_sub, User.id == course_sub.c.teacher_id)
        .filter(User.role == UserRole.TEACHER)
        .all()
    )
    result = []
    for t, course_count in teachers_data:
        result.append({
            "id": t.id,
            "name": t.name,
            "email": t.email,
            "is_approved": t.is_approved,
            "course_count": course_count,
            "joined": t.created_at.isoformat(),
        })
    return result


@router.put("/teachers/{teacher_id}/approve")
def approve_teacher(
    teacher_id: str,
    approved: bool = True,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin approves or rejects a teacher account."""
    teacher = db.query(User).filter(User.id == teacher_id, User.role == UserRole.TEACHER).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    teacher.is_approved = approved
    db.commit()
    action = "approved" if approved else "rejected"
    return {"message": f"Teacher {action}", "teacher_id": teacher_id, "is_approved": approved}


@router.get("/teachers/{teacher_id}")
def get_teacher_detail(
    teacher_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    teacher = db.query(User).filter(User.id == teacher_id, User.role == UserRole.TEACHER).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")

    courses = (
        db.query(Course)
        .options(joinedload(Course.chapters))
        .filter(Course.teacher_id == teacher_id)
        .all()
    )

    return {
        "teacher": {
            "id": teacher.id,
            "name": teacher.name,
            "email": teacher.email,
            "joined": teacher.created_at.isoformat(),
        },
        "courses": [
            {
                "id": c.id,
                "title": c.title,
                "is_published": c.is_published,
                "is_approved": c.is_approved,
                "chapter_count": len(c.chapters),
                "created_at": c.created_at.isoformat(),
            }
            for c in courses
        ],
    }


@router.get("/teachers/{teacher_id}/courses/{course_id}/students")
def get_course_students(
    teacher_id: str,
    course_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """List all students enrolled in a specific course, with per-course evaluation stats."""
    course = db.query(Course).filter(
        Course.id == course_id, Course.teacher_id == teacher_id
    ).first()
    if not course:
        raise HTTPException(status_code=404, detail="Course not found")

    enrollments = (
        db.query(Enrollment)
        .options(joinedload(Enrollment.user))
        .filter(Enrollment.course_id == course_id)
        .all()
    )

    result = []
    for enr in enrollments:
        student = enr.user
        if not student:
            continue
        # Fetch evaluations for this student in this course's chapters
        evals = (
            db.query(Evaluation)
            .join(Chapter, Evaluation.chapter_id == Chapter.id)
            .filter(Chapter.course_id == course_id, Evaluation.user_id == student.id)
            .all()
        )
        avg_score = round(sum(e.overall_score for e in evals) / len(evals), 1) if evals else 0.0
        passed_count = sum(1 for e in evals if e.passed)
        result.append({
            "id": student.id,
            "name": student.name,
            "email": student.email,
            "enrolled_at": enr.enrolled_at.isoformat() if enr.enrolled_at else None,
            "status": enr.status.value,
            "current_chapter": enr.current_chapter_index,
            "evaluations_total": len(evals),
            "evaluations_passed": passed_count,
            "average_score": avg_score,
        })
    return result


@router.delete("/teachers/{teacher_id}")
def delete_teacher(
    teacher_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    teacher = db.query(User).filter(User.id == teacher_id, User.role == UserRole.TEACHER).first()
    if not teacher:
        raise HTTPException(status_code=404, detail="Teacher not found")
    db.delete(teacher)
    db.commit()
    return {"message": "Teacher removed", "user_id": teacher_id}


# ─── ROLE MANAGEMENT ───

@router.patch("/users/{user_id}/role")
def change_user_role(
    user_id: str,
    role: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin can promote/demote any non-admin user's role."""
    user = db.query(User).filter(User.id == user_id).first()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role == UserRole.ADMIN:
        raise HTTPException(status_code=403, detail="Cannot change the role of another admin")
    role_map = {"student": UserRole.STUDENT, "teacher": UserRole.TEACHER}
    if role not in role_map:
        raise HTTPException(status_code=400, detail="Invalid role. Use: student or teacher")
    user.role = role_map[role]
    db.commit()
    return {"message": f"User role updated to {role}", "user_id": user_id}


# ─── COURSES OVERVIEW ───

@router.get("/courses")
def list_all_courses(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_admin),
):
    """Admin overview of all courses across all teachers, with module list."""
    courses = (
        db.query(Course)
        .options(selectinload(Course.chapters), joinedload(Course.teacher))
        .order_by(Course.created_at.desc())
        .all()
    )
    return [
        {
            "id": c.id,
            "title": c.title,
            "description": c.description,
            "is_published": c.is_published,
            "is_approved": c.is_approved,
            "teacher": {
                "id": c.teacher.id if c.teacher else None,
                "name": c.teacher.name if c.teacher else "Unknown",
                "email": c.teacher.email if c.teacher else None,
            },
            "modules": [
                {
                    "id": ch.id,
                    "title": ch.title,
                    "order_index": ch.order_index,
                    "has_transcript": ch.has_transcript,
                }
                for ch in c.chapters
            ],
            "created_at": c.created_at.isoformat(),
        }
        for c in courses
    ]
