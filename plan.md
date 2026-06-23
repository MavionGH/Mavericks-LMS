I'm continuing work on an existing project (Mavericks LMS — FastAPI backend + Next.js 
frontend, Supabase Postgres, LangGraph-based voice interview feature). Work through 
the phases below IN ORDER. After finishing each phase, stop, summarize exactly what 
changed and which files you touched, and wait for my confirmation before starting the 
next phase. Do not skip ahead.

CURRENT KNOWN STATE:
- Auth (JWT) works but SECRET_KEY, ALGORITHM, and TOKEN_EXPIRE_HOURS are hardcoded in 
  backend/app/auth/dependencies.py and backend/app/routers/auth.py instead of being 
  read from .env via os.getenv, even though they're already defined in .env.
- The quiz feature is fully mocked: frontend/src/app/quiz/[courseId]/[chapterId]/page.js 
  uses a hardcoded MOCK_QUESTIONS array, and there are no backend routes for quizzes 
  despite a QuizAttempt table already existing in backend/app/models/models.py. The 
  Learn page currently skips the quiz entirely and links straight to the interview.
- YouTube transcripts are entered manually by teachers via a textarea — no automatic 
  fetching exists yet.
- There's no RAG/vector search. Chapter context is built via raw string concatenation 
  and truncation (context[:4000] / context[:6000]) in 
  backend/app/services/chapter_context.py before being sent to the LLM.
- The per-chapter voice interview (STT/TTS via Web Speech API, LangGraph orchestration 
  in backend/app/services/interview_graph.py, speech metric scoring in 
  backend/app/services/llm.py via llm_score_interview/_fallback_score) already works 
  correctly. Reuse this machinery rather than duplicating it wherever possible — don't 
  modify its working internals except where a later phase explicitly requires it.

TARGET LEARNING FLOW (what we're building toward):
For each chapter in a course: watch video → pass quiz → complete AI voice interview 
on that chapter → get a chapter score. Once ALL chapters in a course are completed 
this way, unlock a single FINAL course-wide voice interview that draws questions from 
content across every chapter in the course (not just one). The student's final course 
score is a weighted composite of: average chapter quiz scores, average chapter 
interview scores, and the final interview score. Certificate issuance is gated on this 
composite meeting the course's passing threshold.

================================================================
PHASE 0 — Security fixes
================================================================
1. In backend/app/auth/dependencies.py and backend/app/routers/auth.py, replace the 
   hardcoded SECRET_KEY, ALGORITHM, and TOKEN_EXPIRE_HOURS with values loaded via 
   os.getenv(), with safe non-secret defaults only for local dev fallback.
2. Check .env for unused SUPABASE_* keys — either wire them into real usage or remove 
   them, and tell me which.
3. Confirm .env is in .gitignore and check git history for it; warn me if it was ever 
   committed, since the current DB password needs rotating regardless.

================================================================
PHASE 1 — Real per-chapter quiz
================================================================
1. Backend: add a quiz router with:
   - GET /api/quiz/{chapter_id} — generate 5 MCQ questions from the chapter's 
     article_content/video_transcript via the existing LLM service if none exist yet, 
     store them, return them without correct answers exposed.
   - POST /api/quiz/submit — grade server-side, save to quiz_attempts, return score 
     and pass/fail against the course's passing_threshold.
2. Frontend: replace MOCK_QUESTIONS in quiz/[courseId]/[chapterId]/page.js with real 
   calls via the existing authFetch helper.
3. Update the Learn page so the chapter's interview button is disabled until that 
   chapter's quiz is passed (not linked directly as it is now).

================================================================
PHASE 2 — Automatic transcript ingestion
================================================================
1. Add youtube-transcript-api to backend dependencies.
2. On chapter create/update with a youtube_url and no manually-pasted transcript, 
   fetch the transcript asynchronously (non-blocking) and save it.
3. If no captions exist, fail gracefully (log it, leave video_transcript empty, 
   surface this in the teacher UI). Leave a clear TODO for a Whisper-based fallback — 
   don't build that yet.

================================================================
PHASE 3 — Real RAG with pgvector
================================================================
1. Enable the pgvector extension on the Supabase database.
2. Add a chunks/embeddings table storing: chapter_id, course_id (denormalized for 
   easy cross-chapter querying later), chunk_text, embedding vector. Design this now 
   with course_id included specifically because Phase 5 needs to retrieve chunks 
   across an entire course, not just one chapter.
3. On chapter create/update, chunk article_content + video_transcript and embed with 
   a local sentence-transformers model (no paid API needed).
4. Update build_chapter_context() and quiz/interview context-building to retrieve 
   top-k relevant chunks via vector similarity instead of slicing raw text.

================================================================
PHASE 4 — Course completion tracking & gating
================================================================
1. Add an endpoint GET /api/courses/{course_id}/completion-status (per enrolled 
   student) that returns, per chapter: quiz status + score, chapter-interview status 
   + score, and an overall boolean "all_chapters_complete".
2. This is the gate for Phase 5 — the final interview should be locked in the 
   frontend/backend until all_chapters_complete is true for that student+course.
3. Extend the interview_sessions and evaluations tables with a scope field 
   ('chapter' | 'course_final') and make chapter_id nullable, adding course_id as a 
   required FK on both scopes. Write a migration-equivalent (see Phase 7 note on 
   Alembic) or, if still using create_all for now, document the schema change clearly.

================================================================
PHASE 5 — Final course-wide interview
================================================================
1. Reuse the existing LangGraph orchestration pattern from interview_graph.py rather 
   than duplicating it — refactor it to accept a scope parameter and a context-
   retrieval function, so 'chapter' scope pulls chunks filtered by chapter_id and 
   'course_final' scope pulls chunks filtered by course_id across all chapters.
2. Add POST /api/interview/final/start/{course_id} and reuse/extend the existing 
   submit_answer route to handle course_final-scoped sessions, gated by the 
   completion-status check from Phase 4 (reject if not all chapters are complete).
3. Prompt design: the question-generation prompt for the final interview should 
   explicitly ask the LLM to synthesize across multiple chapters — e.g. ask 
   connective questions that span two or more chapters' concepts, not just repeat 
   single-chapter questions. Pull retrieved context proportionally across chapters 
   rather than letting one chapter's chunks dominate.
4. Frontend: add /final-interview/[courseId]/page.js, reusing the existing 
   startListening/speakText hooks from the chapter interview page rather than 
   reimplementing STT/TTS. Only render/link to this page when 
   completion-status.all_chapters_complete is true.

================================================================
PHASE 6 — Composite scoring & certificate
================================================================
1. Implement a composite score calculation:
   chapter_quiz_avg      = average of quiz_attempts.score across all chapters in course
   chapter_interview_avg = average of evaluations.overall_score where scope='chapter' 
                            for that course
   final_interview_score = evaluations.overall_score where scope='course_final'
   final_course_score = (0.25 * chapter_quiz_avg) + (0.35 * chapter_interview_avg) 
                         + (0.40 * final_interview_score)
   Make these three weights named constants/config, not magic numbers, so they're 
   easy to tune later.
2. Store this breakdown (not just the final number) somewhere queryable — extend 
   certificates or add a course_completions table with all four values plus 
   pass/fail against the course's passing_threshold.
3. Add GET /api/courses/{course_id}/results — returns the full breakdown (every 
   chapter's quiz + interview score, the final interview score, and the composite) 
   for a results/summary page.
4. Frontend: a results page showing this breakdown clearly — per-chapter scores, 
   final interview score, and the composite total out of 100.
5. Gate certificate generation (existing certificates table) on final_course_score 
   meeting passing_threshold.

================================================================
PHASE 7 — Hardening
================================================================
1. Add Alembic and generate an initial migration capturing current schema, then 
   migrations for every schema change made in Phases 4 and 6 instead of relying on 
   create_all going forward.
2. Add tests for: quiz generation/grading, transcript ingestion fallback behavior, 
   RAG retrieval correctness, completion-status gating logic, and the composite score 
   calculation (this last one especially — it's pure logic and should be fully unit 
   tested with known inputs/expected outputs).

For every phase: flag anything that risks breaking the already-working per-chapter 
interview flow before making the change, and tell me explicitly if a phase requires a 
decision from me (e.g. exact scoring weights, UI copy) rather than guessing silently.