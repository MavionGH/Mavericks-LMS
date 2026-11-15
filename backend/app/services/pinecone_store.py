"""
Pinecone vector storage for module (chapter) content.

Pipeline (Part 1 of the knowledge-base feature):
    1. Collect video transcript + article text for a module.
    2. Build structured documents {courseId, moduleId, source, content}.
    3. Create semantic, sentence-aware chunks (800-1200 chars, 150-200 overlap).
    4. Embed every chunk with OpenAI text-embedding-3-small (truncated to EMBED_DIM).
    5. Upsert into Pinecone under namespace `course_{courseId}` with rich metadata.

Vectors are keyed `courseId_moduleId_chunkIndex` so re-indexing a module only
touches that module's own vectors — other modules in the course are never
overwritten. Upserts are additive/idempotent (we never bulk-delete other data).

Gracefully no-ops when the Pinecone SDK or API key is unavailable, so the rest
of the application keeps working.
"""
import logging
import os
import re
from typing import List, Optional

from app.services.embeddings import embed_texts, embeddings_available
from app.services.openai_config import EMBED_DIM

logger = logging.getLogger(__name__)

# The key is stored as `pinecone-api` in .env; also accept the conventional name.
PINECONE_API_KEY = os.getenv("pinecone-api") or os.getenv("PINECONE_API_KEY", "")
PINECONE_INDEX = os.getenv("PINECONE_INDEX", "course-content")
PINECONE_CLOUD = os.getenv("PINECONE_CLOUD", "aws")
PINECONE_REGION = os.getenv("PINECONE_REGION", "us-east-1")

# Must match the OpenAI embedding dimension (text-embedding-3-small → EMBED_DIM).

# Semantic chunking parameters.
CHUNK_MAX_CHARS = 1200
CHUNK_MIN_CHARS = 800
CHUNK_OVERLAP = 175

_index = None


def _get_index():
    """Lazy-init the Pinecone index, creating it (serverless) if it doesn't exist."""
    global _index
    if _index is not None:
        return _index
    if not PINECONE_API_KEY:
        logger.warning("Pinecone API key not configured; skipping vector store.")
        return None
    try:
        from pinecone import Pinecone, ServerlessSpec

        pc = Pinecone(api_key=PINECONE_API_KEY)
        existing = set(pc.list_indexes().names())
        if PINECONE_INDEX not in existing:
            pc.create_index(
                name=PINECONE_INDEX,
                dimension=EMBED_DIM,
                metric="cosine",
                spec=ServerlessSpec(cloud=PINECONE_CLOUD, region=PINECONE_REGION),
            )
            logger.info("Created Pinecone index '%s' (%d-dim, cosine).", PINECONE_INDEX, EMBED_DIM)
        _index = pc.Index(PINECONE_INDEX)
    except Exception as exc:
        logger.error("Could not initialise Pinecone: %s", exc)
        return None
    return _index


def semantic_chunk_text(
    text: str,
    max_size: int = CHUNK_MAX_CHARS,
    overlap: int = CHUNK_OVERLAP,
) -> List[str]:
    """
    Split text into semantic, sentence-aware chunks.

    - Chunk size kept up to ~max_size characters (target floor CHUNK_MIN_CHARS).
    - Adjacent chunks overlap by ~`overlap` characters for context continuity.
    - Sentences are never split mid-sentence unless a single sentence exceeds
      max_size (then it is hard-split as a last resort).
    """
    text = (text or "").strip()
    if not text:
        return []

    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", text) if s.strip()]
    chunks: List[str] = []
    current = ""

    for sentence in sentences:
        # A single oversized sentence — flush current, then hard-split it.
        if len(sentence) > max_size:
            if current:
                chunks.append(current)
                current = ""
            step = max(max_size - overlap, 1)
            for i in range(0, len(sentence), step):
                chunks.append(sentence[i : i + max_size])
            continue

        candidate = (current + " " + sentence).strip() if current else sentence
        if len(candidate) <= max_size:
            current = candidate
        else:
            # Adding this sentence would overflow — flush and start a new chunk
            # seeded with an overlap tail from the end of the previous chunk.
            chunks.append(current)
            tail = current[-overlap:]
            # Avoid starting the overlap mid-word.
            space = tail.find(" ")
            if space > 0:
                tail = tail[space + 1 :]
            current = (tail + " " + sentence).strip()

    if current:
        chunks.append(current)
    return chunks


def build_documents(
    course_id: str,
    module_id: str,
    video_transcript: Optional[str] = None,
    article_content: Optional[str] = None,
) -> List[dict]:
    """Build structured source documents for a module's video + article content."""
    docs: List[dict] = []
    if video_transcript and video_transcript.strip():
        docs.append({
            "courseId": course_id,
            "moduleId": module_id,
            "source": "video",
            "content": video_transcript.strip(),
        })
    if article_content and article_content.strip():
        docs.append({
            "courseId": course_id,
            "moduleId": module_id,
            "source": "article",
            "content": article_content.strip(),
        })
    return docs


def index_module_content(
    course_id: str,
    module_id: str,
    article_content: Optional[str] = None,
    video_transcript: Optional[str] = None,
) -> None:
    """
    Chunk → embed → upsert a module's content into Pinecone.

    Safe to run as a background task: no-ops cleanly if Pinecone or the embedding
    model is unavailable. Vectors are namespaced by course and keyed by module so
    other modules' vectors are never affected.
    """
    print(f"\n[EMBED] ── Indexing module {module_id} (course {course_id}) ──", flush=True)
    index = _get_index()
    if index is None:
        print("[EMBED] ✗ Pinecone unavailable (check 'pinecone-api' in .env) — skipped.", flush=True)
        return

    try:
        if not embeddings_available():
            print("[EMBED] ✗ Embeddings unavailable (check OPENAI_API_KEY) — skipped.", flush=True)
            logger.warning("Embeddings unavailable; skipping Pinecone index for module %s", module_id)
            return

        print(f"[EMBED] Embedding with OpenAI ({EMBED_DIM}-dim)…", flush=True)
        namespace = f"course_{course_id}"
        docs = build_documents(course_id, module_id, video_transcript, article_content)
        print(f"[EMBED] Sources to embed: {[d['source'] for d in docs] or 'none'}", flush=True)

        vectors = []
        chunk_index = 0
        for doc in docs:
            chunks = semantic_chunk_text(doc["content"])
            if not chunks:
                continue
            print(f"[EMBED]   • {doc['source']}: {len(chunks)} chunk(s) → embedding…", flush=True)
            embeddings = embed_texts(chunks)
            if embeddings is None:
                print("[EMBED] ✗ Embedding call failed — skipped.", flush=True)
                logger.warning("Embedding call failed; skipping Pinecone index for module %s", module_id)
                return
            for emb, chunk in zip(embeddings, chunks):
                vectors.append({
                    "id": f"{course_id}_{module_id}_{chunk_index}",
                    "values": emb,
                    "metadata": {
                        "courseId": course_id,
                        "moduleId": module_id,
                        "source": doc["source"],
                        "chunkIndex": chunk_index,
                        "text": chunk,
                    },
                })
                chunk_index += 1

        if not vectors:
            print("[EMBED] No transcript/article content to index — nothing upserted.", flush=True)
            logger.info("No content to index for module %s", module_id)
            return

        # Upsert in batches of 100. Upsert is idempotent per id and scoped to this
        # module's namespace, so existing vectors of other modules are preserved.
        print(f"[EMBED] Upserting {len(vectors)} vector(s) to Pinecone (index='{PINECONE_INDEX}', namespace='{namespace}')…", flush=True)
        for i in range(0, len(vectors), 100):
            index.upsert(vectors=vectors[i : i + 100], namespace=namespace)

        print(f"[EMBED] ✓ Done — {len(vectors)} vector(s) stored in Pinecone for module {module_id}.\n", flush=True)
        logger.info(
            "Upserted %d vectors to Pinecone (namespace=%s, module=%s).",
            len(vectors), namespace, module_id,
        )
    except Exception as exc:
        print(f"[EMBED] ✗ FAILED for module {module_id}: {exc}\n", flush=True)
        logger.error("index_module_content failed for module %s: %s", module_id, exc)


def query_course_content(course_id: str, query: str, top_k: int = 12) -> List[str]:
    """
    Semantic search across EVERY module of a course.

    All of a course's module vectors live in one namespace (`course_{courseId}`),
    so a single query retrieves the most relevant chunks drawn from any module's
    video transcript or article. Returns the chunk texts (most relevant first).

    Returns an empty list (never raises) when Pinecone or the embedding model is
    unavailable, so callers can fall back to raw content.
    """
    index = _get_index()
    if index is None:
        return []
    try:
        query_vecs = embed_texts([query])
        if not query_vecs:
            return []

        query_vec = query_vecs[0]
        namespace = f"course_{course_id}"
        res = index.query(
            namespace=namespace,
            vector=query_vec,
            top_k=top_k,
            include_metadata=True,
        )
        matches = res.get("matches", []) if isinstance(res, dict) else getattr(res, "matches", [])
        chunks: List[str] = []
        for m in matches:
            meta = m.get("metadata", {}) if isinstance(m, dict) else getattr(m, "metadata", {}) or {}
            text = meta.get("text")
            if text:
                chunks.append(text)
        return chunks
    except Exception as exc:
        logger.warning("query_course_content failed for course %s: %s", course_id, exc)
        return []
