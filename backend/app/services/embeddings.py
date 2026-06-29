"""Text chunking and OpenAI embedding service for RAG.

Embeddings are produced by OpenAI's text-embedding-3-small (cost-efficient),
truncated to EMBED_DIM (384) dimensions via the `dimensions` parameter so they
stay compatible with the existing Postgres `Vector(384)` column and Pinecone
index — no schema migration required.
"""
import logging
from typing import List, Optional

from app.services.openai_config import (
    EMBED_DIM,
    OPENAI_EMBED_MODEL,
    get_openai_client,
    has_openai,
)

logger = logging.getLogger(__name__)

# OpenAI's embeddings endpoint accepts many inputs per request; batch to keep
# each request well within token limits while minimising round-trips.
_EMBED_BATCH = 128


def embeddings_available() -> bool:
    """True when embeddings can be produced (OpenAI key present)."""
    return has_openai()


def embed_texts(texts: List[str]) -> Optional[List[List[float]]]:
    """Embed a list of texts with OpenAI. Returns a list of vectors (one per
    input) or None if embeddings are unavailable / the call fails — callers then
    degrade gracefully (store without embeddings, or fall back to raw content).
    """
    if not texts:
        return []
    client = get_openai_client()
    if client is None:
        logger.warning("Embeddings unavailable: no OpenAI client (missing OPENAI_API_KEY?)")
        return None
    try:
        vectors: List[List[float]] = []
        for start in range(0, len(texts), _EMBED_BATCH):
            batch = texts[start : start + _EMBED_BATCH]
            resp = client.embeddings.create(
                model=OPENAI_EMBED_MODEL,
                input=batch,
                dimensions=EMBED_DIM,
            )
            # Preserve input order (the API returns items with an `index`).
            for item in sorted(resp.data, key=lambda d: d.index):
                vectors.append(item.embedding)
        return vectors
    except Exception as exc:
        logger.error("OpenAI embedding call failed: %s", exc)
        return None


def chunk_text(text: str, chunk_size: int = 500, overlap: int = 50) -> List[str]:
    """Split text into overlapping word-level chunks."""
    words = text.split()
    if not words:
        return []
    step = max(chunk_size - overlap, 1)
    chunks = []
    for i in range(0, len(words), step):
        chunk = " ".join(words[i : i + chunk_size])
        if chunk:
            chunks.append(chunk)
    return chunks


def embed_and_store_chapter(
    chapter_id: str,
    course_id: str,
    article_content: str,
    video_transcript: Optional[str] = None,
    db=None,
) -> None:
    """
    Chunk chapter content, compute embeddings, and persist to chunk_embeddings.
    Creates its own DB session if db is None — safe to call as a background task.
    """
    should_close = db is None
    if db is None:
        from app.database import SessionLocal
        db = SessionLocal()

    try:
        from app.models.models import ChunkEmbedding

        db.query(ChunkEmbedding).filter(ChunkEmbedding.chapter_id == chapter_id).delete()

        raw_chunks: List[str] = []
        if article_content:
            raw_chunks.extend(chunk_text(article_content))
        if video_transcript:
            raw_chunks.extend(chunk_text(video_transcript))

        if not raw_chunks:
            db.commit()
            return

        embeddings = embed_texts(raw_chunks)
        if embeddings is None:
            for chunk in raw_chunks:
                db.add(ChunkEmbedding(
                    chapter_id=chapter_id, course_id=course_id,
                    chunk_text=chunk, embedding=None,
                ))
            db.commit()
            logger.warning("Stored %d chunks without embeddings for chapter %s", len(raw_chunks), chapter_id)
            return

        for chunk, emb in zip(raw_chunks, embeddings):
            db.add(ChunkEmbedding(
                chapter_id=chapter_id,
                course_id=course_id,
                chunk_text=chunk,
                embedding=emb,
            ))
        db.commit()
        logger.info("Stored %d embeddings for chapter %s", len(raw_chunks), chapter_id)

    except Exception as exc:
        logger.error("embed_and_store_chapter failed for %s: %s", chapter_id, exc)
        try:
            db.rollback()
        except Exception:
            pass
    finally:
        if should_close:
            db.close()


def retrieve_relevant_chunks(
    chapter_id: str,
    query: str,
    db,
    top_k: int = 6,
) -> List[str]:
    """
    Return up to top_k chunk texts most relevant to query via cosine similarity.
    Falls back to the first top_k chunks by insertion order if vector search fails.
    """
    from app.models.models import ChunkEmbedding
    from sqlalchemy import text

    query_vecs = embed_texts([query])
    if query_vecs:
        try:
            query_emb = query_vecs[0]
            vec_str = "[" + ",".join(f"{x:.6f}" for x in query_emb) + "]"
            # Use CAST(:emb AS vector) instead of :emb::vector — the latter is
            # invalid syntax with psycopg's parameterized queries.
            rows = db.execute(
                text("""
                    SELECT chunk_text FROM chunk_embeddings
                    WHERE chapter_id = :cid AND embedding IS NOT NULL
                    ORDER BY embedding <=> CAST(:emb AS vector)
                    LIMIT :k
                """),
                {"cid": chapter_id, "emb": vec_str, "k": top_k},
            ).fetchall()
            if rows:
                return [r[0] for r in rows]
        except Exception as exc:
            logger.warning("Vector similarity search failed, using fallback: %s", exc)
            # IMPORTANT: a failed SQL statement in PostgreSQL marks the entire
            # transaction as aborted.  We must rollback here so the fallback
            # ORM query below can execute on a clean transaction.
            try:
                db.rollback()
            except Exception:
                pass

    # Fallback: return first top_k chunks in insertion order
    try:
        chunks = (
            db.query(ChunkEmbedding)
            .filter(ChunkEmbedding.chapter_id == chapter_id)
            .order_by(ChunkEmbedding.created_at)
            .limit(top_k)
            .all()
        )
        return [c.chunk_text for c in chunks]
    except Exception as exc:
        logger.warning("Fallback chunk retrieval also failed: %s", exc)
        try:
            db.rollback()
        except Exception:
            pass
        return []
