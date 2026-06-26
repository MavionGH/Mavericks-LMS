import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import auth, courses, enrollment, admin, interview, quiz

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Enable pgvector extension before creating tables (safe no-op if already enabled)
    from sqlalchemy import text
    try:
        with engine.connect() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
            conn.commit()
        logger.info("pgvector extension ready.")
    except Exception as exc:
        logger.warning(
            "Could not auto-enable pgvector extension: %s. "
            "Enable it manually in Supabase Dashboard → Database → Extensions → vector",
            exc,
        )

    Base.metadata.create_all(bind=engine)

    # Add new columns to existing tables without a full migration.
    # PostgreSQL `ADD COLUMN IF NOT EXISTS` is idempotent and safe to run every start.
    _new_cols = [
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS teacher_id VARCHAR REFERENCES users(id) ON DELETE SET NULL",
        "ALTER TABLE courses ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT FALSE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS is_approved BOOLEAN NOT NULL DEFAULT TRUE",
        "ALTER TABLE users ADD COLUMN IF NOT EXISTS google_id VARCHAR(255)",
        # Course-wide final interview: sessions may be scoped to a course instead
        # of a single chapter, so chapter_id becomes optional and course_id is added.
        "ALTER TABLE interview_sessions ADD COLUMN IF NOT EXISTS course_id VARCHAR REFERENCES courses(id)",
        "ALTER TABLE interview_sessions ALTER COLUMN chapter_id DROP NOT NULL",
    ]
    # Run each statement in its OWN transaction. PostgreSQL aborts the whole
    # transaction on the first failing statement, so sharing one transaction
    # meant a single hiccup silently skipped every later migration (this is why
    # interview_sessions.course_id was never added). Isolating them makes each
    # idempotent ALTER apply independently.
    for stmt in _new_cols:
        try:
            with engine.begin() as conn:
                conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("Column migration warning for [%s]: %s", stmt, exc)
    logger.info("Schema columns ensured.")

    # Attempt to make password column nullable (PostgreSQL). Will fail gracefully on SQLite.
    try:
        with engine.connect() as conn:
            conn.execute(text("ALTER TABLE users ALTER COLUMN password DROP NOT NULL"))
            conn.commit()
            logger.info("Ensured password column is nullable.")
    except Exception as exc:
        logger.debug("Non-critical password nullability migration skipped: %s", exc)

    yield


app = FastAPI(
    title="Maverik Learning API",
    description="AI-Powered Learning Management System",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    # Let the browser cache the CORS preflight so it doesn't send an OPTIONS
    # request before every POST/PUT (cuts the duplicate-looking OPTIONS traffic).
    max_age=3600,
)

# Register routers
app.include_router(auth.router)
app.include_router(courses.router)
app.include_router(enrollment.router)
app.include_router(admin.router)
app.include_router(interview.router)
app.include_router(quiz.router)


@app.get("/")
def root():
    return {"message": "Maverik Learning API is running", "version": "1.0.0"}


@app.get("/api/health")
def health():
    import os
    llm = "groq" if os.getenv("GROQ_API_KEY") else "openai" if os.getenv("OPENAI_API_KEY") else "fallback"
    return {"status": "healthy", "llm_provider": llm}
