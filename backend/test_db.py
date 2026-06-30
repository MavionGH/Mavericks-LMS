import sys, os
sys.path.append(os.getcwd())
from app.database import SessionLocal
from app.models.models import Evaluation, InterviewSession
db = SessionLocal()
evals = db.query(Evaluation).all()
print(f'Total evals: {len(evals)}')
for e in evals:
    print(f'Eval ID: {e.id}, User ID: {e.user_id}, Course ID: {getattr(e, "course_id", None)}, Chapter ID: {e.chapter_id}, Type: {e.type}')
