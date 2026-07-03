import sys
import os
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from app.database import engine
from sqlalchemy import text

print("Connecting using app.database engine...")
try:
    with engine.connect() as conn:
        res = conn.execute(text("SELECT 1")).scalar()
        print("Success! SELECT 1 returned:", res)
except Exception as e:
    print("Database Connection Error:", e)
