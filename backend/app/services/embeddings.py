"""Text chunking and sentence-transformer embedding service for RAG."""
import logging
from typing import List, Optional

logger = logging.getLogger(__name__)

_model = None


def _get_model():
    """Lazy-load sentence-transformers model (downloads ~90 MB on first call)."""
    global _model
    if _model is None:
        try:
            from sentence_transformers import SentenceTransformer
            _model = SentenceTransformer("all-MiniLM-L6-v2")
            logger.info("Loaded sentence-transformers model (all-MiniLM-L6-v2, 384-dim).")
        except Exception as exc:
            logger.error("Could not load sentence-transformers: %s", exc)
    return _model


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

        model = _get_model()
        if model is None:
            for chunk in raw_chunks:
                db.add(ChunkEmbedding(
                    chapter_id=chapter_id, course_id=course_id,
                    chunk_text=chunk, embedding=None,
                ))
            db.commit()
            logger.warning("Stored %d chunks without embeddings for chapter %s", len(raw_chunks), chapter_id)
            return

        embeddings = model.encode(raw_chunks, show_progress_bar=False)
        for chunk, emb in zip(raw_chunks, embeddings):
            db.add(ChunkEmbedding(
                chapter_id=chapter_id,
                course_id=course_id,
                chunk_text=chunk,
                embedding=emb.tolist(),
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

    model = _get_model()
    if model is not None:
        try:
            query_emb = model.encode([query])[0]
            vec_str = "[" + ",".join(f"{x:.6f}" for x in query_emb.tolist()) + "]"
            rows = db.execute(
                text("""
                    SELECT chunk_text FROM chunk_embeddings
                    WHERE chapter_id = :cid AND embedding IS NOT NULL
                    ORDER BY embedding <=> :emb::vector
                    LIMIT :k
                """),
                {"cid": chapter_id, "emb": vec_str, "k": top_k},
            ).fetchall()
            if rows:
                return [r[0] for r in rows]
        except Exception as exc:
            logger.warning("Vector similarity search failed, using fallback: %s", exc)

    # Fallback: return first top_k chunks in insertion order
    chunks = (
        db.query(ChunkEmbedding)
        .filter(ChunkEmbedding.chapter_id == chapter_id)
        .order_by(ChunkEmbedding.created_at)
        .limit(top_k)
        .all()
    )
    return [c.chunk_text for c in chunks]
