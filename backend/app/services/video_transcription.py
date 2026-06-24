"""
Video-to-transcript service using FFmpeg + Groq Whisper.

Pipeline:
  1. extract_audio()   — strip video track, compress to mono 16 kHz 64 kbps MP3
  2. split_audio()     — slice into ≤25 MB chunks (Groq API limit)
  3. transcribe_chunks() — submit each chunk to Groq whisper-large-v3-turbo and merge

All functions are synchronous and safe to call from a FastAPI background task
or directly from a route handler inside a thread-pool executor.
"""

import logging
import math
import os
import subprocess
from pathlib import Path
from typing import List

logger = logging.getLogger(__name__)

# Groq Whisper hard limit (bytes)
GROQ_MAX_BYTES = 25 * 1024 * 1024  # 25 MB


# ─────────────────────────────────────────────────────────────────────────────
# Internal helpers
# ─────────────────────────────────────────────────────────────────────────────

def _run_ffmpeg(cmd: List[str]) -> None:
    """
    Execute an FFmpeg / FFprobe command.
    Raises RuntimeError with captured stderr on non-zero exit.
    """
    logger.debug("Running: %s", " ".join(cmd))
    result = subprocess.run(
        cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(
            f"FFmpeg command failed (exit {result.returncode}):\n{stderr}"
        )


def _get_duration(audio_path: str) -> float:
    """
    Use ffprobe to return the total duration of *audio_path* in seconds.
    Raises RuntimeError if ffprobe is unavailable or parsing fails.
    """
    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration",
        "-of", "default=noprint_wrappers=1:nokey=1",
        audio_path,
    ]
    result = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode != 0:
        stderr = result.stderr.decode("utf-8", errors="replace")
        raise RuntimeError(f"ffprobe failed: {stderr}")
    raw = result.stdout.decode("utf-8", errors="replace").strip()
    try:
        return float(raw)
    except ValueError:
        raise RuntimeError(f"Could not parse duration from ffprobe output: {raw!r}")


# ─────────────────────────────────────────────────────────────────────────────
# Public API
# ─────────────────────────────────────────────────────────────────────────────

def extract_audio(video_path: str, audio_path: str) -> None:
    """
    Extract the audio track from *video_path* and write a mono 16 kHz 64 kbps
    MP3 to *audio_path*.  Optimal for Whisper speech recognition.

    Args:
        video_path: Absolute path to the source video file.
        audio_path: Absolute path for the output MP3 file.

    Raises:
        RuntimeError: If ffmpeg is not on PATH or extraction fails.
    """
    cmd = [
        "ffmpeg",
        "-y",            # overwrite output without prompting
        "-i", video_path,
        "-vn",           # discard video stream
        "-ac", "1",      # mono channel
        "-ar", "16000",  # 16 kHz sample rate
        "-b:a", "64k",   # 64 kbps bitrate
        audio_path,
    ]
    _run_ffmpeg(cmd)
    logger.info("Audio extracted: %s", audio_path)


def split_audio(
    audio_path: str,
    chunks_dir: str,
    limit_bytes: int = GROQ_MAX_BYTES,
) -> List[str]:
    """
    Split *audio_path* into time-based chunks if its size exceeds *limit_bytes*.
    Returns a list of absolute paths to chunk files (may be a single-element
    list if no splitting was needed).

    Args:
        audio_path: Absolute path to the extracted MP3 file.
        chunks_dir: Directory where chunk files will be written.
        limit_bytes: Maximum size per chunk in bytes (default 25 MB).

    Returns:
        List of chunk file paths in sequential order.

    Raises:
        RuntimeError: If ffmpeg / ffprobe fails.
    """
    os.makedirs(chunks_dir, exist_ok=True)
    file_size = os.path.getsize(audio_path)

    if file_size <= limit_bytes:
        logger.info("Audio fits within limit (%.1f MB) — no split needed.", file_size / 1024 / 1024)
        return [audio_path]

    duration = _get_duration(audio_path)
    num_chunks = math.ceil(file_size / limit_bytes)
    chunk_duration = duration / num_chunks

    logger.info(
        "Splitting %.1f MB audio into %d chunks (~%.0f s each)",
        file_size / 1024 / 1024, num_chunks, chunk_duration,
    )

    chunk_paths: List[str] = []
    for i in range(num_chunks):
        start_time = i * chunk_duration
        chunk_path = os.path.join(chunks_dir, f"chunk_{i:04d}.mp3")
        cmd = [
            "ffmpeg",
            "-y",
            "-i", audio_path,
            "-ss", str(start_time),
            "-t", str(chunk_duration),
            "-c", "copy",
            chunk_path,
        ]
        _run_ffmpeg(cmd)
        chunk_paths.append(chunk_path)
        logger.info("Chunk %d/%d written: %s", i + 1, num_chunks, chunk_path)

    return chunk_paths


def transcribe_chunks(chunk_paths: List[str]) -> str:
    """
    Submit each audio chunk to Groq's Whisper endpoint and return the merged
    transcript as a single string.

    Uses the ``GROQ_API_KEY`` environment variable (already set in .env).
    Model: ``whisper-large-v3-turbo``

    Args:
        chunk_paths: Ordered list of audio file paths (from split_audio).

    Returns:
        Full transcript text (chunks joined with a single space).

    Raises:
        RuntimeError: If the Groq client is unavailable or an API call fails.
        EnvironmentError: If GROQ_API_KEY is not set.
    """
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise EnvironmentError(
            "GROQ_API_KEY environment variable is not set. "
            "Set it in your .env file or shell environment."
        )

    try:
        from groq import Groq
    except ImportError:
        raise RuntimeError(
            "The 'groq' package is not installed. "
            "Run: pip install groq>=0.9.0"
        )

    client = Groq(api_key=api_key)
    parts: List[str] = []

    for idx, chunk_path in enumerate(chunk_paths):
        logger.info(
            "Transcribing chunk %d/%d: %s",
            idx + 1, len(chunk_paths), chunk_path,
        )
        with open(chunk_path, "rb") as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-large-v3-turbo",
                file=audio_file,
                response_format="text",
            )
        # Groq returns a plain string when response_format="text"
        text: str = response if isinstance(response, str) else response.text
        parts.append(text.strip())
        logger.info("Chunk %d transcribed: %d chars", idx + 1, len(text))

    return " ".join(parts)
