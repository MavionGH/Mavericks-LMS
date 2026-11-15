"""
Run this once to create the admin account:
    python create_admin.py

Admin credentials:
    Email:    admin@maverik.com
    Password: Maverik@Admin2025
"""
import sys
import os

sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv
load_dotenv()

from app.database import SessionLocal, engine, Base
from app.models.models import User, UserRole
import bcrypt

ADMIN_EMAIL    = "admin@maverik.com"
ADMIN_PASSWORD = "Maverik@Admin2025"
ADMIN_NAME     = "Maverik Admin"


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def main():
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        existing = db.query(User).filter(User.email == ADMIN_EMAIL).first()
        if existing:
            if existing.role == UserRole.ADMIN:
                print(f"Admin already exists: {ADMIN_EMAIL}")
            else:
                existing.role = UserRole.ADMIN
                db.commit()
                print(f"Promoted existing user to admin: {ADMIN_EMAIL}")
            return

        admin = User(
            name=ADMIN_NAME,
            email=ADMIN_EMAIL,
            password=hash_password(ADMIN_PASSWORD),
            role=UserRole.ADMIN,
        )
        db.add(admin)
        db.commit()
        print("Admin account created successfully.")
        print(f"  Email:    {ADMIN_EMAIL}")
        print(f"  Password: {ADMIN_PASSWORD}")
    finally:
        db.close()


if __name__ == "__main__":
    main()
