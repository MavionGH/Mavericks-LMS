"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

function QuizPage() {
  const params = useParams();
  const { authFetch } = useAuth();

  const [questions, setQuestions] = useState([]);
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Fetch questions from backend
  useEffect(() => {
    async function loadQuestions() {
      setLoading(true);
      setError("");
      try {
        const res = await authFetch(`/api/quiz/${params.chapterId}`);
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.detail || "Failed to load quiz");
        }
        const data = await res.json();
        setQuestions(data);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    loadQuestions();
  }, [params.chapterId, authFetch]);

  const handleSelect = (qId, option) => {
    if (!submitted) setAnswers((prev) => ({ ...prev, [qId]: option }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const res = await authFetch("/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({
          chapter_id: params.chapterId,
          answers: answers,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to submit quiz");
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

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "80px 32px", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>Generating quiz questions…</p>
          </div>
        </div>
      </>
    );
  }

  if (error && !submitted) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
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

  // ── Results view ──
  if (submitted && result) {
    const score = result.score;
    const passed = result.passed;

    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK COMPLETE</span>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px", letterSpacing: "-0.01em" }}>Quiz Results</h1>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                {result.correct_count} of {result.total_questions} correct · Threshold: {result.pass_threshold}%
              </p>
            </div>
            
            <div className="card" style={{ padding: "32px", textAlign: "center", marginBottom: "24px", backgroundColor: "#ffffff" }}>
              <div className="mono" style={{ fontSize: "36px", fontWeight: "700", color: passed ? "var(--color-success)" : "var(--color-danger)", marginBottom: "8px" }}>{score}%</div>
              <div className="progress-bar-container" style={{ height: 6, margin: "16px auto", maxWidth: 320 }}>
                <div className="progress-bar-fill" style={{ width: `${score}%`, backgroundColor: passed ? "var(--color-success)" : "var(--color-danger)" }} />
              </div>
              <div style={{ marginTop: "12px" }}>
                {passed ? (
                  <span className="badge badge-success">GRADE THRESHOLD MET — ORAL ASSESSMENT UNLOCKED</span>
                ) : (
                  <span className="badge badge-danger">FAILED — REQUIRED THRESHOLD: {result.pass_threshold}%</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
              {result.details.map((d, i) => (
                <div className="card" key={d.question_id} style={{ padding: "16px 20px", backgroundColor: "#ffffff", borderLeft: `4px solid ${d.is_correct ? "var(--color-success)" : "var(--color-danger)"}` }}>
                  <div style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--text-title)", marginBottom: "8px" }}>{i + 1}. {d.question_text}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                    <span>Selected: <strong style={{ color: d.is_correct ? "var(--color-success)" : "var(--color-danger)", fontFamily: "JetBrains Mono" }}>{d.selected || "NONE"}</strong></span>
                    {!d.is_correct && (
                      <span>Correct: <strong style={{ color: "var(--color-success)", fontFamily: "JetBrains Mono" }}>{d.correct}</strong></span>
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              {passed ? (
                <Link href={`/interview/${params.courseId}/${params.chapterId}`} className="btn btn-primary">Initialize Oral Assessment</Link>
              ) : (
                <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-secondary">Review Documentation</Link>
              )}
            </div>
          </div>
        </div>
      </>
    );
  }

  // ── Question view ──
  const q = questions[currentQ];
  if (!q) return null;

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK</span>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px", letterSpacing: "-0.01em" }}>Chapter Quiz</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Evaluate your theoretical comprehension before entering the AI oral gate.</p>
          </div>

          <div className="flex-between" style={{ marginBottom: "8px" }}>
            <span className="badge badge-accent">Question {currentQ + 1} of {questions.length}</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontWeight: "500" }}>{Object.keys(answers).length} answered</span>
          </div>
          <div className="progress-bar-container" style={{ marginBottom: "32px" }}>
            <div className="progress-bar-fill" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>

          <div className="card" style={{ padding: "32px", marginBottom: "24px", backgroundColor: "#ffffff" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "24px", lineHeight: "1.4" }}>{q.question_text}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {Object.entries(q.options).map(([key, val]) => (
                <div key={key} onClick={() => handleSelect(q.id, key)}
                  style={{
                    padding: "14px 18px",
                    borderRadius: "var(--radius-sm)",
                    cursor: "pointer",
                    border: `1px solid ${answers[q.id] === key ? "var(--brand)" : "var(--border-muted)"}`,
                    backgroundColor: answers[q.id] === key ? "var(--brand-muted)" : "#ffffff",
                    transition: "var(--transition-fast)",
                    fontSize: "14px",
                  }}>
                  <span className="mono" style={{ fontWeight: "700", marginRight: "12px", color: answers[q.id] === key ? "var(--brand)" : "var(--text-muted)" }}>{key}</span>
                  {val}
                </div>
              ))}
            </div>
          </div>

          <div className="flex-between">
            <button className="btn btn-secondary" disabled={currentQ === 0} onClick={() => setCurrentQ((p) => p - 1)}>Previous</button>
            {currentQ < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setCurrentQ((p) => p + 1)}>Next</button>
            ) : (
              <button className="btn btn-success" onClick={handleSubmit} disabled={submitting}>
                {submitting ? "Submitting…" : "Submit check"}
              </button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(QuizPage);
