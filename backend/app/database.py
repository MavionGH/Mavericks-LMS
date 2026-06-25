import os
from sqlalchemy import create_engine, text
from sqlalchemy.orm import declarative_base, sessionmaker
from sqlalchemy.pool import NullPool
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
# Fixes:
#   - prepare_threshold=None  -> psycopg never uses server-side prepared statements
#   - NullPool                -> don't keep/reuse pooled connections client-side
#     (the Supabase pooler does the pooling); avoids stale prepared statements.
engine = create_engine(
    DATABASE_URL,
    echo=False,                 # set True to log all SQL during debugging
    poolclass=NullPool,         # let the Supabase transaction pooler manage pooling
    pool_pre_ping=True,         # verify connections before using them
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
