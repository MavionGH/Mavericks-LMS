"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

// Filler words to detect and penalise in scoring
const FILLER_REGEX = /\b(um+|uh+|m+hm+|h+m+|err+|erm+|like|you know|basically|literally|right\?|i mean|kind of|sort of)\b/gi;

function countFillers(text) {
  const matches = text.match(FILLER_REGEX);
  return matches ? matches.length : 0;
}

// Strip filler words from answer text before sending (keeps them counted but not submitted verbatim)
function cleanAnswer(text) {
  return text.replace(FILLER_REGEX, "").replace(/\s{2,}/g, " ").trim();
}

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
  const [showCaptions, setShowCaptions] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [questionNum, setQuestionNum] = useState(1);
  const [status, setStatus] = useState("CONNECTING");
  const [fillerCount, setFillerCount] = useState(0);
  const [typedAnswer, setTypedAnswer] = useState("");

  const recognitionRef = useRef(null);
  const questionStartRef = useRef(null);
  const pauseCountRef = useRef(0);
  const longPauseMsRef = useRef(0);
  const lastSpeechRef = useRef(Date.now());
  const silenceTimerRef = useRef(null);
  const autoSubmitTimerRef = useRef(null);
  const submittingRef = useRef(false);
  const finalTextRef = useRef("");
  const fillerCountRef = useRef(0);
  const startListeningRef = useRef(null);  // ref to break circular dep

  const studentInitials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "ST";

  const speakText = useCallback((text, onEnd) => {
    if (typeof window === "undefined" || !window.speechSynthesis) {
      if (onEnd) onEnd();
      return;
    }
    window.speechSynthesis.cancel();
    const utter = new SpeechSynthesisUtterance(text);
    utter.rate = 0.95;
    utter.pitch = 1.0;
    utter.volume = 1;
    // Prefer a natural-sounding voice if available
    const voices = window.speechSynthesis.getVoices();
    const preferred = voices.find(
      (v) => v.lang === "en-US" && (v.name.includes("Natural") || v.name.includes("Google") || v.name.includes("Samantha"))
    );
    if (preferred) utter.voice = preferred;
    if (onEnd) utter.onend = () => onEnd();
    window.speechSynthesis.speak(utter);
  }, []);

  const submitAnswer = useCallback(async (answerText) => {
    if (submittingRef.current || !sessionId) return;
    const trimmed = answerText.trim();
    if (!trimmed) return;

    // Cancel any pending auto-submit
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);

    submittingRef.current = true;
    setStatus("AI PROCESSING");
    setWaitingForStudent(false);
    setMicActive(false);

    const responseTime = questionStartRef.current ? Date.now() - questionStartRef.current : 0;
    const pauseCount = pauseCountRef.current;
    const longPauseMs = longPauseMsRef.current;
    const fillerWordCount = fillerCountRef.current;

    // Show the raw (filler-included) answer in the UI transcript
    setTranscript((prev) => [...prev, { speaker: "student", text: trimmed }]);
    setLiveTranscript("");
    setFillerCount(0);

    // Send cleaned answer (fillers removed) to backend for fairer technical scoring
    const cleaned = cleanAnswer(trimmed);

    try {
      const res = await authFetch("/api/interview/answer", {
        method: "POST",
        body: JSON.stringify({
          session_id: sessionId,
          answer_text: cleaned || trimmed,
          response_time_ms: responseTime,
          pause_count: pauseCount,
          long_pause_ms: longPauseMs,
          filler_word_count: fillerWordCount,
        }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Failed to submit answer");
      }
      const data = await res.json();

      // Reset metrics for next answer
      pauseCountRef.current = 0;
      longPauseMsRef.current = 0;
      fillerCountRef.current = 0;
      finalTextRef.current = "";

      if (data.passed !== undefined) {
        setResults(data);
        setIsFinished(true);
        setStatus("COMPLETE");
        speakText(
          data.passed
            ? "Congratulations! You passed the assessment. Thank you for completing the interview. Take care and goodbye!"
            : "You did not pass. Please review the module and try again. Thank you for participating. Take care and goodbye!"
        );
      } else {
        setCurrentAIText(data.text);
        // Only advance question counter if it was a real interview answer, not chitchat
        if (!data.is_chitchat) {
          setQuestionNum(data.question_number);
        }
        setTranscript((prev) => [...prev, { speaker: "ai", text: data.text }]);
        setStatus("AI SPEAKING");
        setWaitingForStudent(false);
        // Auto-open mic after Mav finishes speaking
        speakText(data.text, () => {
          setTimeout(() => {
            setWaitingForStudent(true);
            setStatus("WAITING FOR YOU");
            questionStartRef.current = Date.now();
            if (startListeningRef.current) startListeningRef.current();
          }, 400);
        });
      }
    } catch (err) {
      setError(err.message);
      setWaitingForStudent(true);
      setStatus("ERROR");
    } finally {
      submittingRef.current = false;
    }
  }, [authFetch, sessionId, speakText]);

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
      setChapterTitle(data.chapter_title || "");
      setQuestionNum(data.question_number);

      const msg = data.text;
      setTranscript([{ speaker: "ai", text: msg }]);
      setCurrentAIText(msg);
      setStatus("AI SPEAKING");
      setWaitingForStudent(false);

      speakText(msg, () => {
        setTimeout(() => {
          setWaitingForStudent(true);
          setStatus("WAITING FOR YOU");
          questionStartRef.current = Date.now();
          if (startListeningRef.current) startListeningRef.current();
        }, 400);
      });
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
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    };
  }, [startSession]);

  // Keep startListeningRef up-to-date to avoid stale closures
  // (startListening is defined below, so we update the ref after it stabilises)

  const startListening = useCallback(() => {
    const SpeechRecognition =
      typeof window !== "undefined" &&
      (window.SpeechRecognition || window.webkitSpeechRecognition);
    if (!SpeechRecognition) {
      setError("Speech recognition not supported in this browser. Use Chrome or Edge, or type below.");
      return;
    }

    // Stop TTS so it doesn't feed back into the mic
    if (typeof window !== "undefined") window.speechSynthesis?.cancel();

    if (recognitionRef.current) recognitionRef.current.stop();

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    finalTextRef.current = "";
    fillerCountRef.current = 0;
    pauseCountRef.current = 0;
    longPauseMsRef.current = 0;
    lastSpeechRef.current = Date.now();

    recognition.onresult = (event) => {
      lastSpeechRef.current = Date.now();

      // Clear existing timers on new speech
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);

      let interim = "";
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const t = event.results[i][0].transcript;
        if (event.results[i].isFinal) {
          finalTextRef.current += t + " ";
          // Count filler words in each final segment
          const newFillers = countFillers(t);
          fillerCountRef.current += newFillers;
          setFillerCount(fillerCountRef.current);
        } else {
          interim += t;
        }
      }
      setLiveTranscript(finalTextRef.current + interim);

      // Silence = pause detection (3s gap)
      silenceTimerRef.current = setTimeout(() => {
        const gap = Date.now() - lastSpeechRef.current;
        if (gap >= 3000) {
          pauseCountRef.current += 1;
          longPauseMsRef.current += gap;
        }
      }, 3100);

      // Auto-submit after 3 seconds of silence if answer is non-empty
      if (finalTextRef.current.trim()) {
        autoSubmitTimerRef.current = setTimeout(() => {
          const answer = finalTextRef.current.trim();
          if (answer && !submittingRef.current) {
            if (recognitionRef.current) recognitionRef.current.stop();
            submitAnswer(answer);
          }
        }, 3000);
      }
    };

    recognition.onerror = (e) => {
      if (e.error !== "no-speech") setError(`Mic error: ${e.error}. Please retry.`);
      setMicActive(false);
    };

    recognition.onend = () => {
      setMicActive(false);
      // If recognition ended naturally (not by user) and we have text, submit
      const answer = finalTextRef.current.trim();
      if (answer && !submittingRef.current && waitingForStudent) {
        submitAnswer(answer);
      }
    };

    recognitionRef.current = recognition;
    recognition.start();
    setMicActive(true);
    setStatus("LISTENING");
  }, [submitAnswer, waitingForStudent]);

  // Always keep the ref current so speakText onEnd callbacks don't go stale
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopListeningAndSubmit = useCallback(() => {
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();
    setMicActive(false);
    const answer = finalTextRef.current.trim();
    if (answer) {
      submitAnswer(answer);
    } else {
      setStatus("WAITING FOR YOU");
    }
  }, [submitAnswer]);

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
    if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
    if (recognitionRef.current) recognitionRef.current.stop();
    try {
      const res = await authFetch(`/api/interview/end/${sessionId}`, { method: "POST" });
      if (!res.ok) throw new Error("Failed to end interview");
      const data = await res.json();
      setResults(data);
      setIsFinished(true);
      setStatus("COMPLETE");
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
    } catch (err) {
      setError(err.message);
    }
  };

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
              <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "4px" }}>{results.chapter_title}</p>
              <p style={{ color: "var(--color-success)", fontSize: "14px", fontWeight: "500", fontStyle: "italic" }}>
                🎙 Thanks for your time today. Take care, bye!
              </p>
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
                <button className="btn btn-primary" onClick={() => router.push(`/learn/${params.courseId}`)}>
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

  const isAISpeaking = status === "AI PROCESSING" || status === "AI SPEAKING" || (!waitingForStudent && !micActive && !isFinished);
  const captionText = micActive ? liveTranscript : currentAIText;
  const captionSpeaker = micActive ? "You (Speaking)" : "AI Assessor";

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "#121212", paddingTop: "80px", paddingBottom: "32px", minHeight: "100vh" }}>
        <div className="container meet-layout">

          {/* Header bar */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span className="badge badge-accent" style={{ backgroundColor: "rgba(255,255,255,0.1)", borderColor: "rgba(255,255,255,0.2)", color: "#8ab4f8", marginBottom: "6px" }}>
                LIVE AI INTERVIEW — {questionNum === 0 ? "GREETING" : `Q${questionNum}/5`}
              </span>
              <h1 style={{ fontSize: "20px", fontWeight: "600", color: "#ffffff", margin: 0 }}>
                Module Oral Assessment
              </h1>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              {micActive && fillerCount > 0 && (
                <span style={{ fontSize: "11px", color: "#f28b82", backgroundColor: "rgba(242,139,130,0.15)", padding: "4px 10px", borderRadius: "12px", fontFamily: "JetBrains Mono", border: "1px solid rgba(242,139,130,0.3)" }}>
                  {fillerCount} filler word{fillerCount !== 1 ? "s" : ""}
                </span>
              )}
              <span style={{ fontSize: "12px", color: "#e8eaed", backgroundColor: "#202124", padding: "6px 12px", borderRadius: "16px", border: "1px solid #3c4043", fontFamily: "JetBrains Mono" }}>
                {status}
              </span>
            </div>
          </div>

          {/* Video panels */}
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
              <div className="meet-avatar">{studentInitials}</div>
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

          {/* Captions overlay */}
          {showCaptions && captionText && (
            <div className="meet-captions-overlay">
              <div>
                <span className="meet-captions-speaker">{captionSpeaker}</span>
                <span>{captionText}</span>
              </div>
            </div>
          )}

          {/* Error banner */}
          {error && (
            <div style={{ color: "#f28b82", fontSize: "13px", textAlign: "center", marginTop: "8px" }}>{error}</div>
          )}

          {/* Auto-submit hint */}
          {micActive && finalTextRef.current.trim() && (
            <div style={{ textAlign: "center", marginTop: "8px", fontSize: "12px", color: "#9aa0a6" }}>
              Stop speaking for 3 seconds to auto-submit, or click 🎤 to submit now
            </div>
          )}

          {/* Fallback text input */}
          {waitingForStudent && !micActive && (
            <div style={{ marginTop: "16px", display: "flex", gap: "8px", maxWidth: "600px", margin: "16px auto 0" }}>
              <input
                className="form-input"
                placeholder="Type your answer here (or use the mic above)…"
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
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { if (typedAnswer.trim()) { submitAnswer(typedAnswer); setTypedAnswer(""); } }}
              >
                Send
              </button>
            </div>
          )}

          {/* Bottom control bar */}
          <div className="meet-bottom-bar">
            <div className="meet-bar-info">
              {micActive ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>
                  🎙 Listening… speak your answer. Click 🎤 to stop or wait 3s for auto-submit
                </span>
              ) : status === "AI SPEAKING" ? (
                <span style={{ color: "#8ab4f8" }}>🔊 Mav is speaking… mic opens automatically when done</span>
              ) : waitingForStudent ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>🎤 Mic is open — speak your answer or click 🎤 to submit manually</span>
              ) : (
                <span style={{ color: "#9aa0a6" }}>AI is processing your response…</span>
              )}
            </div>

            <div className="meet-bar-actions">
              <button
                onClick={handleToggleMic}
                className={`meet-action-btn ${micActive ? "mic-active" : ""}`}
                title={micActive ? "Stop & submit answer" : "Start speaking"}
                disabled={!waitingForStudent && !micActive}
                style={{ opacity: (!waitingForStudent && !micActive) ? 0.4 : 1 }}
              >
                {micActive ? "🎤" : "🔇"}
              </button>
              <button
                onClick={() => setShowCaptions((p) => !p)}
                className={`meet-action-btn ${!showCaptions ? "active-off" : ""}`}
                title="Toggle captions"
              >
                CC
              </button>
              <button
                onClick={handleEndCall}
                className="meet-action-btn meet-action-btn-end"
                title="End interview and get score"
              >
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