"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState } from "react";
import { useParams } from "next/navigation";
import { withAuth } from "@/components/withAuth";

const MOCK_QUESTIONS = [
  { id: 1, question: "What is the primary difference in scoping between let and var?", options: { A: "let is function-scoped, var is block-scoped", B: "let is block-scoped, var is function-scoped", C: "They behave identically in all environments", D: "var declarations bypass block statements entirely" }, correct: "B" },
  { id: 2, question: "Which of the following is evaluated as a primitive type in JavaScript?", options: { A: "Array", B: "Object", C: "Float", D: "Symbol" }, correct: "D" },
  { id: 3, question: "What structural mutation does 'const' prevent?", options: { A: "Modification of nested object properties", B: "Reassignment of the variable reference identifier", C: "Array element additions", D: "Garbage collection allocation cycles" }, correct: "B" },
  { id: 4, question: "What is returned when checking typeof null?", options: { A: "null", B: "undefined", C: "object", D: "boolean" }, correct: "C" },
  { id: 5, question: "Which declaration keyword establishes a variable bounded to the temporal dead zone?", options: { A: "var", B: "function", C: "let", D: "global" }, correct: "C" },
];

function QuizPage() {
  const params = useParams();
  const [currentQ, setCurrentQ] = useState(0);
  const [answers, setAnswers] = useState({});
  const [submitted, setSubmitted] = useState(false);

  const handleSelect = (qId, option) => {
    if (!submitted) setAnswers((prev) => ({ ...prev, [qId]: option }));
  };

  const handleSubmit = () => setSubmitted(true);

  const score = submitted
    ? Math.round((MOCK_QUESTIONS.filter((q) => answers[q.id] === q.correct).length / MOCK_QUESTIONS.length) * 100)
    : 0;
  const passed = score >= 70;

  if (submitted) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK COMPLETE</span>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px", letterSpacing: "-0.01em" }}>Quiz Results</h1>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Module 01: Variables & Data Types</p>
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
                  <span className="badge badge-danger">FAILED — REQUIRED THRESHOLD: 70%</span>
                )}
              </div>
            </div>

            <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginBottom: "32px" }}>
              {MOCK_QUESTIONS.map((q, i) => (
                <div className="card" key={q.id} style={{ padding: "16px 20px", backgroundColor: "#ffffff", borderLeft: `4px solid ${answers[q.id] === q.correct ? "var(--color-success)" : "var(--color-danger)"}` }}>
                  <div style={{ fontWeight: "700", fontSize: "14.5px", color: "var(--text-title)", marginBottom: "8px" }}>{i + 1}. {q.question}</div>
                  <div style={{ fontSize: "13px", color: "var(--text-muted)", display: "flex", gap: "16px" }}>
                    <span>Selected: <strong style={{ color: answers[q.id] === q.correct ? "var(--color-success)" : "var(--color-danger)", fontFamily: "JetBrains Mono" }}>{answers[q.id] || "NONE"}</strong></span>
                    {answers[q.id] !== q.correct && (
                      <span>Correct: <strong style={{ color: "var(--color-success)", fontFamily: "JetBrains Mono" }}>{q.correct}</strong></span>
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

  const q = MOCK_QUESTIONS[currentQ];

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px", maxWidth: 680 }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>CONCEPT CHECK</span>
            <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px", letterSpacing: "-0.01em" }}>Variables & Data Types</h1>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>Evaluate your theoretical comprehension before entering the AI oral gate.</p>
          </div>

          <div className="flex-between" style={{ marginBottom: "8px" }}>
            <span className="badge badge-accent">Question {currentQ + 1} of {MOCK_QUESTIONS.length}</span>
            <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontWeight: "500" }}>{Object.keys(answers).length} answered</span>
          </div>
          <div className="progress-bar-container" style={{ marginBottom: "32px" }}>
            <div className="progress-bar-fill" style={{ width: `${((currentQ + 1) / MOCK_QUESTIONS.length) * 100}%` }} />
          </div>

          <div className="card" style={{ padding: "32px", marginBottom: "24px", backgroundColor: "#ffffff" }}>
            <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "24px", lineHeight: "1.4" }}>{q.question}</h2>
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
            {currentQ < MOCK_QUESTIONS.length - 1 ? (
              <button className="btn btn-primary" onClick={() => setCurrentQ((p) => p + 1)}>Next</button>
            ) : (
              <button className="btn btn-success" onClick={handleSubmit}>Submit check</button>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(QuizPage);
