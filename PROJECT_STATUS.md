# Project Status: Mavericks Learning LMS

This document summarizes the current technical state, architecture, pipeline implementation status, database configuration, gaps, execution steps, and suggested next steps for the Mavericks LMS project.

---

## 1. Tech Stack Actually Used

Here is the exact set of frameworks, libraries, and services imported and used in the codebase:

### Backend (Python/FastAPI)
*   **Web Framework:** `fastapi` (0.115.0)
*   **ASGI Server:** `uvicorn[standard]` (0.30.0)
*   **ORM:** `sqlalchemy` (2.0.35)
*   **Database Driver:** `psycopg[binary]` (3.3.4) (PostgreSQL connection)
*   **JWT & Authentication:** `python-jose[cryptography]` (3.3.0) and `bcrypt` (4.2.1)
*   **LLM Orchestration:** `langgraph` (0.2.60) / `langchain` (0.3.14)
*   **LLM Integration Adapters:** `langchain-groq` (0.2.4) and `langchain-openai` (0.3.0)
*   **Configuration Manager:** `python-dotenv` (1.0.1)

### Frontend (Next.js/React)
*   **Framework:** `next` (16.2.9) with App Router
*   **UI Library:** `react` (19.2.4) and `react-dom` (19.2.4)
*   **Routing:** Built-in Next.js navigation
*   **Audio/Voice Processing:** Web Speech API (`SpeechRecognition` & `SpeechSynthesis`) — native client-side APIs built into modern web browsers (free, self-hosted/no API keys needed)
*   **Styling:** Custom CSS stylesheet (`globals.css`) using CSS variables

### Third-Party Services & API Pricing
*   **Supabase PostgreSQL:** Cloud database host. Connected via standard PostgreSQL connection string (`DATABASE_URL`). Configured with connection pooling on Supabase (port 5432). *(Free Tier / Self-hosted equivalent)*
*   **Groq API:** Primary external LLM API used for generating questions and scoring interviews (`GROQ_API_KEY`). Configured to use `llama-3.3-70b-versatile` by default. *(Paid/Usage-based API key)*
*   **OpenAI API:** Fallback external LLM API (`OPENAI_API_KEY`). Configured for `gpt-4o-mini`. *(Paid/Usage-based API key)*

---
git
## 2. Architecture Overview

```mermaid
graph TD
    subgraph Client-Side (Next.js)
        A[Browser] --> B[AuthContext & localStorage]
        A --> C[Web Speech API: STT / TTS]
        A --> D[Frontend Pages: Learn, Interview, Quiz]
    end

    subgraph Server-Side (FastAPI)
        E[FastAPI Routers] --> F[Auth Dependencies: JWT Validation]
        E --> G[Courses Router]
        E --> H[Enrollment Router]
        E --> I[Interview Router]
        I --> J[LangGraph Orchestrator]
        J --> K[LLM & Scoring Service: Groq/OpenAI]
    end

    subgraph Database Layer
        L[(Supabase PostgreSQL)]
    end

    D -- REST HTTP Requests with Bearer Token --> E
    E --> L
```

*   **Communication Protocol:** The frontend and backend communicate exclusively using **REST HTTP endpoints** (JSON payloads). There are no WebSockets or gRPC channels currently defined.
*   **Authentication Flow:** Handles signup and login locally in `auth.py`. Returns a JWT token containing the user ID (`sub`) and role (`role`). The client stores the JWT in `localStorage` (`jwt_token`) and includes it in the `Authorization: Bearer <token>` header for authenticated requests.
*   **Turn-Based Graph State:** The interview operates as a turn-based state machine. The client submits a user's answer via `POST /api/interview/answer`. The backend runs LangGraph nodes to process the answer, record metrics, query the LLM for follow-ups (or final score), updates the `interview_sessions` row, and returns the next question or the final results.

---

## 3. Pipeline Status

The proposed pipeline is partially completed, with critical parts of the data flow mocked or not started:

| Pipeline Stage | Status | Notes & Code References |
| :--- | :--- | :--- |
| **1. YouTube video extraction & transcript download** | **Not started / Stubbed** | There is no automatic transcription utility (like `youtube-transcript-api` or Whisper). The teacher must manually input both the `youtube_url` and paste the `video_transcript` text block inside a form textarea.<br>• *File paths:* [`backend/app/routers/courses.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/routers/courses.py) (POST `/api/courses/{course_id}/chapters`), [`frontend/src/app/teacher/page.js`](file:///home/zaeem/Documents/Mavericks-LMS-main/frontend/src/app/teacher/page.js) (`handleAddChapter`). |
| **2. Chunking & embedding (RAG)** | **Not started / Stubbed** | There are no embedding models, vector search libraries (like ChromaDB or FAISS), or chunking methods in the code. Instead, context is constructed via raw concatenation, and the string is sliced (`context[:4000]` / `context[:6000]`) before being sent to the LLM.<br>• *File paths:* [`backend/app/services/chapter_context.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/services/chapter_context.py) (`build_chapter_context`), [`backend/app/services/llm.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/services/llm.py) (`llm_generate_question`). |
| **3. Generates a quiz from the video** | **Broken / Mocked** | The backend database defines a `QuizAttempt` table and schemas exist, but there are no API routers or controllers for quizzes. The frontend quiz page uses a hardcoded client-side array (`MOCK_QUESTIONS`) to evaluate answers. Also, the quiz is completely skipped in the frontend user flow.<br>• *File paths:* [`frontend/src/app/quiz/[courseId]/[chapterId]/page.js`](file:///home/zaeem/Documents/Mavericks-LMS-main/frontend/src/app/quiz/%5BcourseId%5D/%5BchapterId%5D/page.js) (entirely hardcoded UI), [`backend/app/models/models.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/models/models.py) (`QuizAttempt` table). |
| **4. Voice-based AI interview (STT & TTS)** | **Implemented & Working** | Fully functional turn-based conversation. Uses browser's native speech APIs for voice and speech synthesis. Graph orchestration is run on LangGraph on the backend.<br>• *File paths:* [`frontend/src/app/interview/[courseId]/[chapterId]/page.js`](file:///home/zaeem/Documents/Mavericks-LMS-main/frontend/src/app/interview/%5BcourseId%5D/%5BchapterId%5D/page.js) (`startListening` and `speakText`), [`backend/app/services/interview_graph.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/services/interview_graph.py) (`_build_answer_graph`), [`backend/app/routers/interview.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/routers/interview.py) (`submit_answer`). |
| **5. Speech metric analysis & composite scoring** | **Implemented & Working** | The client measures response time, silence gaps, and pause events, sending them to the backend API. The LLM or a rule-based algorithm scores communication, technical mastery, and confidence, outputting a composite score.<br>• *File paths:* [`frontend/src/app/interview/.../page.js`](file:///home/zaeem/Documents/Mavericks-LMS-main/frontend/src/app/interview/%5BcourseId%5D/%5BchapterId%5D/page.js#L178-L199) (speech metric calculation), [`backend/app/services/llm.py`](file:///home/zaeem/Documents/Mavericks-LMS-main/backend/app/services/llm.py) (`llm_score_interview` & `_fallback_score`). |

---

## 4. Environment & Config

### Backend Configuration Variables

The following variables are checked or configured:

| Variable Name | Found in `.env` | Found in `.env.example` | Code Location / Behavior |
| :--- | :---: | :---: | :--- |
| `DATABASE_URL` | Yes | Yes | `backend/app/database.py` (database engine initialization) |
| `GROQ_API_KEY` | Yes | Yes | `backend/app/services/llm.py` (primary LLM provider) |
| `GROQ_MODEL` | Yes | Yes | `backend/app/services/llm.py` (defaults to `llama-3.3-70b-versatile`) |
| `OPENAI_API_KEY` | No | Yes | `backend/app/services/llm.py` (fallback LLM provider) |
| `OPENAI_MODEL` | No | Yes | `backend/app/services/llm.py` (defaults to `gpt-4o-mini`) |
| `SECRET_KEY` | Yes | No | Hardcoded in `backend/app/auth/dependencies.py`! Ignored from `.env` |
| `ALGORITHM` | Yes | No | Hardcoded in `backend/app/auth/dependencies.py`! Ignored from `.env` |
| `TOKEN_EXPIRE_HOURS`| Yes | No | Hardcoded in `backend/app/routers/auth.py`! Ignored from `.env` |
| `SUPABASE_*` keys | Yes | No | Listed in `.env` but not referenced anywhere in backend python code |

### Config Gaps Found
1.  **JWT settings are hardcoded:** `SECRET_KEY`, `ALGORITHM`, and `TOKEN_EXPIRE_HOURS` are hardcoded in `dependencies.py` and `auth.py`. Although they are declared in `backend/.env`, the codebase does not call `os.getenv` for these values.
2.  **Missing OpenAI Variables in example:** `OPENAI_API_KEY` and `OPENAI_MODEL` are referenced in `llm.py` but omitted from the actual `.env` file (they are present in `.env.example`).

---

## 5. Database/Schema State

The database is built on PostgreSQL (hosted on Supabase) and mapping is handled using SQLAlchemy.

### Core Tables
1.  **`users`:** Stores student, teacher, and admin users. Holds credentials (hashed password via bcrypt), role enums, and timestamps.
2.  **`courses`:** Holds courses including title, description, thumbnail URL, passing threshold, and publication status.
3.  **`chapters`:** Represents specific course modules. Links to `courses.id`, stores learning content (`article_content` in markdown), the `youtube_url`, and the optional manual `video_transcript`.
4.  **`enrollments`:** Maps `users` to `courses`. Tracks the student's active chapter (`current_chapter_index`), learning progress flags (`video_watched`, `article_read`), and completion state.
5.  **`quiz_attempts`:** Records student quiz scores, pass statuses, questions, and attempt times.
6.  **`interview_sessions`:** Manages live active interviews. Stores the current turn count, the full message log (`transcript`), accumulated voice metrics (`pause_metrics`), and the raw LangGraph state dictionary (`graph_state`).
7.  **`evaluations`:** Saves the final scored AI interview results. Stores breakdown scores (technical, communication, confidence, and overall), passing result, strengths, weak areas, recommended review topics, and attempt numbers.
8.  **`certificates`:** Stores verification codes for completed courses.

### Migrations State
*   **No migrations are configured.** There is no Alembic setup initialization (no `alembic.ini` or migration versions folder).
*   The backend database tables are auto-created on startup via standard SQLAlchemy metadata bindings in `backend/app/main.py`:
    ```python
    Base.metadata.create_all(bind=engine)
    ```

---

## 6. Known Gaps / Commented Code

*   **Mocked Quiz Flow:** The frontend page `frontend/src/app/quiz/[courseId]/[chapterId]/page.js` utilizes hardcoded arrays and performs state mutations purely on the client-side. The backend has database tables for quiz attempts but no routes to interact with them.
*   **Direct Path Bypass:** The course learn view (`LearnPage` at `frontend/src/app/learn/[courseId]/[chapterId]/page.js`) bypasses the quiz entirely. Once a user completes the video and document tabs, the "AI Oral Assessment" button links directly to the interview view (`/interview/{courseId}/{chapterId}`), skipping the theoretical checkpoint.
*   **JWT Env Bypass:** Variables `SECRET_KEY`, `ALGORITHM`, and `TOKEN_EXPIRE_HOURS` are hardcoded in the auth dependencies, posing a security risk and configuration bypass.
*   **Telemetry Warning:** The Next.js client dev command outputs standard anonymous telemetry collecting alerts on startup.

---

## 7. How to Run Locally

### Step 1: Set Up Backend
1.  Navigate to the backend directory:
    ```bash
    cd backend
    ```
2.  Activate the pre-installed Python virtual environment in the workspace root:
    ```bash
    source ../.venv/bin/activate
    ```
3.  Ensure `.env` configuration file exists and contains the correct database URL and API keys:
    ```ini
    DATABASE_URL=postgresql+psycopg://postgres.jspkxmjnyenlkxhorzus:Clashofclan%4011@aws-1-us-east-1.pooler.supabase.com:5432/postgres
    GROQ_API_KEY=gsk_...
    GROQ_MODEL=llama-3.3-70b-versatile
    ```
4.  Launch the FastAPI development server:
    ```bash
    python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload
    ```

### Step 2: Set Up Frontend
1.  Navigate to the frontend directory:
    ```bash
    cd ../frontend
    ```
2.  Launch the Next.js development server:
    ```bash
    npm run dev
    ```
3.  Access the web application at `http://localhost:3000`.

---

## 8. Suggested Next Steps

Here is the prioritized engineering list of what to build and fix next:

1.  **Dynamize the Quiz Component (High Priority):**
    *   *Backend:* Implement a new router for quiz operations. Create endpoints `GET /api/quiz/{chapter_id}` (use LLM to generate 5 multiple-choice questions from the chapter content if no quiz exists) and `POST /api/quiz/submit` (evaluate answers, save row to `quiz_attempts`).
    *   *Frontend:* Replace `MOCK_QUESTIONS` in `quiz/page.js` with API calls using `authFetch` to load and submit the quiz.
2.  **Enforce the Correct Progression Pipeline (High Priority):**
    *   *Frontend:* Update the Learn page tabs to direct students to the Quiz before starting the AI Oral Assessment. Require passing the quiz (meeting the pass threshold) before unlocking the oral assessment button.
3.  **Refactor Security & Constants (Medium Priority):**
    *   In `backend/app/auth/dependencies.py` and `backend/app/routers/auth.py`, load `SECRET_KEY`, `ALGORITHM`, and `TOKEN_EXPIRE_HOURS` from environment variables using `os.getenv` instead of using hardcoded string fallbacks.
4.  **Integrate Automatic YouTube Transcriber (Medium Priority):**
    *   Add `youtube-transcript-api` to the backend dependencies.
    *   Add an asynchronous processing task or utility in the backend to automatically fetch and save the transcript when a teacher creates a module with a YouTube URL, removing the manual copy-paste bottleneck.
5.  **Implement Vector Search RAG (Low Priority):**
    *   Add a local vector store or use PostgreSQL `pgvector` extensions on Supabase.
    *   Chunk the chapter article and transcript on creation and embed them. Update the LangGraph pipeline to perform semantic search to feed relevant chunks to the prompt rather than sending sliced raw strings.
