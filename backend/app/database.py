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

# Use NullPool for Supabase transaction-mode pooler (port 6543)
# Use standard pool for session-mode pooler (port 5432) — default here
engine = create_engine(
    DATABASE_URL,
    echo=False,            # set True to log all SQL during debugging
    pool_pre_ping=True,    # verify connections before using them
    pool_size=5,
    max_overflow=10,
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
Base = declarative_base()


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()
