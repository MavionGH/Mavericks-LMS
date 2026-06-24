"""
Shared JWT authentication dependencies for FastAPI.

Token verification strategy (in priority order):
  1. Supabase-issued JWTs — validated against the Supabase JWKS endpoint
     using the EC P-256 public key. This covers all Google OAuth sessions and
     any future Supabase-Auth email/password sessions.
  2. Legacy FastAPI JWTs — validated with the local HS256 SECRET_KEY. This
     covers accounts that were created before the Supabase Auth migration and
     that have not yet signed in via Google to trigger account-linking.

This dual-verification approach ensures zero disruption for existing users.
"""

import os
import json
import logging
from functools import lru_cache

import httpx
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from jose import jwt, JWTError
from jose.backends import ECKey
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.models import User, UserRole

logger = logging.getLogger(__name__)

# ── Legacy FastAPI JWT config (kept for backward-compat) ─────────────────────
SECRET_KEY         = os.getenv("SECRET_KEY", "DEV-ONLY-maverik-change-me")
ALGORITHM          = os.getenv("ALGORITHM", "HS256")
TOKEN_EXPIRE_HOURS = int(os.getenv("TOKEN_EXPIRE_HOURS", "24"))

# ── Supabase JWKS config ──────────────────────────────────────────────────────
SUPABASE_URL       = os.getenv("SUPABASE_URL", "")
JWKS_URL           = os.getenv(
    "SUPABASE_JWKS_URL",
    f"{SUPABASE_URL}/auth/v1/.well-known/jwks.json" if SUPABASE_URL else "",
)
SUPABASE_JWT_ISSUER = f"{SUPABASE_URL}/auth/v1" if SUPABASE_URL else ""

bearer_scheme = HTTPBearer()


@lru_cache(maxsize=1)
def _fetch_supabase_jwks() -> dict:
    """
    Fetch and cache the Supabase JWKS (JSON Web Key Set).
    Cached for the lifetime of the process — Supabase keys rotate rarely.
    Use cache_clear() in tests if you need to reset.
    """
    if not JWKS_URL:
        logger.warning("SUPABASE_JWKS_URL not configured — Supabase JWT verification disabled.")
        return {}
    try:
        response = httpx.get(JWKS_URL, timeout=5.0)
        response.raise_for_status()
        return response.json()
    except Exception as exc:
        logger.error("Failed to fetch Supabase JWKS from %s: %s", JWKS_URL, exc)
        return {}


def _verify_supabase_jwt(token: str) -> dict | None:
    """
    Attempt to verify a Supabase-issued JWT using the project's EC public key.
    Returns the decoded payload on success, or None if the token is not a
    Supabase token (so the caller can fall back to legacy verification).
    Raises HTTPException if the token looks like a Supabase token but is invalid.
    """
    jwks = _fetch_supabase_jwks()
    keys = jwks.get("keys", [])
    if not keys:
        return None  # JWKS unavailable — skip Supabase verification

    for key_data in keys:
        try:
            public_key = ECKey(key_data, algorithm=key_data.get("alg", "ES256"))
            payload = jwt.decode(
                token,
                public_key,
                algorithms=[key_data.get("alg", "ES256")],
                options={
                    "verify_aud": False,      # Supabase tokens may omit aud
                },
            )
            # Confirm this is actually a Supabase-issued token
            if SUPABASE_JWT_ISSUER and payload.get("iss") != SUPABASE_JWT_ISSUER:
                continue
            return payload
        except JWTError:
            continue
        except Exception as exc:
            logger.debug("Supabase JWKS key did not match: %s", exc)
            continue

    return None  # No key matched — caller should try legacy verification


def _verify_legacy_jwt(token: str) -> dict | None:
    """
    Verify a legacy FastAPI HS256 JWT.
    Returns the decoded payload on success, None on failure.
    """
    try:
        return jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
    except JWTError:
        return None


def _resolve_user(payload: dict, is_supabase: bool, db: Session) -> User:
    """
    Given a decoded JWT payload, look up the corresponding User in the DB.

    For Supabase tokens the subject (`sub`) is the Supabase auth UUID which
    is used as the user's `id` in public.users (set during the OAuth callback).
    For legacy tokens the subject is also the user's DB id.
    """
    user_id: str = payload.get("sub")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing subject claim",
            headers={"WWW-Authenticate": "Bearer"},
        )

    user = db.query(User).filter(User.id == user_id).first()

    if user is None and is_supabase:
        # Edge-case: Supabase session exists but the OAuth callback has not yet
        # inserted/linked the user in public.users (e.g. race condition).
        # Return a minimal synthetic user so the frontend isn't hard-blocked.
        email = payload.get("email", "")
        logger.warning(
            "Supabase user %s not found in public.users — returning synthetic profile. "
            "This usually means the /auth/callback route hasn't completed yet.",
            user_id,
        )
        synthetic = User(
            id=user_id,
            name=payload.get("user_metadata", {}).get("full_name") or email.split("@")[0],
            email=email,
            password="",
            role=UserRole.STUDENT,
        )
        return synthetic

    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(bearer_scheme),
    db: Session = Depends(get_db),
) -> User:
    """
    Extract and validate the JWT from the Authorization: Bearer <token> header.

    Tries Supabase JWT verification first, then falls back to legacy HS256.
    """
    token = credentials.credentials
    unauthorized = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )

    # ── 1. Try Supabase JWT (EC / ES256) ─────────────────────────────────
    supabase_payload = _verify_supabase_jwt(token)
    if supabase_payload is not None:
        return _resolve_user(supabase_payload, is_supabase=True, db=db)

    # ── 2. Fall back to legacy FastAPI JWT (HS256) ────────────────────────
    legacy_payload = _verify_legacy_jwt(token)
    if legacy_payload is not None:
        return _resolve_user(legacy_payload, is_supabase=False, db=db)

    raise unauthorized


# ── Role-gated dependency helpers ─────────────────────────────────────────────

def require_student(current_user: User = Depends(get_current_user)) -> User:
    """Allow students, teachers, and admins (any authenticated user)."""
    return current_user


def require_teacher(current_user: User = Depends(get_current_user)) -> User:
    """Only teachers and admins."""
    if current_user.role not in (UserRole.TEACHER, UserRole.ADMIN):
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Teacher or Admin access required",
        )
    return current_user


def require_admin(current_user: User = Depends(get_current_user)) -> User:
    """Only admins."""
    if current_user.role != UserRole.ADMIN:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Admin access required",
        )
    return current_user
