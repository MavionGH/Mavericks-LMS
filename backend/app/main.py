import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import auth, courses, enrollment, admin, interview, quiz, teacher, student

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
    #
    # Re-running `ADD COLUMN IF NOT EXISTS` on every boot is normally cheap, but on
    # Supabase's transaction pooler the ALTER still has to take a table lock to
    # check — and if any other session holds a lock (the frontend querying, or a
    # second backend instance), it blocks and then waits out the server-side
    # `statement_timeout`, making startup appear to hang for tens of seconds PER
    # statement. To make startup fast and safe we:
    #   (a) introspect information_schema first and only ALTER when a column is
    #       actually missing, so a fully-migrated DB does zero locking work, and
    #   (b) cap lock waits (SET LOCAL lock_timeout) so a migration that does run
    #       can never hang — it fails fast and is logged.
    add_columns = [
        ("courses", "teacher_id", "ALTER TABLE courses ADD COLUMN teacher_id VARCHAR REFERENCES users(id) ON DELETE SET NULL"),
        ("courses", "is_approved", "ALTER TABLE courses ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT FALSE"),
        ("users", "is_approved", "ALTER TABLE users ADD COLUMN is_approved BOOLEAN NOT NULL DEFAULT TRUE"),
        ("users", "google_id", "ALTER TABLE users ADD COLUMN google_id VARCHAR(255)"),
        # Course-wide final interview: sessions may be scoped to a course instead
        # of a single chapter, so course_id is added (and chapter_id made nullable below).
        ("interview_sessions", "course_id", "ALTER TABLE interview_sessions ADD COLUMN course_id VARCHAR REFERENCES courses(id)"),
        # Full screen+audio recording of the interview (Cloudflare R2 public URL).
        ("interview_sessions", "recording_url", "ALTER TABLE interview_sessions ADD COLUMN recording_url VARCHAR(500)"),
        ("evaluations", "course_id", "ALTER TABLE evaluations ADD COLUMN course_id VARCHAR REFERENCES courses(id) ON DELETE CASCADE"),
    ]

    # Snapshot existing columns (+ nullability) up front in one cheap read so the
    # loop below never touches a table that's already migrated.
    cols_by_table = {}
    try:
        with engine.connect() as conn:
            for table in {"courses", "users", "interview_sessions", "evaluations"}:
                rows = conn.execute(text(
                    "SELECT column_name, is_nullable FROM information_schema.columns "
                    "WHERE table_name = :t"
                ), {"t": table}).fetchall()
                cols_by_table[table] = {r[0]: r[1] for r in rows}
    except Exception as exc:
        logger.warning("Could not introspect schema (will still attempt migrations): %s", exc)

    def _run_migration(stmt):
        """Run one DDL statement in its own transaction with a short lock timeout
        so a contended table can never stall startup."""
        try:
            with engine.begin() as conn:
                conn.execute(text("SET LOCAL lock_timeout = '3s'"))
                conn.execute(text(stmt))
        except Exception as exc:
            logger.warning("Column migration warning for [%s]: %s", stmt, exc)

    for table, column, ddl in add_columns:
        # If introspection failed we have no snapshot for the table → fall back to
        # attempting the ALTER (guarded by lock_timeout so it still can't hang).
        existing = cols_by_table.get(table)
        if existing is None or column not in existing:
            _run_migration(ddl)

    # Make these columns nullable only if they are still NOT NULL (skips the lock
    # entirely once already applied).
    if cols_by_table.get("interview_sessions", {}).get("chapter_id") == "NO":
        _run_migration("ALTER TABLE interview_sessions ALTER COLUMN chapter_id DROP NOT NULL")
    if cols_by_table.get("users", {}).get("password") == "NO":
        _run_migration("ALTER TABLE users ALTER COLUMN password DROP NOT NULL")

    logger.info("Schema columns ensured.")

    # ── Embeddings now run on OpenAI (text-embedding-3-small) ──
    # Embeddings are produced by a hosted OpenAI API call, so there's no local
    # model to download or warm — the first interview no longer pays a cold-load
    # penalty. We just log whether the key is configured so misconfiguration is
    # obvious in the startup logs. RAG degrades gracefully to raw course text if
    # the key is missing.
    try:
        from app.services.embeddings import embeddings_available
        if embeddings_available():
            logger.info("OpenAI embeddings configured and ready for RAG/interviews.")
        else:
            logger.warning("OPENAI_API_KEY not set — RAG will fall back to raw course text.")
    except Exception as exc:  # pragma: no cover - best-effort check
        logger.warning("Embedding availability check skipped: %s", exc)

    # ── LLM + LangGraph warm-up ──────────────────────────────────────────────
    # The first call to get_llm() imports LangChain and builds an HTTP connection
    # pool — this alone costs 10–60 s on a cold process. Pre-initialising here
    # means the pool is ready before any student hits /api/interview/start, so
    # the first interview starts in 3–8 s (normal OpenAI latency) instead of
    # 30–120 s. Likewise, pre-compiling the LangGraph state machines avoids
    # graph-compilation overhead on the first request.
    try:
        from app.services.llm import get_llm, get_grading_llm
        from app.services.interview_graph import _get_start_graph, _get_answer_graph
        get_llm()           # initialises ChatOpenAI + connection pool
        get_grading_llm()   # initialises grading model client
        _get_start_graph()  # compiles GreetingNode → FirstQuestion graph
        _get_answer_graph() # compiles record_answer → follow_up/score graph
        logger.info("LLM clients and LangGraph graphs warmed up — interview startup will be fast.")
    except Exception as exc:
        logger.warning("LLM warm-up skipped (will cold-start on first interview): %s", exc)

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
app.include_router(teacher.router)
app.include_router(student.router)


@app.get("/")
def root():
    return {"message": "Maverik Learning API is running", "version": "1.0.0"}


@app.get("/api/health")
def health():
    from app.services.openai_config import has_openai
    llm = "openai" if has_openai() else "fallback"
    return {"status": "healthy", "llm_provider": llm}
