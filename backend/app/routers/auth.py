from fastapi import APIRouter, Depends, HTTPException, status

from sqlalchemy.orm import Session
import bcrypt
from jose import jwt
from datetime import datetime, timedelta
from typing import Optional

from app.database import get_db
from app.models.models import User, UserRole
from app.schemas.schemas import UserCreate, UserLogin, UserResponse, TokenResponse
from app.auth.dependencies import SECRET_KEY, ALGORITHM, TOKEN_EXPIRE_HOURS, get_current_user

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_token(user_id: str, role: str) -> str:
    expire = datetime.utcnow() + timedelta(hours=TOKEN_EXPIRE_HOURS)
    return jwt.encode(
        {"sub": user_id, "role": role, "exp": expire},
        SECRET_KEY,
        algorithm=ALGORITHM,
    )


@router.post("/register", response_model=TokenResponse, status_code=201)
def register(data: UserCreate, db: Session = Depends(get_db)):
    """
    Register a new user. The `role` field accepts: student | teacher.
    Admin accounts can only be created via the backend seed script.
    """
    requested_role = (data.role or "student").lower()
    if requested_role == "admin":
        raise HTTPException(
            status_code=403,
            detail="Admin accounts cannot be created via registration. Contact a system administrator.",
        )

    existing = db.query(User).filter(User.email == data.email).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    role_map = {
        "student": UserRole.STUDENT,
        "teacher": UserRole.TEACHER,
    }
    role = role_map.get(requested_role, UserRole.STUDENT)

    # Teachers start unapproved — an admin must activate their account before
    # they can access the teacher panel or publish courses.
    is_approved = role != UserRole.TEACHER

    user = User(
        name=data.name,
        email=data.email,
        password=hash_password(data.password),
        role=role,
        is_approved=is_approved,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_token(user.id, user.role.value)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.post("/login", response_model=TokenResponse)
def login(data: UserLogin, db: Session = Depends(get_db)):
    user = db.query(User).filter(User.email == data.email).first()
    if not user or not verify_password(data.password, user.password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid email or password",
        )

    token = create_token(user.id, user.role.value)
    return TokenResponse(
        access_token=token,
        user=UserResponse.model_validate(user),
    )


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    """Return the authenticated user's profile from the JWT."""
    return UserResponse.model_validate(current_user)
