# pyrefly: ignore [missing-import]
from pydantic import BaseModel, EmailStr
from typing import Optional, List
from datetime import datetime


# ─── AUTH ───
class UserCreate(BaseModel):
    name: str
    email: str
    password: str
    role: Optional[str] = "student"  # student | teacher | admin


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: str
    name: str
    email: str
    role: str
    is_approved: bool = True
    avatar: Optional[str] = None
    created_at: datetime

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


# ─── COURSE ───
class ChapterCreate(BaseModel):
    title: str
    order_index: int
    article_content: str
    youtube_url: str
    video_transcript: Optional[str] = None


class ChapterResponse(BaseModel):
    id: str
    title: str
    order_index: int
    article_content: str
    youtube_url: str
    video_transcript: Optional[str] = None
    course_id: str

    class Config:
        from_attributes = True


class ChapterDetailResponse(BaseModel):
    # Student-facing single-chapter view. Deliberately omits `video_transcript`
    # (which can be a very large block of text) because the learn UI only renders
    # the article + video URL. The transcript stays in the DB for quiz/interview
    # generation; it is just never shipped to the browser here.
    id: str
    title: str
    order_index: int
    article_content: str
    youtube_url: str
    course_id: str

    class Config:
        from_attributes = True


class ChapterMinResponse(BaseModel):
    id: str
    title: str
    order_index: int
    youtube_url: str
    course_id: str
    has_transcript: bool = False

    class Config:
        from_attributes = True


class CourseCreate(BaseModel):
    title: str
    description: str
    thumbnail: Optional[str] = None
    pass_threshold: int = 70


class CourseResponse(BaseModel):
    id: str
    title: str
    description: str
    thumbnail: Optional[str] = None
    pass_threshold: int
    teacher_id: Optional[str] = None
    is_published: bool
    is_approved: bool = False
    created_at: datetime
    chapters: List[ChapterMinResponse] = []
    student_count: Optional[int] = 0
    pass_rate: Optional[float] = 0.0

    class Config:
        from_attributes = True


class CourseListResponse(BaseModel):
    id: str
    title: str
    description: str
    thumbnail: Optional[str] = None
    is_published: bool
    chapter_count: int = 0

    class Config:
        from_attributes = True


# ─── ENROLLMENT ───
class EnrollRequest(BaseModel):
    course_id: str


class EnrollmentResponse(BaseModel):
    id: str
    course_id: str
    current_chapter_index: int
    video_watched: bool
    article_read: bool
    status: str
    enrolled_at: datetime

    class Config:
        from_attributes = True


# ─── QUIZ ───
class QuizSubmit(BaseModel):
    chapter_id: str
    answers: dict  # {question_id: selected_answer}


class QuizAttemptResponse(BaseModel):
    id: str
    chapter_id: str
    score: int
    passed: bool
    questions: list
    attempted_at: datetime

    class Config:
        from_attributes = True


class QuizQuestionItem(BaseModel):
    id: int
    question: str
    options: dict  # {A: str, B: str, C: str, D: str}


class QuizQuestionsResponse(BaseModel):
    chapter_id: str
    questions: List[QuizQuestionItem]


class QuizSubmitRequest(BaseModel):
    chapter_id: str
    answers: dict  # {str(question_id): "A"|"B"|"C"|"D"}


class QuizResultItem(BaseModel):
    id: int
    correct: bool
    selected: str
    correct_answer: str


class QuizResultResponse(BaseModel):
    score: int
    passed: bool
    correct_count: int
    total: int
    threshold: int
    attempt_id: str
    results: List[QuizResultItem]
    # Progression: set when passing the quiz advances the student in the course.
    next_chapter_unlocked: bool = False
    course_completed: bool = False


class QuizStatusResponse(BaseModel):
    attempted: bool
    passed: bool
    score: Optional[int] = None


class QuizWarningLog(BaseModel):
    type: str       # "fullscreen" | "tab" | "clipboard"
    code: str       # "fullscreen-exit" | "tab-switch" | "clipboard-action"
    message: str
    timestamp: str  # ISO-8601 string sent from the client


# ─── INTERVIEW ───
class InterviewStartRequest(BaseModel):
    chapter_id: str


class CourseInterviewStartRequest(BaseModel):
    course_id: str


class InterviewAnswerRequest(BaseModel):
    session_id: str
    answer_text: str
    response_time_ms: int = 0
    pause_count: int = 0
    long_pause_ms: int = 0
    filler_word_count: int = 0


class InterviewMessage(BaseModel):
    speaker: str  # ai | student
    text: str
    timestamp: Optional[str] = None


class InterviewTurnResponse(BaseModel):
    session_id: str
    speaker: str
    text: str
    is_complete: bool = False
    waiting_for_student: bool = True
    question_number: int = 1
    total_questions: int = 5
    is_chitchat: bool = False        # True when response is conversational, not a new question
    greeting: Optional[str] = None  # One-time greeting text, returned only on session start
    greeting_completed: bool = False


class InterviewResultResponse(BaseModel):
    session_id: str
    passed: bool
    technical_score: float
    communication_score: float
    confidence_score: float
    overall_score: float
    strengths: list
    weak_areas: list
    suggested_review: list
    transcript: list
    next_chapter_unlocked: bool = False
    chapter_title: str = ""


class InterviewEligibilityResponse(BaseModel):
    eligible: bool
    reason: str = ""
    video_watched: bool = False
    article_read: bool = False
    enrollment_id: Optional[str] = None


# ─── EVALUATION ───
class EvaluationResponse(BaseModel):
    id: str
    chapter_id: Optional[str] = None
    type: str
    technical_score: float
    communication_score: float
    confidence_score: float
    overall_score: float
    passed: bool
    strengths: list
    weak_areas: list
    suggested_review: list
    attempt_number: int
    created_at: datetime

    class Config:
        from_attributes = True


# ─── CERTIFICATE ───
class CertificateResponse(BaseModel):
    id: str
    course_id: str
    issue_date: datetime
    verify_code: str

    class Config:
        from_attributes = True


# ─── ADMIN ANALYTICS ───
class AnalyticsResponse(BaseModel):
    total_students: int
    active_students: int
    total_courses: int
    published_courses: int
    total_enrollments: int
    completed_courses: int
    certificates_issued: int
    average_score: float
    pass_rate: float


# ─── STUDENT DASHBOARD ───
class DashboardCourse(BaseModel):
    id: str
    title: str
    progress: int
    currentChapter: str
    status: str
    icon: str


class DashboardEvaluation(BaseModel):
    chapter: str
    course: str
    score: int
    passed: bool
    date: str
    technical: int
    communication: int
    confidence: int


class DashboardStats(BaseModel):
    active_tracks: int
    modules_completed: int
    oral_assessments: int
    earned_credentials: int
    enrolled_courses: List[DashboardCourse]
    recent_evaluations: List[DashboardEvaluation]
