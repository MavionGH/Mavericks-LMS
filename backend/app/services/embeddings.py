"""
RAG embedding service — chunks text and generates embeddings using
sentence-transformers (all-MiniLM-L6-v2, runs locally, no API key needed).

Provides:
  - chunk_and_embed_chapter(): chunk + embed chapter content, save to DB
  - retrieve_relevant_chunks(): vector similarity search for top-k chunks
"""
import logging
import re
from typing import List, Optional

from sqlalchemy.orm import Session
from sqlalchemy import text

from app.models.models import ChunkEmbedding, EMBEDDING_DIM

logger = logging.getLogger(__name__)

# ── Lazy-loaded fastembed model ──────────────────────────
_model = None


def _get_embedding_model():
    """Lazily load the fastembed TextEmbedding model."""
    global _model
    if _model is None:
        try:
            from fastembed import TextEmbedding
            # Defaults to BAAI/bge-small-en-v1.5 (384 dimensions)
            _model = TextEmbedding()
            logger.info("Loaded fastembed TextEmbedding model (BAAI/bge-small-en-v1.5)")
        except Exception as e:
            logger.error(f"Failed to load fastembed model: {e}")
            raise
    return _model


def _embed_texts(texts: List[str]) -> List[List[float]]:
    """Embed a batch of texts. Returns list of float vectors."""
    model = _get_embedding_model()
    # fastembed model.embed returns a generator of numpy arrays
    embeddings = list(model.embed(texts))
    return [vec.tolist() for vec in embeddings]


# ── Chunking ─────────────────────────────────────────────────────────

CHUNK_SIZE = 500       # target characters per chunk
CHUNK_OVERLAP = 100    # overlap between adjacent chunks


def _chunk_text(text_content: str, chunk_size: int = CHUNK_SIZE, overlap: int = CHUNK_OVERLAP) -> List[str]:
    """Split text into overlapping chunks by paragraph/sentence boundaries.

    Strategy:
      1. Split by double newlines (paragraphs)
      2. If a paragraph is still too long, split by sentences
      3. Merge small paragraphs together up to chunk_size
    """
    if not text_content or not text_content.strip():
        return []

    # Split by double-newline (paragraphs)
    paragraphs = re.split(r"\n\s*\n", text_content.strip())
    paragraphs = [p.strip() for p in paragraphs if p.strip()]

    # Further split long paragraphs into sentences
    segments = []
    for para in paragraphs:
        if len(para) <= chunk_size:
            segments.append(para)
        else:
            # Split by sentence boundaries
            sentences = re.split(r"(?<=[.!?])\s+", para)
            segments.extend(sentences)

    # Merge small segments into chunks
    chunks = []
    current = ""
    for seg in segments:
        if current and len(current) + len(seg) + 1 > chunk_size:
            chunks.append(current.strip())
            # Keep overlap from end of current chunk
            if overlap > 0:
                current = current[-overlap:] + " " + seg
            else:
                current = seg
        else:
            current = (current + " " + seg).strip() if current else seg

    if current.strip():
        chunks.append(current.strip())

    return chunks


# ── Database operations ──────────────────────────────────────────────

def ensure_pgvector_extension(db: Session):
    """Enable pgvector extension if not already enabled."""
    try:
        db.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
        db.commit()
        logger.info("pgvector extension enabled")
    except Exception as e:
        db.rollback()
        logger.warning(f"Could not enable pgvector extension: {e}")


def chunk_and_embed_chapter(
    db: Session,
    chapter_id: str,
    course_id: str,
    article_content: str,
    video_transcript: Optional[str] = None,
) -> int:
    """Chunk and embed chapter content, storing results in chunk_embeddings table.

    Deletes any existing chunks for this chapter first (idempotent on re-run).
    Returns the number of chunks created.
    """
    # Delete existing chunks for this chapter
    db.query(ChunkEmbedding).filter(ChunkEmbedding.chapter_id == chapter_id).delete()

    # Build combined text
    combined = f"# Article Content\n\n{article_content or ''}"
    if video_transcript:
        combined += f"\n\n# Video Transcript\n\n{video_transcript}"

    chunks = _chunk_text(combined)
    if not chunks:
        logger.info(f"No content to chunk for chapter {chapter_id}")
        db.commit()
        return 0

    # Embed all chunks in one batch
    try:
        embeddings = _embed_texts(chunks)
    except Exception as e:
        logger.error(f"Embedding failed for chapter {chapter_id}: {e}")
        db.commit()
        return 0

    # Save to DB
    for i, (chunk_text, embedding) in enumerate(zip(chunks, embeddings)):
        ce = ChunkEmbedding(
            chapter_id=chapter_id,
            course_id=course_id,
            chunk_text=chunk_text,
            embedding=embedding,
            chunk_index=i,
        )
        db.add(ce)

    db.commit()
    logger.info(f"Created {len(chunks)} chunks for chapter {chapter_id}")
    return len(chunks)


def retrieve_relevant_chunks(
    db: Session,
    query: str,
    chapter_id: Optional[str] = None,
    course_id: Optional[str] = None,
    top_k: int = 5,
) -> List[dict]:
    """Retrieve top-k most relevant chunks by cosine similarity.

    Filter by chapter_id (single chapter) or course_id (all chapters in a course).
    Returns list of {"chunk_text": str, "chapter_id": str, "score": float}.
    """
    try:
        query_embedding = _embed_texts([query])[0]
    except Exception as e:
        logger.error(f"Could not embed query: {e}")
        return []

    # Build the filter conditions
    filters = []
    params = {"query_embedding": str(query_embedding), "top_k": top_k}

    if chapter_id:
        filters.append("chapter_id = :chapter_id")
        params["chapter_id"] = chapter_id
    elif course_id:
        filters.append("course_id = :course_id")
        params["course_id"] = course_id

    where_clause = ("WHERE " + " AND ".join(filters)) if filters else ""

    sql = text(f"""
        SELECT id, chapter_id, course_id, chunk_text, chunk_index,
               1 - (embedding <=> :query_embedding::vector) AS similarity
        FROM chunk_embeddings
        {where_clause}
        ORDER BY embedding <=> :query_embedding::vector
        LIMIT :top_k
    """)

    try:
        results = db.execute(sql, params).fetchall()
        return [
            {
                "chunk_text": row.chunk_text,
                "chapter_id": row.chapter_id,
                "course_id": row.course_id,
                "score": float(row.similarity),
            }
            for row in results
        ]
    except Exception as e:
        logger.error(f"Vector search failed: {e}")
        return []
