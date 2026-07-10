import logging
from typing import Optional, List
from fastapi import APIRouter, Depends, HTTPException, status, UploadFile, File, Form
from sqlalchemy.orm import Session, joinedload
from datetime import datetime

from app.database import get_db
from app.models.models import (
    User, UserRole, HiringTemplate, InterviewAttempt, InterviewStage,
    StudentInterviewProgress, CodingSubmission
)
from app.schemas.schemas import (
    HiringTemplateCreate, HiringTemplateResponse,
    InterviewAttemptResponse, CodingSubmissionCreate, CodingSubmissionResponse,
    StudentInterviewProgressResponse, StudentHiringDetailResponse, InterviewStageResponse
)
from app.auth.dependencies import get_current_user, require_teacher, require_student
from app.services.storage import upload_cv

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/hiring", tags=["Hiring Interviews"])


# ─── TEACHER & STUDENT: TEMPLATE MANAGEMENT ───

@router.get("/templates", response_model=List[HiringTemplateResponse])
def list_templates(
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """List all available hiring templates."""
    templates = db.query(HiringTemplate).all()
    results = []
    for t in templates:
        teacher_name = db.query(User.name).filter(User.id == t.teacher_id).scalar() or "Unknown Teacher"
        results.append(
            HiringTemplateResponse(
                id=t.id,
                job_title=t.job_title,
                teacher_id=t.teacher_id,
                created_at=t.created_at,
                teacher_name=teacher_name
            )
        )
    return results


@router.post("/templates", response_model=HiringTemplateResponse, status_code=201)
def create_template(
    data: HiringTemplateCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """Create a new hiring template (Teacher/Admin only)."""
    template = HiringTemplate(
        job_title=data.job_title.strip(),
        teacher_id=current_user.id
    )
    db.add(template)
    db.commit()
    db.refresh(template)
    
    return HiringTemplateResponse(
        id=template.id,
        job_title=template.job_title,
        teacher_id=template.teacher_id,
        created_at=template.created_at,
        teacher_name=current_user.name
    )


@router.get("/templates/{template_id}", response_model=HiringTemplateResponse)
def get_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Get details of a specific hiring template."""
    template = db.query(HiringTemplate).filter(HiringTemplate.id == template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Hiring template not found")
    
    teacher_name = db.query(User.name).filter(User.id == template.teacher_id).scalar() or "Unknown Teacher"
    return HiringTemplateResponse(
        id=template.id,
        job_title=template.job_title,
        teacher_id=template.teacher_id,
        created_at=template.created_at,
        teacher_name=teacher_name
    )


# ─── TEACHER: VIEW STUDENTS BY STAGE ───

@router.get("/templates/{template_id}/students", response_model=List[StudentInterviewProgressResponse])
def get_all_students_for_template(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Get a list of all students who have started an interview attempt for a given hiring template.
    """
    progresses = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == template_id
    ).all()

    results = []
    for p in progresses:
        student = db.query(User).filter(User.id == p.user_id).first()
        if student:
            results.append(
                StudentInterviewProgressResponse(
                    id=p.id,
                    user_id=p.user_id,
                    hiring_template_id=p.hiring_template_id,
                    current_stage=p.current_stage,
                    status=p.status,
                    updated_at=p.updated_at,
                    student_name=student.name,
                    student_email=student.email
                )
            )
    return results


@router.get("/templates/{template_id}/stage/{stage_type}/students", response_model=List[StudentInterviewProgressResponse])
def get_students_by_stage(
    template_id: str,
    stage_type: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """
    Get a list of students who have reached or attempted the specified interview stage
    for a given hiring template.
    """
    if stage_type not in ["hr", "coding", "problem_solving"]:
        raise HTTPException(status_code=400, detail="Invalid stage type")

    # A student matches if they have a progress record where:
    # 1. current_stage is the stage_type
    # OR 2. they have completed it (current_stage is further or completed, or they attempted it)
    # Let's search by progress or attempts.
    # To keep it robust, let's fetch all StudentInterviewProgress for this template
    # and map/filter by stage.
    progresses = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == template_id
    ).all()

    results = []
    for p in progresses:
        # Check if the student has reached or attempted this stage.
        # Stages are ordered: hr -> coding -> problem_solving -> completed.
        stage_order = {"hr": 1, "coding": 2, "problem_solving": 3, "completed": 4}
        current_val = stage_order.get(p.current_stage, 1)
        target_val = stage_order.get(stage_type, 1)

        # Has reached target if current_val >= target_val
        has_reached = current_val >= target_val

        # Also count if they attempted it (look at attempts and stage status)
        if not has_reached:
            has_attempt = db.query(InterviewStage).join(InterviewAttempt).filter(
                InterviewAttempt.user_id == p.user_id,
                InterviewAttempt.hiring_template_id == template_id,
                InterviewStage.stage_type == stage_type,
                InterviewStage.status != "locked"
            ).first() is not None
            has_reached = has_attempt

        if has_reached:
            student = db.query(User).filter(User.id == p.user_id).first()
            if student:
                results.append(
                    StudentInterviewProgressResponse(
                        id=p.id,
                        user_id=p.user_id,
                        hiring_template_id=p.hiring_template_id,
                        current_stage=p.current_stage,
                        status=p.status,
                        updated_at=p.updated_at,
                        student_name=student.name,
                        student_email=student.email
                    )
                )
    return results


@router.get("/templates/{template_id}/students/{student_id}", response_model=StudentHiringDetailResponse)
def get_student_hiring_details(
    template_id: str,
    student_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_teacher)
):
    """Get a detailed report on a student's hiring module state for a template."""
    student = db.query(User).filter(User.id == student_id).first()
    if not student:
        raise HTTPException(status_code=404, detail="Student not found")

    progress = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == template_id,
        StudentInterviewProgress.user_id == student_id
    ).first()

    progress_status = progress.status if progress else "locked"
    current_stage = progress.current_stage if progress else "hr"

    # Fetch all attempts with their stages
    attempts = db.query(InterviewAttempt).options(
        joinedload(InterviewAttempt.stages).joinedload(InterviewStage.submissions)
    ).filter(
        InterviewAttempt.hiring_template_id == template_id,
        InterviewAttempt.user_id == student_id
    ).order_by(InterviewAttempt.created_at.desc()).all()

    # Format response
    attempts_response = []
    template_title = db.query(HiringTemplate.job_title).filter(HiringTemplate.id == template_id).scalar() or "Unknown Job"
    
    for a in attempts:
        stages_res = []
        for s in a.stages:
            subs_res = []
            for sub in s.submissions:
                subs_res.append(
                    CodingSubmissionResponse(
                        id=sub.id,
                        stage_id=sub.stage_id,
                        language=sub.language,
                        code=sub.code,
                        status=sub.status,
                        created_at=sub.created_at
                    )
                )
            stages_res.append(
                InterviewStageResponse(
                    id=s.id,
                    attempt_id=s.attempt_id,
                    stage_type=s.stage_type,
                    status=s.status,
                    score=s.score,
                    feedback=s.feedback,
                    created_at=s.created_at,
                    submissions=subs_res
                )
            )
        
        # Sort stages: hr, coding, problem_solving
        stage_map = {"hr": 0, "coding": 1, "problem_solving": 2}
        stages_res.sort(key=lambda x: stage_map.get(x.stage_type, 3))

        attempts_response.append(
            InterviewAttemptResponse(
                id=a.id,
                user_id=a.user_id,
                hiring_template_id=a.hiring_template_id,
                cv_url=a.cv_url,
                cv_name=a.cv_name,
                job_description=a.job_description,
                status=a.status,
                current_stage=a.current_stage,
                created_at=a.created_at,
                stages=stages_res,
                job_title=template_title,
                student_name=student.name
            )
        )

    return StudentHiringDetailResponse(
        student_id=student.id,
        student_name=student.name,
        student_email=student.email,
        progress_status=progress_status,
        current_stage=current_stage,
        attempts=attempts_response
    )


# ─── STUDENT: MY STATE & HISTORIES ───

@router.get("/templates/{template_id}/student-state")
def get_my_hiring_state(
    template_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    """Get the current student's progress and attempt history for a specific job template."""
    progress = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == template_id,
        StudentInterviewProgress.user_id == current_user.id
    ).first()

    attempts = db.query(InterviewAttempt).options(
        joinedload(InterviewAttempt.stages).joinedload(InterviewStage.submissions)
    ).filter(
        InterviewAttempt.hiring_template_id == template_id,
        InterviewAttempt.user_id == current_user.id
    ).order_by(InterviewAttempt.created_at.desc()).all()

    # Format progress
    progress_data = None
    if progress:
        progress_data = {
            "id": progress.id,
            "user_id": progress.user_id,
            "hiring_template_id": progress.hiring_template_id,
            "current_stage": progress.current_stage,
            "status": progress.status,
            "updated_at": progress.updated_at
        }

    # Format attempts
    attempts_response = []
    template_title = db.query(HiringTemplate.job_title).filter(HiringTemplate.id == template_id).scalar() or "Unknown Job"
    
    for a in attempts:
        stages_res = []
        for s in a.stages:
            subs_res = []
            for sub in s.submissions:
                subs_res.append(
                    CodingSubmissionResponse(
                        id=sub.id,
                        stage_id=sub.stage_id,
                        language=sub.language,
                        code=sub.code,
                        status=sub.status,
                        created_at=sub.created_at
                    )
                )
            stages_res.append(
                InterviewStageResponse(
                    id=s.id,
                    attempt_id=s.attempt_id,
                    stage_type=s.stage_type,
                    status=s.status,
                    score=s.score,
                    feedback=s.feedback,
                    created_at=s.created_at,
                    submissions=subs_res
                )
            )
        
        # Sort stages: hr, coding, problem_solving
        stage_map = {"hr": 0, "coding": 1, "problem_solving": 2}
        stages_res.sort(key=lambda x: stage_map.get(x.stage_type, 3))

        attempts_response.append(
            InterviewAttemptResponse(
                id=a.id,
                user_id=a.user_id,
                hiring_template_id=a.hiring_template_id,
                cv_url=a.cv_url,
                cv_name=a.cv_name,
                job_description=a.job_description,
                status=a.status,
                current_stage=a.current_stage,
                created_at=a.created_at,
                stages=stages_res,
                job_title=template_title,
                student_name=current_user.name
            )
        )

    return {
        "progress": progress_data,
        "attempts": attempts_response
    }


# ─── STUDENT: START ATTEMPT ───

@router.post("/attempts", response_model=InterviewAttemptResponse, status_code=201)
def create_attempt(
    hiring_template_id: str = Form(...),
    job_description: str = Form(...),
    cv_file: Optional[UploadFile] = File(None),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    """
    Start a new hiring interview attempt for a template.
    Creates the attempt record, uploads CV, and initializes the 3 sequential stages (HR unlocked, others locked).
    """
    template = db.query(HiringTemplate).filter(HiringTemplate.id == hiring_template_id).first()
    if not template:
        raise HTTPException(status_code=404, detail="Hiring template not found")

    cv_url = None
    cv_name = None
    if cv_file and cv_file.filename:
        cv_url = upload_cv(cv_file)
        cv_name = cv_file.filename

    # Create the attempt
    attempt = InterviewAttempt(
        user_id=current_user.id,
        hiring_template_id=hiring_template_id,
        cv_url=cv_url,
        cv_name=cv_name,
        job_description=job_description.strip(),
        status="in_progress",
        current_stage="hr"
    )
    db.add(attempt)
    db.commit()  # commit to generate attempt ID

    # Initialize the 3 stages: HR is first, so it is "in_progress". The others are locked.
    hr_stage = InterviewStage(attempt_id=attempt.id, stage_type="hr", status="in_progress")
    coding_stage = InterviewStage(attempt_id=attempt.id, stage_type="coding", status="locked")
    ps_stage = InterviewStage(attempt_id=attempt.id, stage_type="problem_solving", status="locked")
    
    db.add(hr_stage)
    db.add(coding_stage)
    db.add(ps_stage)

    # Initialize or update StudentInterviewProgress
    progress = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == hiring_template_id,
        StudentInterviewProgress.user_id == current_user.id
    ).first()

    if not progress:
        progress = StudentInterviewProgress(
            user_id=current_user.id,
            hiring_template_id=hiring_template_id,
            current_stage="hr",
            status="in_progress"
        )
        db.add(progress)
    else:
        progress.current_stage = "hr"
        progress.status = "in_progress"

    db.commit()
    db.refresh(attempt)

    # Return full attempt
    stages_res = [
        InterviewStageResponse(
            id=hr_stage.id, attempt_id=attempt.id, stage_type="hr", status="in_progress", created_at=hr_stage.created_at, submissions=[]
        ),
        InterviewStageResponse(
            id=coding_stage.id, attempt_id=attempt.id, stage_type="coding", status="locked", created_at=coding_stage.created_at, submissions=[]
        ),
        InterviewStageResponse(
            id=ps_stage.id, attempt_id=attempt.id, stage_type="problem_solving", status="locked", created_at=ps_stage.created_at, submissions=[]
        )
    ]

    return InterviewAttemptResponse(
        id=attempt.id,
        user_id=attempt.user_id,
        hiring_template_id=attempt.hiring_template_id,
        cv_url=attempt.cv_url,
        cv_name=attempt.cv_name,
        job_description=attempt.job_description,
        status=attempt.status,
        current_stage=attempt.current_stage,
        created_at=attempt.created_at,
        stages=stages_res,
        job_title=template.job_title,
        student_name=current_user.name
    )


@router.get("/attempts/{attempt_id}", response_model=InterviewAttemptResponse)
def get_attempt(
    attempt_id: str,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """Retrieve details of a specific interview attempt."""
    attempt = db.query(InterviewAttempt).options(
        joinedload(InterviewAttempt.stages).joinedload(InterviewStage.submissions)
    ).filter(InterviewAttempt.id == attempt_id).first()
    
    if not attempt:
        raise HTTPException(status_code=404, detail="Interview attempt not found")

    template_title = db.query(HiringTemplate.job_title).filter(HiringTemplate.id == attempt.hiring_template_id).scalar() or "Unknown Job"
    student_name = db.query(User.name).filter(User.id == attempt.user_id).scalar() or "Unknown Student"

    stages_res = []
    for s in attempt.stages:
        subs_res = []
        for sub in s.submissions:
            subs_res.append(
                CodingSubmissionResponse(
                    id=sub.id,
                    stage_id=sub.stage_id,
                    language=sub.language,
                    code=sub.code,
                    status=sub.status,
                    created_at=sub.created_at
                )
            )
        stages_res.append(
            InterviewStageResponse(
                id=s.id,
                attempt_id=s.attempt_id,
                stage_type=s.stage_type,
                status=s.status,
                score=s.score,
                feedback=s.feedback,
                created_at=s.created_at,
                submissions=subs_res
            )
        )

    # Sort stages: hr, coding, problem_solving
    stage_map = {"hr": 0, "coding": 1, "problem_solving": 2}
    stages_res.sort(key=lambda x: stage_map.get(x.stage_type, 3))

    return InterviewAttemptResponse(
        id=attempt.id,
        user_id=attempt.user_id,
        hiring_template_id=attempt.hiring_template_id,
        cv_url=attempt.cv_url,
        cv_name=attempt.cv_name,
        job_description=attempt.job_description,
        status=attempt.status,
        current_stage=attempt.current_stage,
        created_at=attempt.created_at,
        stages=stages_res,
        job_title=template_title,
        student_name=student_name
    )


# ─── STUDENT: CODING SUBMISSIONS ───

@router.post("/stages/{stage_id}/submit-coding", response_model=CodingSubmissionResponse)
def submit_coding(
    stage_id: str,
    data: CodingSubmissionCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_student)
):
    """Submit code for the Coding Test stage."""
    stage = db.query(InterviewStage).filter(InterviewStage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=404, detail="Interview stage not found")

    attempt = db.query(InterviewAttempt).filter(InterviewAttempt.id == stage.attempt_id).first()
    if not attempt or attempt.user_id != current_user.id:
        raise HTTPException(status_code=403, detail="Not authorized to submit code for this stage")

    if stage.stage_type != "coding":
        raise HTTPException(status_code=400, detail="Coding submissions are only allowed for coding stages")

    if stage.status == "locked":
        raise HTTPException(status_code=400, detail="This coding stage is locked. Please complete the previous stage first.")

    # Save the submission
    submission = CodingSubmission(
        stage_id=stage_id,
        language=data.language,
        code=data.code,
        status="compiled"
    )
    db.add(submission)
    db.commit()
    db.refresh(submission)

    return CodingSubmissionResponse(
        id=submission.id,
        stage_id=submission.stage_id,
        language=submission.language,
        code=submission.code,
        status=submission.status,
        created_at=submission.created_at
    )


# Unused class removed


from pydantic import BaseModel

class StageCompletionPayload(BaseModel):
    passed: bool
    score: float
    feedback: Optional[str] = None


@router.post("/stages/{stage_id}/complete")
def complete_stage(
    stage_id: str,
    payload: StageCompletionPayload,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user)
):
    """
    Simulates completing a stage. Changes the status, updates stage info,
    and unlocks the next stage in sequence if passed, maintaining the locked progression flow.
    """
    stage = db.query(InterviewStage).filter(InterviewStage.id == stage_id).first()
    if not stage:
        raise HTTPException(status_code=404, detail="Interview stage not found")

    attempt = db.query(InterviewAttempt).filter(InterviewAttempt.id == stage.attempt_id).first()
    if not attempt:
        raise HTTPException(status_code=404, detail="Attempt not found")

    # Authorize: either the student who owns the attempt, or a teacher/admin
    if current_user.id != attempt.user_id and current_user.role not in [UserRole.TEACHER, UserRole.ADMIN]:
        raise HTTPException(status_code=403, detail="Not authorized to complete this stage")

    if stage.status == "locked":
        raise HTTPException(status_code=400, detail="Cannot complete a locked stage")

    stage.status = "passed" if payload.passed else "failed"
    stage.score = payload.score
    stage.feedback = payload.feedback or ""
    stage.updated_at = datetime.utcnow()

    # Progress/locking logic:
    progress = db.query(StudentInterviewProgress).filter(
        StudentInterviewProgress.hiring_template_id == attempt.hiring_template_id,
        StudentInterviewProgress.user_id == attempt.user_id
    ).first()

    if not progress:
        # Should always exist if attempt was created, but let's be safe
        progress = StudentInterviewProgress(
            user_id=attempt.user_id,
            hiring_template_id=attempt.hiring_template_id,
            current_stage="hr",
            status="in_progress"
        )
        db.add(progress)

    if payload.passed:
        if stage.stage_type == "hr":
            # Unlock coding
            coding_stage = db.query(InterviewStage).filter(
                InterviewStage.attempt_id == attempt.id,
                InterviewStage.stage_type == "coding"
            ).first()
            if coding_stage:
                coding_stage.status = "in_progress"
            
            attempt.current_stage = "coding"
            progress.current_stage = "coding"
            progress.status = "in_progress"

        elif stage.stage_type == "coding":
            # Unlock problem_solving
            ps_stage = db.query(InterviewStage).filter(
                InterviewStage.attempt_id == attempt.id,
                InterviewStage.stage_type == "problem_solving"
            ).first()
            if ps_stage:
                ps_stage.status = "in_progress"
            
            attempt.current_stage = "problem_solving"
            progress.current_stage = "problem_solving"
            progress.status = "in_progress"

        elif stage.stage_type == "problem_solving":
            # Entire attempt is passed
            attempt.current_stage = "completed"
            attempt.status = "passed"
            progress.current_stage = "completed"
            progress.status = "passed"
    else:
        # Stage failed, meaning the entire attempt fails
        attempt.status = "failed"
        progress.status = "failed"

    db.commit()
    return {
        "message": f"Stage {stage.stage_type} marked as {'passed' if payload.passed else 'failed'}",
        "stage_status": stage.status,
        "attempt_status": attempt.status,
        "current_stage": attempt.current_stage
    }
