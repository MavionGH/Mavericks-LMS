import sys
import os

# Append current directory to path so we can import from app
sys.path.append(os.getcwd())

from app.database import SessionLocal
from app.models.models import Course, Chapter

def main():
    db = SessionLocal()
    try:
        # Search for course containing "Machine Learning"
        courses = db.query(Course).all()
        ml_courses = [c for c in courses if "machine learning" in c.title.lower()]
        
        if not ml_courses:
            print("No course containing 'machine learning' in the title was found.")
            print("Available courses:")
            for c in courses:
                print(f"- {c.title} (ID: {c.id})")
            return
            
        for course in ml_courses:
            print("=" * 60)
            print(f"COURSE: {course.title} (ID: {course.id})")
            print(f"Description: {course.description[:100]}...")
            print("=" * 60)
            
            total_article_chars = 0
            total_transcript_chars = 0
            total_chapter_title_chars = 0
            
            chapters = db.query(Chapter).filter(Chapter.course_id == course.id).order_by(Chapter.order_index).all()
            print(f"Total Modules/Chapters: {len(chapters)}")
            print("-" * 60)
            
            for i, ch in enumerate(chapters, 1):
                art_len = len(ch.article_content or "")
                trans_len = len(ch.video_transcript or "")
                title_len = len(ch.title or "")
                
                total_article_chars += art_len
                total_transcript_chars += trans_len
                total_chapter_title_chars += title_len
                
                print(f"Module {i}: {ch.title}")
                print(f"  - Article length: {art_len} characters")
                print(f"  - Video transcript length: {trans_len} characters")
            
            print("-" * 60)
            print(f"Summary for Course: {course.title}")
            print(f"  - Total Chapter Title Characters: {total_chapter_title_chars}")
            print(f"  - Total Article Characters:       {total_article_chars}")
            print(f"  - Total Transcript Characters:    {total_transcript_chars}")
            
            grand_total = total_chapter_title_chars + total_article_chars + total_transcript_chars
            print(f"  - GRAND TOTAL CHARACTERS:         {grand_total}")
            print("=" * 60)
            print()
            
    finally:
        db.close()

if __name__ == "__main__":
    main()
