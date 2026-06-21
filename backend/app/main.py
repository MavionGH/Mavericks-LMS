from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import engine, Base
from app.routers import auth, courses, enrollment, admin, interview

# Create all tables
Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="Maverik Learning API",
    description="AI-Powered Learning Management System",
    version="1.0.0",
)

# CORS for Next.js frontend
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register routers
app.include_router(auth.router)
app.include_router(courses.router)
app.include_router(enrollment.router)
app.include_router(admin.router)
app.include_router(interview.router)


@app.get("/")
def root():
    return {"message": "Maverik Learning API is running", "version": "1.0.0"}


@app.get("/api/health")
def health():
    import os
    llm = "groq" if os.getenv("GROQ_API_KEY") else "openai" if os.getenv("OPENAI_API_KEY") else "fallback"
    return {"status": "healthy", "llm_provider": llm}
