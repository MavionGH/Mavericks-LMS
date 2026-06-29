import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from dotenv import load_dotenv

# Load .env file
load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL")

if not DATABASE_URL:
    raise RuntimeError(
        "DATABASE_URL is not set. Add it to backend/.env\n"
        "Format: postgresql+psycopg2://postgres.PROJECT_REF:PASSWORD@HOST:PORT/postgres"
    )

# Supabase's pooler runs in transaction mode, so a physical backend connection
# is shared across clients. psycopg3 names its server-side prepared statements
# (_pg3_0, _pg3_1, ...) per session, which collide on a shared backend and raise
# "DuplicatePreparedStatement: prepared statement _pg3_0 already exists".
#
# The collision is fully prevented by `prepare_threshold=None`, which makes
# psycopg never create server-side prepared statements at all — so it is safe to
# keep a small client-side connection pool. Previously this used NullPool, which
# opened a brand-new TCP+TLS connection to Supabase on every single request; that
# handshake (plus pool_pre_ping's SELECT 1) dominated request latency across the
# app. Reusing pooled connections removes that per-request setup cost.
engine = create_engine(
    DATABASE_URL,
    echo=False,                 # set True to log all SQL during debugging
    pool_size=5,                # keep a few warm connections instead of reconnecting per request
    max_overflow=10,            # allow short bursts above pool_size
    pool_recycle=300,           # recycle connections after 5 min to avoid Supabase idle drops
    pool_pre_ping=True,         # verify a pooled connection is alive before using it
    connect_args={"prepare_threshold": None},  # disable psycopg3 prepared statements
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
