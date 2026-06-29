from sqlalchemy import (
    Column, String, Integer, Float, Boolean, Text, DateTime, ForeignKey, Enum, JSON
)
from sqlalchemy.orm import relationship
from datetime import datetime
import enum
import uuid

try:
    from pgvector.sqlalchemy import Vector
    from app.services.openai_config import EMBED_DIM
    _embedding_type = Vector(EMBED_DIM)
except ImportError:
    from sqlalchemy import Text as _TextFallback
    _embedding_type = _TextFallback()

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
    password = Column(String(255), nullable=True)  # Nullable for OAuth users
    role = Column(Enum(UserRole), default=UserRole.STUDENT)
    is_approved = Column(Boolean, default=True)
    avatar = Column(String(500), nullable=True)
    google_id = Column(String(255), unique=True, nullable=True)
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
    # teacher_id: owner of the course (nullable for backward-compat with existing rows)
    teacher_id = Column(String, ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    # is_published: teacher has submitted the course for review (their intent flag)
    is_published = Column(Boolean, default=False)
    # is_approved: admin has approved — course only appears to students when both are True
    is_approved = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    teacher = relationship("User", foreign_keys=[teacher_id])
    chapters = relationship("Chapter", back_populates="course", order_by="Chapter.order_index")
    enrollments = relationship("Enrollment", back_populates="course")
    certificates = relationship("Certificate", back_populates="course")
    chunk_embeddings = relationship("ChunkEmbedding", back_populates="course", cascade="all, delete-orphan")

    @property
    def student_count(self) -> int:
        return len(self.enrollments)

    @property
    def pass_rate(self) -> float:
        total = len(self.enrollments)
        if total == 0:
            return 0.0
        completed = sum(1 for e in self.enrollments if e.status == EnrollmentStatus.COMPLETED)
        return round((completed / total) * 100, 1)


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
    quiz_question = relationship("QuizQuestion", back_populates="chapter", uselist=False)
    chunk_embeddings = relationship("ChunkEmbedding", back_populates="chapter", cascade="all, delete-orphan")

    @property
    def has_transcript(self) -> bool:
        return self.video_transcript is not None and len(self.video_transcript.strip()) > 0



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


# ─── QUIZ QUESTIONS (cached per chapter, generated by LLM) ───
class QuizQuestion(Base):
    __tablename__ = "quiz_questions"

    id = Column(String, primary_key=True, default=generate_uuid)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), unique=True, nullable=False)
    questions = Column(JSON, nullable=False)  # [{id, question, options:{A,B,C,D}, correct}, ...]
    created_at = Column(DateTime, default=datetime.utcnow)

    chapter = relationship("Chapter", back_populates="quiz_question")


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
    # chapter_id is set for a per-module interview; course_id is set for the
    # course-wide final interview (which spans every module). Exactly one is used.
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)
    course_id = Column(String, ForeignKey("courses.id"), nullable=True)
    status = Column(String, default="active")  # active | completed
    transcript = Column(JSON, default=list)
    pause_metrics = Column(JSON, default=list)
    question_count = Column(Integer, default=0)
    graph_state = Column(JSON, nullable=True)
    # Public R2 URL of the full screen+audio recording of the interview, uploaded
    # by the browser when the session ends. Null until the upload completes.
    recording_url = Column(String(500), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    user = relationship("User")
    chapter = relationship("Chapter")
    course = relationship("Course")


# ─── EVALUATION (AI Interview) ───
class Evaluation(Base):
    __tablename__ = "evaluations"

    id = Column(String, primary_key=True, default=generate_uuid)
    user_id = Column(String, ForeignKey("users.id"), nullable=False)
    chapter_id = Column(String, ForeignKey("chapters.id"), nullable=True)
    course_id = Column(String, ForeignKey("courses.id"), nullable=True)
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
    course = relationship("Course")


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


# ─── CHUNK EMBEDDINGS (for RAG — denormalized course_id for cross-chapter queries) ───
class ChunkEmbedding(Base):
    __tablename__ = "chunk_embeddings"

    id = Column(String, primary_key=True, default=generate_uuid)
    chapter_id = Column(String, ForeignKey("chapters.id", ondelete="CASCADE"), nullable=False, index=True)
    course_id = Column(String, ForeignKey("courses.id", ondelete="CASCADE"), nullable=False, index=True)
    chunk_text = Column(Text, nullable=False)
    embedding = Column(_embedding_type, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    chapter = relationship("Chapter", back_populates="chunk_embeddings")
    course = relationship("Course", back_populates="chunk_embeddings")
