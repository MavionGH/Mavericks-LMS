import os
from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(override=True)
db_url = "postgresql+psycopg://postgres.jspkxmjnyenlkxhorzus:Clashofclan%4011@18.214.78.123:6543/postgres"
print("Connecting directly to IP 18.214.78.123...")
try:
    engine = create_engine(db_url)
    with engine.connect() as conn:
        res = conn.execute(text("SELECT 1")).scalar()
        print("Success! SELECT 1 returned:", res)
except Exception as e:
    print("Database Connection Error:", e)
