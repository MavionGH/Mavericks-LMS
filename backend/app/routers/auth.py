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


# ─── GOOGLE OAUTH ───
import os
from pydantic import BaseModel
from google.oauth2 import id_token
from google.auth.transport import requests as google_requests
from fastapi.responses import JSONResponse

class GoogleTokenInput(BaseModel):
    credential_token: str
    role: Optional[str] = None  # student | teacher

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

@router.post("/google")
def google_auth(data: GoogleTokenInput, db: Session = Depends(get_db)):
    """
    Verify Google ID token, authenticate/register the user.
    If the user does not exist and no role is provided, returns a 200 response with status="needs_role"
    to prompt the user to choose their role.
    """
    if not GOOGLE_CLIENT_ID:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="GOOGLE_CLIENT_ID is not configured on the server."
        )

    try:
        # 1. Verify token with Google's public certificates
        id_info = id_token.verify_oauth2_token(
            data.credential_token,
            google_requests.Request(),
            GOOGLE_CLIENT_ID
        )
        
        # 2. Extract verified claims
        google_user_id = id_info["sub"]
        email = id_info["email"]
        name = id_info.get("name", "Google User")
        picture = id_info.get("picture") # Avatar URL
        
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid Google Token: {str(e)}"
        )

    # 3. Check if user already exists
    user = db.query(User).filter(User.email == email).first()
    
    if not user:
        # 4. If user does not exist, they must choose a role first
        if not data.role:
            return JSONResponse(
                status_code=status.HTTP_200_OK,
                content={
                    "status": "needs_role",
                    "email": email,
                    "name": name,
                }
            )
        
        # Validate selected role
        requested_role = data.role.lower()
        if requested_role not in ["student", "teacher"]:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid role selected. Must be 'student' or 'teacher'."
            )
            
        role_map = {
            "student": UserRole.STUDENT,
            "teacher": UserRole.TEACHER,
        }
        user_role = role_map[requested_role]
        
        # Teachers start unapproved unless configured otherwise, but let's match register logic:
        is_approved = user_role != UserRole.TEACHER

        # Create new user
        user = User(
            name=name,
            email=email,
            password=None,  # No password for OAuth users
            role=user_role,
            is_approved=is_approved,
            avatar=picture,
            google_id=google_user_id
        )
        db.add(user)
        db.commit()
        db.refresh(user)
    else:
        # 5. Link google_id or update avatar if not already present
        updated = False
        if not user.google_id:
            user.google_id = google_user_id
            updated = True
        if picture and not user.avatar:
            user.avatar = picture
            updated = True
        if updated:
            db.commit()
            db.refresh(user)

    # 6. Generate our app's native JWT
    token = create_token(user.id, user.role.value)
    
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": UserResponse.model_validate(user),
    }
