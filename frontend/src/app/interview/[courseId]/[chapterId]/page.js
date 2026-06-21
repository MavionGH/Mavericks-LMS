"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

function InterviewPage() {
  const params = useParams();
  const router = useRouter();
  const { user, authFetch } = useAuth();

  const [sessionId, setSessionId] = useState(null);
  const [chapterTitle, setChapterTitle] = useState("");
  const [transcript, setTranscript] = useState([]);
  const [currentAIText, setCurrentAIText] = useState("");
  const [waitingForStudent, setWaitingForStudent] = useState(false);
  const [micActive, setMicActive] = useState(false);
  const [cameraActive, setCameraActive] = useState(true);
  const [showCaptions, setShowCaptions] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [questionNum, setQuestionNum] = useState(1);
  const [status, setStatus] = useState("CONNECTING");

  const recognitionRef = useRef(null);
  const questionStartRef = useRef(null);
  const pauseCountRef = useRef(0);
  const longPauseMsRef = useRef(0);
  const lastSpeechRef = useRef(Date.now());
  const silenceTimerRef = useRef(null);
  const submittingRef = useRef(false);

  const studentInitials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "ST";

  const speakText = useCallback((text) => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1;
    window.speechSynthesis.speak(utter);
  }, []);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const eligRes = await authFetch(`/api/interview/eligibility/${params.chapterId}`);
      const elig = await eligRes.json();
      if (!elig.eligible) {
        setError(elig.reason || "Not eligible for interview");
        setLoading(false);
        return;
      }

      const res = await authFetch("/api/interview/start", {
        method: "POST",
        body: JSON.stringify({ chapter_id: params.chapterId }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to start interview");
      }
      const data = await res.json();
      setSessionId(data.session_id);
      setCurrentAIText(data.text);
      setQuestionNum(data.question_number);
      setTranscript([{ speaker: "ai", text: data.text }]);
      setWaitingForStudent(true);
      setStatus("WAITING FOR YOU");
      speakText(data.text);
      questionStartRef.current = Date.now();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [authFetch, params.chapterId, speakText]);

  useEffect(() => {
    startSession();
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    };
  }, [startSession]);

  const submitAnswer = async (answerText) => {
    if (submittingRef.current || !sessionId || !answerText.trim()) return;
    submittingRef.current = true;
    setStatus("AI PROCESSING");
    setWaitingForStudent(false);

    const responseTime = questionStartRef.current
      ? Date.now() - questionStartRef.current
      : 0;

    setTranscript((prev) => [...prev, { speaker: "student", text: answerText }]);
    setLiveTranscript("");

    try {
      const res = await authFetch("/api/interview/answer", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          answer_text: answerText,
          response_time_ms: responseTime,
          pause_count: pauseCountRef.current,
          long_pause_ms: longPauseMsRef.current,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to submit answer");
      }
      const data = await res.json();

      pauseCountRef.current = 0;
      longPauseMsRef.current = 0;

      if (data.passed !== undefined) {
        setResults(data);
        setIsFinished(true);
        setStatus("COMPLETE");
        speakText(
          data.passed
            ? "Congratulations! You passed the assessment."
            : "You did not pass. Please review the module and try again."
        );
      } else {
        setCurrentAIText(data.text);
        setQuestionNum(data.question_number);
        setTranscript((prev) => [...prev, { speaker: "ai", text: data.text }]);
        setWaitingForStudent(true);
        setStatus("WAITING FOR YOU");
        speakText(data.text);
        questionStartRef.current = Date.now();
      }
    } catch (err) {
      setError(err.message);
      setWaitingForStudent(true);
      setStatus("ERROR");
    } finally {
      submittingRef.current = false;
    }
  };

  const startListening = () => {
    const SpeechRecognition =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setError("Speech recognition not supported. Type your answer below.");
      return;
    }

    if (recognitionRef.current) {
      recognitionRef.current.stop();
    }

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    let finalText = "";
    pauseCountRef.current = 0;
    longPauseMsRef.current = 0;
    lastSpeechRef.current = Date.now();

    recognition.onresult = (event) => {
      lastSpeechRef.current = Date.now();
      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalText += t + " ";
        } else {
          interim += t;
        }
      }
      setLiveTranscript(finalText + interim);

      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = setTimeout(() => {
        const gap = Date.now() - lastSpeechRef.current;
        if (gap > 3000) {
          pauseCountRef.current += 1;
          longPauseMsRef.current += gap;
        }
      }, 3100);
    };

    recognition.onerror = () => setMicActive(false);
    recognition.onend = () => setMicActive(false);

    recognitionRef.current = recognition;
    recognition.start();
    setMicActive(true);
    setStatus("LISTENING");
  };

  const stopListeningAndSubmit = () => {
    if (recognitionRef.current) recognitionRef.current.stop();
    setMicActive(false);
    const answer = liveTranscript.trim();
    if (answer) {
      setTypedAnswer("");
      submitAnswer(answer);
    }
  };

  const handleToggleMic = () => {
    if (!waitingForStudent || submittingRef.current) return;
    if (micActive) {
      stopListeningAndSubmit();
    } else {
      startListening();
    }
  };

  const handleEndCall = async () => {
    if (!sessionId) return;
    try {
      const res = await authFetch(`/api/interview/end/${sessionId}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to end interview");
      const data = await res.json();
      setResults(data);
      setIsFinished(true);
    } catch (err) {
      setError(err.message);
    }
  };

  const [typedAnswer, setTypedAnswer] = useState("");

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "120px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>Initializing AI oral assessment…</p>
        </div>
      </>
    );
  }

  if (error && !sessionId) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "120px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)", marginBottom: "16px" }}>{error}</p>
          <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-primary">
            Return to module
          </Link>
        </div>
      </>
    );
  }

  if (isFinished && results) {
    const passThreshold = 70;
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "48px 32px", maxWidth: 720 }}>
            <div style={{ textAlign: "center", marginBottom: "32px" }}>
              <span className={`badge ${results.passed ? "badge-success" : "badge-warning"}`} style={{ marginBottom: "8px" }}>
                {results.passed ? "PASSED" : "NEEDS REVIEW"}
              </span>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                Oral Assessment Complete
              </h1>
              <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>{results.chapter_title}</p>
            </div>

            <div className="score-grid">
              <div className="card score-card" style={{ backgroundColor: "#ffffff" }}>
                <div className="score-number">{Math.round(results.technical_score)}%</div>
                <div className="score-label">Technical Precision</div>
              </div>
              <div className="card score-card" style={{ backgroundColor: "#ffffff" }}>
                <div className="score-number">{Math.round(results.communication_score)}%</div>
                <div className="score-label">Speech Structure</div>
              </div>
              <div className="card score-card" style={{ backgroundColor: "#ffffff" }}>
                <div className="score-number">{Math.round(results.confidence_score)}%</div>
                <div className="score-label">Confidence Index</div>
              </div>
            </div>

            <div className="card" style={{ padding: "24px", marginBottom: "24px", backgroundColor: "#ffffff" }}>
              <div className="flex-between" style={{ marginBottom: "12px" }}>
                <span style={{ fontWeight: "700", fontSize: "15px" }}>Composite Score</span>
                <span className="mono" style={{ fontSize: "18px", fontWeight: "700", color: results.passed ? "var(--color-success)" : "var(--color-warning)" }}>
                  {results.overall_score}%
                </span>
              </div>
              <div className="progress-bar-container" style={{ height: 6, marginBottom: "16px" }}>
                <div className="progress-bar-fill" style={{ width: `${results.overall_score}%`, backgroundColor: results.passed ? "var(--color-success)" : "var(--color-warning)" }} />
              </div>
              <div className="flex-between">
                <span className={`badge ${results.passed ? "badge-success" : "badge-warning"}`}>
                  {results.passed ? `GRADE EXCEEDS PASS REQUIREMENT (${passThreshold}%)` : `BELOW PASS REQUIREMENT (${passThreshold}%)`}
                </span>
                <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontWeight: "600" }}>
                  {results.next_chapter_unlocked ? "NEXT MODULE UNLOCKED" : results.passed ? "COURSE COMPLETE" : "REVIEW MODULE REQUIRED"}
                </span>
              </div>
            </div>

            {!results.passed && results.suggested_review?.length > 0 && (
              <div className="card" style={{ padding: "24px", marginBottom: "24px", backgroundColor: "#fff8f0", border: "1px solid var(--color-warning)" }}>
                <h4 style={{ color: "var(--color-warning)", fontSize: "13px", fontWeight: "700", marginBottom: "12px" }}>Required Review</h4>
                <ul style={{ fontSize: "13.5px", paddingLeft: "16px" }}>
                  {results.suggested_review.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                <Link href={`/learn/${params.courseId}/${params.chapterId}`} className="btn btn-secondary" style={{ marginTop: "16px" }}>
                  Re-watch module video &amp; article
                </Link>
              </div>
            )}

            <div className="grid-2" style={{ marginBottom: "32px" }}>
              <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                <h4 style={{ color: "var(--color-success)", fontSize: "13px", fontWeight: "700", marginBottom: "12px", textTransform: "uppercase" }}>Key Strengths</h4>
                <ul style={{ fontSize: "13.5px", paddingLeft: "16px", lineHeight: "1.7" }}>
                  {(results.strengths || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
              <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                <h4 style={{ color: "var(--color-warning)", fontSize: "13px", fontWeight: "700", marginBottom: "12px", textTransform: "uppercase" }}>Areas to Refine</h4>
                <ul style={{ fontSize: "13.5px", paddingLeft: "16px", lineHeight: "1.7" }}>
                  {(results.weak_areas || []).map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            </div>

            <div style={{ textAlign: "center", display: "flex", gap: "12px", justifyContent: "center" }}>
              {results.next_chapter_unlocked && (
                <button
                  className="btn btn-primary"
                  onClick={() => router.push(`/learn/${params.courseId}`)}
                >
                  Continue to next module
                </button>
              )}
              <Link href="/dashboard" className="btn btn-secondary">Return to workspace</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  const isAISpeaking = !waitingForStudent && !micActive;
  const captionText = micActive ? liveTranscript : currentAIText;
  const captionSpeaker = micActive ? "You (Speaking)" : "AI Assessor";

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "#121212", paddingTop: "80px", paddingBottom: "32px", minHeight: "100vh" }}>
        <div className="container meet-layout">
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="badge badge-accent" style={{ backgroundColor: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.2)", color: "#8ab4f8", marginBottom: "6px" }}>
                LIVE AI INTERVIEW — Q{questionNum}/5
              </span>
              <h1 style={{ fontSize: "20px", fontWeight: "600", color: "#ffffff", margin: 0 }}>
                Module Oral Assessment
              </h1>
            </div>
            <span style={{ fontSize: "12px", color: "#e8eaed", backgroundColor: "#202124", padding: "6px 12px", borderRadius: "16px", border: "1px solid #3c4043", fontFamily: "JetBrains Mono" }}>
              STATUS: {status}
            </span>
          </div>

          <div className="meet-grid">
            <div className={`meet-panel ${isAISpeaking ? "speaking" : ""}`}>
              <div className="meet-avatar">AI</div>
              <div className="meet-nametag">
                <span className="meet-nametag-icon">
                  {isAISpeaking ? (
                    <div className="meet-wave">
                      {[0, 1, 2, 3].map((i) => <div key={i} className="meet-wave-bar" />)}
                    </div>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                      <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                    </svg>
                  )}
                </span>
                <span>AI Assessor (Module Host)</span>
              </div>
            </div>

            <div className={`meet-panel meet-panel-student ${micActive ? "speaking" : ""}`}>
              {cameraActive ? (
                <div className="meet-avatar">{studentInitials}</div>
              ) : (
                <div style={{ color: "#94a3b8", fontSize: "14px" }}>Camera Disabled</div>
              )}
              <div className="meet-nametag">
                <span className="meet-nametag-icon">
                  {micActive ? (
                    <div className="meet-wave">
                      {[0, 1, 2, 3].map((i) => (
                        <div key={i} className="meet-wave-bar" style={{ backgroundColor: "#81c995" }} />
                      ))}
                    </div>
                  ) : (
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f28b82" strokeWidth="2">
                      <line x1="1" y1="1" x2="23" y2="23" />
                      <path d="M9 9v3a3 3 0 0 0 5.12 2.12M15 9.34V4a3 3 0 0 0-5.94-.6" />
                    </svg>
                  )}
                </span>
                <span>{user?.name || "Student"} (You)</span>
              </div>
            </div>
          </div>

          {showCaptions && captionText && (
            <div className="meet-captions-overlay">
              <div>
                <span className="meet-captions-speaker">{captionSpeaker}</span>
                <span>{captionText}</span>
              </div>
            </div>
          )}

          {error && (
            <div style={{ color: "#f28b82", fontSize: "13px", textAlign: "center", marginTop: "8px" }}>{error}</div>
          )}

          {/* Fallback text input when speech not available */}
          {waitingForStudent && (
            <div style={{ marginTop: "16px", display: "flex", gap: "8px", maxWidth: "600px", margin: "16px auto 0" }}>
              <input
                className="form-input"
                placeholder="Type your answer if mic doesn't work…"
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typedAnswer.trim()) {
                    submitAnswer(typedAnswer);
                    setTypedAnswer("");
                  }
                }}
                style={{ flex: 1, background: "#202124", borderColor: "#3c4043", color: "#fff" }}
              />
              <button className="btn btn-secondary btn-sm" onClick={() => { if (typedAnswer.trim()) { submitAnswer(typedAnswer); setTypedAnswer(""); } }}>
                Send
              </button>
            </div>
          )}

          <div className="meet-bottom-bar">
            <div className="meet-bar-info">
              {waitingForStudent ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>➔ Turn on mic to answer (click again to submit)</span>
              ) : (
                <span style={{ color: "#9aa0a6" }}>AI is processing your response…</span>
              )}
            </div>

            <div className="meet-bar-actions">
              <button onClick={handleToggleMic} className={`meet-action-btn ${!micActive && waitingForStudent ? "" : micActive ? "" : "active-off"}`} title="Microphone">
                {micActive ? "🎤" : "🔇"}
              </button>
              <button onClick={() => setCameraActive((p) => !p)} className={`meet-action-btn ${!cameraActive ? "active-off" : ""}`} title="Camera">
                📷
              </button>
              <button onClick={() => setShowCaptions((p) => !p)} className={`meet-action-btn ${!showCaptions ? "active-off" : ""}`} title="Captions">
                CC
              </button>
              <button onClick={handleEndCall} className="meet-action-btn meet-action-btn-end" title="End Call & Score">
                📞
              </button>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(InterviewPage);
