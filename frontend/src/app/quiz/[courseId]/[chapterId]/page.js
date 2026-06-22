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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);

  useEffect(() => {
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
  }, [params.chapterId]);

  const handleSelect = (qId, option) => {
    if (!submitted) setAnswers((prev) => ({ ...prev, [String(qId)]: option }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    setError("");
    try {
      const res = await authFetch("/api/quiz/submit", {
        method: "POST",
        body: JSON.stringify({ chapter_id: params.chapterId, answers }),
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

  const handleRetry = () => {
    setSubmitted(false);
    setResult(null);
    setAnswers({});
    setCurrentQ(0);
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "80px 32px", textAlign: "center" }}>
            <p style={{ color: "var(--text-muted)" }}>Generating quiz questions...</p>
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

  if (submitted && result) {
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
                <span className="badge badge-success">PASSED - ORAL ASSESSMENT UNLOCKED</span>
              ) : (
                <span className="badge badge-danger">FAILED - REVIEW THE MODULE AND RETRY</span>
              )}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
              {result.results.map((r) => {
                const q = questions.find((q) => String(q.id) === String(r.id));
                return (
                  <div className="card" key={r.id} style={{ padding: "16px 20px", backgroundColor: "#ffffff", borderLeft: `4px solid ${r.correct ? "var(--color-success)" : "var(--color-danger)"}` }}>
                    <div style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--text-title)", marginBottom: "8px" }}>
                      {r.id}. {q?.question}
                    </div>
                    <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                      <span>Your answer: <strong style={{ color: r.correct ? "var(--color-success)" : "var(--color-danger)" }}>{r.selected || "NONE"}</strong></span>
                      {!r.correct && (<span>Correct: <strong style={{ color: "var(--color-success)" }}>{r.correct_answer}</strong></span>)}
                    </div>
                  </div>
                );
              })}
            </div>
            <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
              {result.passed ? (
                <Link href={`/interview/${params.courseId}/${params.chapterId}`} className="btn btn-primary">Initialize Oral Assessment</Link>
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

  const q = questions[currentQ];
  if (!q) return null;
  const allAnswered = Object.keys(answers).length >= questions.length;

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK</span>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>Module Quiz</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Answer all {questions.length} questions before entering the AI oral assessment.</p>
          </div>
          <div className="flex-between" style={{ marginBottom: "8px" }}>
            <span className="badge badge-accent">Question {currentQ + 1} of {questions.length}</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontWeight: "500" }}>{Object.keys(answers).length} answered</span>
          </div>
          <div className="progress-bar-container" style={{ marginBottom: "32px" }}>
            <div className="progress-bar-fill" style={{ width: `${((currentQ + 1) / questions.length) * 100}%` }} />
          </div>
          <div className="card" style={{ padding: "32px", marginBottom: "24px", backgroundColor: "#ffffff" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "24px", lineHeight: "1.4" }}>{q.question}</h2>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {Object.entries(q.options).map(([key, val]) => {
                const selected = answers[String(q.id)] === key;
                return (
                  <div key={key} onClick={() => handleSelect(q.id, key)} style={{ padding: "14px 18px", borderRadius: "var(--radius-sm)", cursor: "pointer", border: `1px solid ${selected ? "var(--brand)" : "var(--border-muted)"}`, backgroundColor: selected ? "var(--brand-muted)" : "#ffffff", fontSize: "14px" }}>
                    <span style={{ fontWeight: "700", marginRight: "12px", color: selected ? "var(--brand)" : "var(--text-muted)" }}>{key}</span>
                    {val}
                  </div>
                );
              })}
            </div>
          </div>
          {error && <p style={{ color: "var(--color-danger)", marginBottom: "12px", textAlign: "center", fontSize: "13px" }}>{error}</p>}
          <div className="flex-between">
            <button className="btn btn-secondary" disabled={currentQ === 0} onClick={() => setCurrentQ((p) => p - 1)}>Previous</button>
            {currentQ < questions.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setCurrentQ((p) => p + 1)}>Next</button>
            ) : (
              <button className="btn btn-success" onClick={handleSubmit} disabled={submitting || !allAnswered}>{submitting ? "Submitting..." : "Submit check"}</button>
            )}
          </div>
          {!allAnswered && currentQ === questions.length - 1 && (
            <p style={{ textAlign: "center", marginTop: "12px", fontSize: "12px", color: "var(--text-muted)" }}>Answer all {questions.length} questions before submitting.</p>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(QuizPage);