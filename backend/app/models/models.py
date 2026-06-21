from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Enum, JSON
)
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
import uuid

from app.database import Base


def generate_uuid():
    return str(uuid.uuid4())


class UserRole(str, enum.Enum):
    STUDENT = "student"
    TEACHER = "teacher"
    ADMIN = "admin"


class EnrollmentStatus(str, enum.Enum):
    IN_PROGRESS = "in_progress"
    CAPSTONE_READY = "capstone_ready"
    COMPLETED = "completed"


class EvaluationType(str, enum.Enum):
    CHAPTER = "chapter"
    CAPSTONE = "capstone"


# ─── USER ───
class User(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, default=generate_uuid)
    name = Column(String(100), nullable=False)
    email = Column(String(255), unique=True, nullable=False, index=True)
    password = Column(String(255), nullable=False)
    role = Column(Enum(UserRole), default=UserRole.STUDENT)
    avatar = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    enrollments = relationship("Enrollment", back_populates="user")
    evaluations = relationship("Evaluation", back_populates="user")
    certificates = relationship("Certificate", back_populates="user")
    quiz_attempts = relationship("QuizAttempt", back_populates="user")


# ─── COURSE ───
class Course(Base):
    __tablename__ = "courses"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String(255), nullable=False)
    description = Column(Text, nullable=False)
    thumbnail = Column(String(500), nullable=True)
    pass_threshold = Column(Integer, default=70)
    is_published = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    chapters = relationship("Chapter", back_populates="course", order_by="Chapter.order_index")
    enrollments = relationship("Enrollment", back_populates="course")
    certificates = relationship("Certificate", back_populates="course")


# ─── CHAPTER ───
class Chapter(Base):
    __tablename__ = "chapters"

    id = Column(String, primary_key=True, default=generate_uuid)
    title = Column(String(255), nullable=False)
    order_index = Column(Integer, nullable=False)
    article_content = Column(Text, nullable=False)
    youtube_url = Column(String(500), nullable=False)
    video_transcript = Column(Text, nullable=True)
    course_id = Column(String, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False)

    course = relationship("Course", back_populates="chapters")
    evaluations = relationship("Evaluation", back_populates="chapter")
    quiz_attempts = relationship("QuizAttempt", back_populates="chapter")


# ─── ENROLLMENT ───
class Enrollment(Base):
    __tablename__ = "enrollments"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    current_chapter_index = Column(Integer, default=0)
    video_watched = Column(Boolean, default=False)
    article_read = Column(Boolean, default=False)
    status = Column(Enum(EnrollmentStatus), default=EnrollmentStatus.IN_PROGRESS)
    enrolled_at = Column(DateTime, default=datetime.utcnow)
    completed_at = Column(DateTime, nullable=True)

    user = relationship("User", back_populates="enrollments")
    course = relationship("Course", back_populates="enrollments")


# ─── QUIZ ATTEMPT ───
class QuizAttempt(Base):
    __tablename__ = "quiz_attempts"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=False)
    questions = Column(JSON, nullable=False)
    score = Column(Integer, nullable=False)
    passed = Column(Boolean, nullable=False)
    attempted_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="quiz_attempts")
    chapter = relationship("Chapter", back_populates="quiz_attempts")


# ─── INTERVIEW SESSION (active call state) ───
class InterviewSession(Base):
    __tablename__ = "interview_sessions"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=False)
    status = Column(String, default="active")  # active | completed
    transcript = Column(JSON, default=list)
    pause_metrics = Column(JSON, default=list)
    question_count = Column(Integer, default=0)
    graph_state = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    chapter = relationship("Chapter")


# ─── EVALUATION (AI Interview) ───
class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)
    type = Column(Enum(EvaluationType), nullable=False)
    transcript = Column(JSON, nullable=True)
    technical_score = Column(Float, default=0)
    communication_score = Column(Float, default=0)
    confidence_score = Column(Float, default=0)
    overall_score = Column(Float, default=0)
    passed = Column(Boolean, default=False)
    strengths = Column(JSON, default=list)
    weak_areas = Column(JSON, default=list)
    suggested_review = Column(JSON, default=list)
    attempt_number = Column(Integer, default=1)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User", back_populates="evaluations")
    chapter = relationship("Chapter", back_populates="evaluations")


# ─── CERTIFICATE ───
class Certificate(Base):
    __tablename__ = "certificates"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    course_id = Column(String, ForeignKey("courses.id"), nullable=False)
    issue_date = Column(DateTime, default=datetime.utcnow)
    verify_code = Column(String, unique=True, default=generate_uuid)

    user = relationship("User", back_populates="certificates")
    course = relationship("Course", back_populates="certificates")
