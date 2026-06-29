"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useQuizGuard } from "./useQuizGuard";
import { FullscreenWarningOverlay } from "./FullscreenWarningOverlay";

// ─── Helper: fire-and-forget warning log to backend ──────────────────────────
async function logWarning(authFetch, type, code, message) {
  try {
    await authFetch("/api/quiz/log-warning", {
      method: "POST",
      body: JSON.stringify({ type, code, message, timestamp: new Date().toISOString() }),
    });
  } catch {
    // Non-critical — best-effort logging only
  }
}

// ─── Toast component (inline, no extra dep) ───────────────────────────────────
function Toast({ message, onDismiss }) {
  useEffect(() => {
    if (!message) return;
    const id = setTimeout(onDismiss, 3500);
    return () => clearTimeout(id);
  }, [message, onDismiss]);

  if (!message) return null;
  return (
    <div className="quiz-toast" role="alert" aria-live="polite">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
        <circle cx="12" cy="12" r="10"/>
        <line x1="12" y1="8" x2="12" y2="12"/>
        <line x1="12" y1="16" x2="12.01" y2="16"/>
      </svg>
      {message}
    </div>
  );
}

// ─── Pre-quiz rules modal shown before entering fullscreen ────────────────────
function RulesModal({ onAccept }) {
  return (
    <div className="quiz-overlay" style={{ cursor: "default" }}>
      <div className="overlay-card" style={{ maxWidth: "36rem", cursor: "default" }}>
        <div className="overlay-icon overlay-icon-brand" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
          </svg>
        </div>
        <div className="overlay-badge">ACADEMIC INTEGRITY POLICY</div>
        <h2 className="overlay-title">Quiz Anti-Cheating Rules</h2>
        <p className="overlay-body">
          This quiz is protected by an integrity system. By clicking <strong>Start Quiz</strong> you
          agree to the following conditions:
        </p>
        <div className="overlay-rules">
          <ul>
            <li>The quiz runs in <strong>fullscreen mode</strong>. Exiting fullscreen will result in <strong>0 marks</strong> for the current question and an automatic advance to the next question.</li>
            <li><strong>Copy, paste, cut</strong> operations and <strong>right-click</strong> are disabled throughout the quiz.</li>
            <li>Common <strong>keyboard shortcuts</strong> (Ctrl+C/V/X/A, F12, DevTools) are blocked.</li>
            <li>All violations are <strong>logged and timestamped</strong> for instructor review.</li>
            <li>Each question has a <strong>30-second time limit</strong>. Unanswered questions score 0.</li>
          </ul>
        </div>
        <button
          id="quiz-start-btn"
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center" }}
          onClick={onAccept}
        >
          I Understand — Start Quiz in Fullscreen
        </button>
      </div>
    </div>
  );
}

// ─── Timer ring ───────────────────────────────────────────────────────────────
const QUIZ_TIME_LIMIT = 30; // seconds per question

function TimerRing({ remaining, total }) {
  const pct = remaining / total;
  const radius = 22;
  const circ = 2 * Math.PI * radius;
  const offset = circ * (1 - pct);
  const color = remaining <= 5 ? "var(--color-danger)" : remaining <= 10 ? "var(--color-warning)" : "var(--brand)";

  return (
    <div className="quiz-timer-ring" aria-label={`${remaining} seconds remaining`}>
      <svg width="60" height="60" viewBox="0 0 60 60">
        <circle cx="30" cy="30" r={radius} fill="none" stroke="var(--border-muted)" strokeWidth="4"/>
        <circle
          cx="30" cy="30" r={radius}
          fill="none" stroke={color} strokeWidth="4"
          strokeDasharray={circ}
          strokeDashoffset={offset}
          strokeLinecap="round"
          transform="rotate(-90 30 30)"
          style={{ transition: "stroke-dashoffset 0.25s linear, stroke 0.3s" }}
        />
      </svg>
      <span className="quiz-timer-label" style={{ color }}>{remaining}</span>
    </div>
  );
}

// ─── Main Quiz Page ───────────────────────────────────────────────────────────
function QuizPage() {
  const params = useParams();
  const { authFetch } = useAuth();

  // ── Quiz data ──
  const [questions, setQuestions]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [error, setError]           = useState("");
  const [currentQ, setCurrentQ]     = useState(0);
  const [answers, setAnswers]       = useState({});
  const [submitted, setSubmitted]   = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult]         = useState(null);

  // ── Anti-cheating states ──
  const [quizStarted, setQuizStarted]                     = useState(false);   // rules modal accepted?
  const [isFullscreen, setIsFullscreen]                   = useState(false);
  const [fsWarningVisible, setFsWarningVisible]           = useState(false);
  const [fsWarningCount, setFsWarningCount]               = useState(0);
  const [fsMessage, setFsMessage]                         = useState(null);
  const [toastMessage, setToastMessage]                   = useState(null);
  const [fsViolatedQuestions, setFsViolatedQuestions]     = useState([]);

  // ── Refs ──
  const systemExitingFullscreenRef = useRef(false);

  // ── Timer ──
  const [remaining, setRemaining]   = useState(QUIZ_TIME_LIMIT);
  const questionEndRef              = useRef(0); // set before the countdown reads it
  const lastQIndexRef               = useRef(-1);
  const submissionLockRef           = useRef(false);
  const timeoutHandledRef           = useRef(false);

  // ── Fetch questions only once the student starts the quiz ──
  // Questions are generated on-demand by the backend, so we deliberately wait
  // until the rules modal is accepted (quizStarted) — nothing is generated just
  // by opening the page.
  useEffect(() => {
    if (!quizStarted) return;
    async function fetchQuiz() {
      setLoading(true);
      setError("");
      try {
        const res = await authFetch(`/api/quiz/${params.chapterId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Could not load quiz questions");
        }
        const data = await res.json();
        setQuestions(data.questions);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    fetchQuiz();
  }, [params.chapterId, quizStarted, authFetch]);

  // ── Stable callbacks for useQuizGuard ────────────────────────────────────
  const handleFullscreenExit = useCallback(
    (msg) => {
      if (systemExitingFullscreenRef.current) {
        setIsFullscreen(false);
        return;
      }
      setIsFullscreen(false);
      setFsWarningVisible(true);
      setFsWarningCount((n) => n + 1);
      setFsMessage(msg);

      // Penalise: lock submission, log
      if (!submitted && !submissionLockRef.current) {
        submissionLockRef.current = true;
        void logWarning(authFetch, "fullscreen", "fullscreen-exit", msg);
        
        const q = questions[currentQ];
        if (q) {
          const qIdStr = String(q.id);
          setFsViolatedQuestions((prevList) => [...prevList, qIdStr]);
          setAnswers((prev) => ({ ...prev, [qIdStr]: null }));
        }
      }
    },
    [submitted, questions, currentQ, authFetch]
  );

  const handleFullscreenEnter = useCallback(() => {
    setIsFullscreen(true);
    setFsWarningVisible(false);
  }, []);

  const handleToastWarning = useCallback((msg) => {
    setToastMessage(msg);
    void logWarning(authFetch, "clipboard", "clipboard-action", msg);
  }, [authFetch]);

  // ── Wire the guard hook ───────────────────────────────────────────────────
  useQuizGuard({
    enabled: quizStarted && !submitted,
    onFullscreenExit:  handleFullscreenExit,
    onFullscreenEnter: handleFullscreenEnter,
    onToastWarning:    handleToastWarning,
  });

  // ── Resume fullscreen after overlay click ─────────────────────────────────
  const handleResumeFullscreen = useCallback(() => {
    document.documentElement
      .requestFullscreen()
      .then(() => {
        setIsFullscreen(true);
        setFsWarningVisible(false);
      })
      .catch(() => setIsFullscreen(false));
  }, []);

  // ── Countdown timer ───────────────────────────────────────────────────────
  useEffect(() => {
    if (!quizStarted || submitted) return;
    // Don't start (or resume) the countdown until the question is actually on
    // screen. Questions are generated on-demand, so starting the timer at
    // quizStarted would let generation latency silently eat into question 1.
    if (loading || questions.length === 0) return;
    // Pause while any overlay is blocking the quiz
    if (fsWarningVisible) return;

    // Pause timer and show 0 if current question was violated
    const q = questions[currentQ];
    if (q && fsViolatedQuestions.includes(String(q.id))) {
      // Intentional: freeze the timer at 0 while this question is in a violated state.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setRemaining(0);
      return;
    }

    submissionLockRef.current = false;
    timeoutHandledRef.current = false;

    // Reset on question change; resume on overlay dismiss
    if (lastQIndexRef.current !== currentQ) {
      setRemaining(QUIZ_TIME_LIMIT);
      questionEndRef.current = Date.now() + QUIZ_TIME_LIMIT * 1000;
      lastQIndexRef.current  = currentQ;
    } else {
      questionEndRef.current = Date.now() + remaining * 1000;
    }

    const id = window.setInterval(() => {
      const left = Math.max(0, Math.ceil((questionEndRef.current - Date.now()) / 1000));
      setRemaining(left);

      if (left === 0 && !timeoutHandledRef.current) {
        timeoutHandledRef.current = true;
        if (!submissionLockRef.current) {
          submissionLockRef.current = true;
          // Time expired → 0 marks, next question
          const q = questions[currentQ];
          if (q) {
            setAnswers((prev) => ({ ...prev, [String(q.id)]: null }));
          }
          setCurrentQ((n) => {
            const next = Math.min(n + 1, (questions.length || 1) - 1);
            return next;
          });
        }
      }
    }, 250);

    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [quizStarted, submitted, currentQ, fsWarningVisible, loading, questions.length]);

  // ── Answer selection ──────────────────────────────────────────────────────
  const handleSelect = (qId, option) => {
    if (submitted) return;
    // Prevent selection if question is violated
    if (fsViolatedQuestions.includes(String(qId))) return;
    setAnswers((prev) => ({ ...prev, [String(qId)]: option }));
  };

  // ── Quiz submission ───────────────────────────────────────────────────────
  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    // Exit fullscreen cleanly on submit
    if (document.fullscreenElement) {
      systemExitingFullscreenRef.current = true;
      try { await document.exitFullscreen(); } catch { /* ignore */ }
    }
    try {
      // Replace null answers with empty string so backend receives something
      const cleanAnswers = Object.fromEntries(
        Object.entries(answers).map(([k, v]) => [k, v ?? ""])
      );
      const res = await authFetch("/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({ chapter_id: params.chapterId, answers: cleanAnswers }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Submission failed");
      }
      const data = await res.json();
      setResult(data);
      setSubmitted(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  // ── Retry ────────────────────────────────────────────────────────────────
  const handleRetry = () => {
    setSubmitted(false);
    setResult(null);
    setAnswers({});
    setCurrentQ(0);
    setRemaining(QUIZ_TIME_LIMIT);
    setQuizStarted(false);
    setFsWarningCount(0);
    setFsViolatedQuestions([]);
    systemExitingFullscreenRef.current = false;
  };

  // ── Render: loading ───────────────────────────────────────────────────────
  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container">
          <div className="container" style={{ padding: "80px 32px", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>Generating quiz questions…</p>
          </div>
        </div>
      </>
    );
  }

  // ── Render: error ─────────────────────────────────────────────────────────
  if (error && !submitted) {
    return (
      <>
        <Navbar />
        <div className="page-container">
          <div className="container" style={{ padding: "80px 32px", textAlign: "center" }}>
            <p style={{ color: "var(--color-danger)", marginBottom: "16px" }}>{error}</p>
            <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-secondary">
              Back to module
            </Link>
          </div>
        </div>
      </>
    );
  }

  // ── Render: results page ──────────────────────────────────────────────────
  if (submitted && result) {
    const violationTotal = fsWarningCount;
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK COMPLETE</span>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                Quiz Results
              </h1>
            </div>

            {/* Score card */}
            <div className="card" style={{ padding: "32px", textAlign: "center", marginBottom: "24px", backgroundColor: "#ffffff" }}>
              <div className="mono" style={{ fontSize: "36px", fontWeight: "700", color: result.passed ? "var(--color-success)" : "var(--color-danger)", marginBottom: "8px" }}>
                {result.score}%
              </div>
              <div style={{ fontSize: "13px", color: "var(--text-muted)", marginBottom: "12px" }}>
                {result.correct_count} / {result.total} correct
              </div>
              <div className="progress-bar-container" style={{ height: 6, margin: "0 auto 16px", maxWidth: 320 }}>
                <div className="progress-bar-fill" style={{ width: `${result.score}%`, backgroundColor: result.passed ? "var(--color-success)" : "var(--color-danger)" }} />
              </div>
              {result.passed ? (
                <span className="badge badge-success">
                  {result.course_completed
                    ? "PASSED — COURSE COMPLETE"
                    : result.next_chapter_unlocked
                    ? "PASSED — NEXT MODULE UNLOCKED"
                    : "PASSED"}
                </span>
              ) : (
                <span className="badge badge-danger">FAILED — REVIEW THE MODULE AND RETRY</span>
              )}
            </div>

            {/* Integrity report */}
            {violationTotal > 0 && (
              <div className="card quiz-integrity-report" style={{ marginBottom: "24px" }}>
                <div className="quiz-integrity-report-header">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                    <line x1="12" y1="9" x2="12" y2="13"/>
                    <line x1="12" y1="17" x2="12.01" y2="17"/>
                  </svg>
                  Integrity Report
                </div>
                <div className="quiz-integrity-stats">
                  <div className="quiz-integrity-stat">
                    <span className="quiz-integrity-stat-value">{fsWarningCount}</span>
                    <span className="quiz-integrity-stat-label">Fullscreen violations</span>
                  </div>
                  <div className="quiz-integrity-stat">
                    <span className="quiz-integrity-stat-value">{violationTotal}</span>
                    <span className="quiz-integrity-stat-label">Total violations logged</span>
                  </div>
                </div>
              </div>
            )}

            {/* Per-question results */}
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
              {result.results.map((r) => {
                const q = questions.find((q) => String(q.id) === String(r.id));
                return (
                  <div
                    key={r.id}
                    className="card"
                    style={{ padding: "16px 20px", backgroundColor: "#ffffff", borderLeft: `4px solid ${r.correct ? "var(--color-success)" : "var(--color-danger)"}` }}
                  >
                    <div style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--text-title)", marginBottom: "8px" }}>
                      {r.id}. {q?.question}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                      <span>Your answer: <strong style={{ color: r.correct ? "var(--color-success)" : "var(--color-danger)" }}>{r.selected || "NONE"}</strong></span>
                      {!r.correct && <span>Correct: <strong style={{ color: "var(--color-success)" }}>{r.correct_answer}</strong></span>}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Actions */}
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              {result.passed ? (
                result.course_completed ? (
                  <Link href={`/interview/${params.courseId}`} className="btn btn-primary">
                    Take the Final AI Interview
                  </Link>
                ) : result.next_chapter_unlocked ? (
                  <Link href={`/learn/${params.courseId}`} className="btn btn-primary">
                    Continue to Next Module
                  </Link>
                ) : (
                  <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-primary">
                    Back to Module
                  </Link>
                )
              ) : (
                <>
                  <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-secondary">Review Module</Link>
                  <button className="btn btn-primary" onClick={handleRetry}>Retry Quiz</button>
                </>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Render: rules modal (before quiz starts) ──────────────────────────────
  if (!quizStarted) {
    return (
      <>
        <Navbar />
        <RulesModal
          onAccept={() => {
            document.documentElement
              .requestFullscreen()
              .then(() => {
                setIsFullscreen(true);
                setQuizStarted(true);
              })
              .catch(() => {
                setQuizStarted(true);
              });
          }}
        />
      </>
    );
  }

  // ── Render: active quiz ───────────────────────────────────────────────────
  const q = questions[currentQ];
  if (!q) return null;
  const allAnswered = questions.every((item) => answers[String(item.id)] !== undefined);

  return (
    <>
      {/* Anti-cheat overlays */}
      <FullscreenWarningOverlay
        visible={fsWarningVisible}
        message={fsMessage}
        warningCount={fsWarningCount}
        onResumeFullscreen={handleResumeFullscreen}
      />

      {/* Toast */}
      <Toast message={toastMessage} onDismiss={() => setToastMessage(null)} />

      {/* Quiz UI (hidden behind overlays when violations occur) */}
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>

          {/* Header */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK</span>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
              Module Quiz
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Answer all {questions.length} questions. Passing this quiz unlocks the next module.
            </p>
          </div>

          {/* Progress row */}
          <div className="flex-between" style={{ marginBottom: "8px", alignItems: "center" }}>
            <span className="badge badge-accent">Question {currentQ + 1} of {questions.length}</span>
            <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
              {/* Violation badges */}
              {fsWarningCount > 0 && (
                <span className="badge badge-danger" title="Fullscreen violations">
                  {fsWarningCount} FS violation{fsWarningCount > 1 ? "s" : ""}
                </span>
              )}
              <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "500" }}>
                {Object.keys(answers).length} answered
              </span>
            </div>
          </div>

          <div className="progress-bar-container" style={{ marginBottom: "24px" }}>
            <div className="progress-bar-fill" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>

          {/* Timer + question card */}
          <div className="card" style={{ padding: "32px", marginBottom: "24px", backgroundColor: "#ffffff" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", lineHeight: "1.4", flex: 1, paddingRight: "16px" }}>
                {q.question}
              </h2>
              <TimerRing remaining={remaining} total={QUIZ_TIME_LIMIT} />
            </div>

            {/* If question is violated, display a banner inside the card */}
            {fsViolatedQuestions.includes(String(q.id)) && (
              <div style={{
                backgroundColor: "var(--bg-danger)",
                color: "var(--color-danger)",
                border: "1px solid var(--border-danger)",
                padding: "12px 16px",
                borderRadius: "var(--radius-sm)",
                fontSize: "13.5px",
                fontWeight: "600",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "8px"
              }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
                  <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
                  <line x1="12" y1="9" x2="12" y2="13"/>
                  <line x1="12" y1="17" x2="12.01" y2="17"/>
                </svg>
                This question has been marked 0 due to a fullscreen violation.
              </div>
            )}

            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {Object.entries(q.options).map(([key, val]) => {
                const violated = fsViolatedQuestions.includes(String(q.id));
                const selected = answers[String(q.id)] === key;
                return (
                  <div
                    key={key}
                    id={`option-${q.id}-${key}`}
                    onClick={() => handleSelect(q.id, key)}
                    role="button"
                    tabIndex={violated ? -1 : 0}
                    onKeyDown={(e) => e.key === "Enter" && handleSelect(q.id, key)}
                    style={{
                      padding: "14px 18px",
                      borderRadius: "var(--radius-sm)",
                      cursor: violated ? "not-allowed" : "pointer",
                      border: `1px solid ${selected ? "var(--brand)" : "var(--border-muted)"}`,
                      backgroundColor: selected ? "var(--brand-muted)" : "#ffffff",
                      opacity: violated ? 0.65 : 1,
                      fontSize: "14px",
                      transition: "var(--transition-fast)",
                      userSelect: "none",
                    }}
                  >
                    <span style={{ fontWeight: "700", marginRight: "12px", color: selected ? "var(--brand)" : "var(--text-muted)" }}>
                      {key}
                    </span>
                    {val}
                  </div>
                );
              })}
            </div>
          </div>

          {error && <p style={{ color: "var(--color-danger)", marginBottom: "12px", textAlign: "center", fontSize: "13px" }}>{error}</p>}

          {/* Navigation */}
          <div style={{ display: "flex", justifyContent: "flex-end" }}>
            {currentQ < questions.length - 1 ? (
              <button
                className="btn btn-primary"
                onClick={() => setCurrentQ((p) => p + 1)}
                disabled={answers[String(q.id)] === undefined && !fsViolatedQuestions.includes(String(q.id))}
              >
                Next
              </button>
            ) : (
              <button
                id="quiz-submit-btn"
                className="btn btn-success"
                onClick={handleSubmit}
                disabled={submitting || !allAnswered}
              >
                {submitting ? "Submitting…" : "Submit Quiz"}
              </button>
            )}
          </div>

          {!allAnswered && currentQ === questions.length - 1 && (
            <p style={{ textAlign: "center", marginTop: "12px", fontSize: "12px", color: "var(--text-muted)" }}>
              Answer all {questions.length} questions before submitting.
            </p>
          )}

        </div>
      </div>
    </>
  );
}

export default withAuth(QuizPage);