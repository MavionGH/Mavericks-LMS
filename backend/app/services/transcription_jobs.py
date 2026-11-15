"""In-memory store for asynchronous video-transcription jobs.

Used by the optional async path of POST /api/courses/upload-video: the upload
returns the video URL immediately with a `transcript_job_id`, transcription runs
in a background task, and the frontend polls GET /api/courses/transcript-status/
{job_id} until the transcript is ready.

The store is process-local and ephemeral (transcripts survive only until the
browser polls them, seconds-to-minutes), with a TTL sweep so abandoned jobs are
reclaimed. This is sufficient for the single-worker uvicorn deployment used here.
NOTE: if the server is ever run with multiple workers (uvicorn --workers N /
gunicorn), a create in one worker may not be visible to a poll routed to another
worker — move this to a shared store (Redis / DB) before scaling out.
"""
import threading
import time
import uuid

# job_id -> {"status": "pending"|"done"|"error", "transcript": str,
#            "error": str, "created": float}
_jobs: dict = {}
_lock = threading.Lock()

# How long a finished (or abandoned) job is kept before the sweep discards it.
_JOB_TTL_SECONDS = 3600  # 1 hour


def _sweep_expired(now: float) -> None:
    """Drop jobs older than the TTL. Caller must hold _lock."""
    expired = [jid for jid, j in _jobs.items() if now - j["created"] > _JOB_TTL_SECONDS]
    for jid in expired:
        _jobs.pop(jid, None)


def create_job() -> str:
    """Register a new pending job and return its id."""
    job_id = str(uuid.uuid4())
    now = time.time()
    with _lock:
        _sweep_expired(now)
        _jobs[job_id] = {"status": "pending", "transcript": "", "error": "", "created": now}
    return job_id


def set_result(job_id: str, transcript: str) -> None:
    """Mark a job done with its transcript text ("" is a valid 'no speech' result)."""
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["status"] = "done"
            job["transcript"] = transcript or ""


def set_error(job_id: str, message: str) -> None:
    """Mark a job as failed with an error message."""
    with _lock:
        job = _jobs.get(job_id)
        if job is not None:
            job["status"] = "error"
            job["error"] = message or "Transcription failed"


def get_job(job_id: str) -> dict | None:
    """Return a shallow copy of the job's public state, or None if unknown/expired."""
    now = time.time()
    with _lock:
        _sweep_expired(now)
        job = _jobs.get(job_id)
        if job is None:
            return None
        return {"status": job["status"], "transcript": job["transcript"], "error": job["error"]}
