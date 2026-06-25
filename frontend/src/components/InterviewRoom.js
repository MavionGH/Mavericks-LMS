"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
// AI avatar frames (in frontend/local). Swapping between them while the AI
// speaks makes the avatar look like it's talking.
import avatarClosed from "../../local/closed.png";
import avatarOpened from "../../local/opened.png";

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

// Turn a raw fetch/network rejection into a calm, actionable message for the UI.
function friendlyNetworkError(err) {
  if (err?.name === "AbortError") {
    return "The server took too long to respond — please try answering again.";
  }
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(err?.message || "")) {
    return "Couldn't reach the server. Check your connection, then tap the mic and answer again.";
  }
  return err?.message || "Something went wrong — please try again.";
}

/**
 * Shared, voice-driven AI interview room used by both the (legacy) per-module
 * assessment and the course-wide final assessment.
 *
 * Props:
 *   doStart       async () => start-turn response { session_id, text, question_number, chapter_title }
 *                 (throws Error with a message on failure / ineligibility)
 *   heading       header title text
 *   panelLabel    label under the AI panel (e.g. "Course Host")
 *   backHref      where the "Return" link points on error
 *   reviewHref    where the "review content" link points after a non-pass
 *   continueHref  where the "Continue" button points after completion
 *   continueLabel label for the continue button
 *   isCourse      true → course-wide assessment (no per-module unlock messaging)
 */
export default function InterviewRoom({
  doStart,
  heading = "Oral Assessment",
  panelLabel = "Assessor",
  backHref = "/dashboard",
  reviewHref = "/dashboard",
  continueHref = "/dashboard",
  continueLabel = "Return to workspace",
  isCourse = false,
}) {
  const router = useRouter();
  const { user, authFetch } = useAuth();

  const [sessionId, setSessionId] = useState(null);
  const [titleText, setTitleText] = useState("");
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
  const [avatarMouthOpen, setAvatarMouthOpen] = useState(false);
  const [aiVoiceActive, setAiVoiceActive] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");

  const recognitionRef = useRef(null);
  const studentVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const speakWatchdogRef = useRef(null);
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

  // "Thinking/talking" — used only for the panel activity indicator, NOT for the
  // avatar mouth (the avatar must move only while Mav's voice is actually playing).
  const isAISpeaking =
    status === "AI PROCESSING" ||
    status === "AI SPEAKING" ||
    (!waitingForStudent && !micActive && !isFinished);

  // Speak `text` via TTS. `aiVoiceActive` is kept true ONLY while the voice is
  // actually audible, and `onEnd` is guaranteed to fire exactly once — even in
  // browsers where SpeechSynthesis `onend` is flaky — so the mic always reopens.
  const speakText = useCallback((text, onEnd) => {
    if (speakWatchdogRef.current) {
      clearInterval(speakWatchdogRef.current);
      speakWatchdogRef.current = null;
    }
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      if (speakWatchdogRef.current) {
        clearInterval(speakWatchdogRef.current);
        speakWatchdogRef.current = null;
      }
      setAiVoiceActive(false);
      if (onEnd) onEnd();
    };

    if (typeof window === "undefined" || !window.speechSynthesis) {
      finish();
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
    utter.onend = finish;
    utter.onerror = finish;

    setAiVoiceActive(true);
    window.speechSynthesis.speak(utter);

    // Watchdog: poll the engine so we detect the real end-of-speech even when
    // `onend` never fires, and bail out if speech never actually starts.
    let ticks = 0;
    let started = false;
    speakWatchdogRef.current = setInterval(() => {
      ticks += 1;
      if (window.speechSynthesis.speaking) started = true;
      const reallyEnded = started && !window.speechSynthesis.speaking && !window.speechSynthesis.pending;
      const neverStarted = !started && ticks > 8; // ~2s with no audible speech
      if (reallyEnded || neverStarted) finish();
    }, 250);
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

    // Resilient POST: each attempt has a timeout, and transient network failures
    // (brief connection drop, slow LLM turn) are retried so a raw "Failed to fetch"
    // never lands on screen.
    const postAnswer = async (payload) => {
      let lastErr = null;
      for (let attempt = 0; attempt < 3; attempt++) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 45000);
        try {
          const r = await authFetch("/api/interview/answer", {
            method: "POST",
            body: JSON.stringify(payload),
            signal: controller.signal,
          });
          clearTimeout(timer);
          return r; // got an HTTP response (even if non-2xx) — stop retrying
        } catch (e) {
          clearTimeout(timer);
          lastErr = e;
          if (attempt < 2) await new Promise((r) => setTimeout(r, 800 * (attempt + 1)));
        }
      }
      throw lastErr || new Error("Network error");
    };

    try {
      const res = await postAnswer({
        session_id: sessionId,
        answer_text: cleaned || trimmed,
        response_time_ms: responseTime,
        pause_count: pauseCount,
        long_pause_ms: longPauseMs,
        filler_word_count: fillerWordCount,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
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
            : "Thank you for participating. You can review the material and try the assessment again anytime. Take care and goodbye!"
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
      // Friendly, recoverable: keep the student in the flow so they can simply
      // tap the mic and answer again (or type) — no dead "ERROR" state.
      setError(friendlyNetworkError(err));
      setWaitingForStudent(true);
      setStatus("WAITING FOR YOU");
    } finally {
      submittingRef.current = false;
    }
  }, [authFetch, sessionId, speakText]);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await doStart();
      setSessionId(data.session_id);
      setTitleText(data.chapter_title || "");
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
      setError(friendlyNetworkError(err));
    } finally {
      setLoading(false);
    }
  }, [doStart, speakText]);

  useEffect(() => {
    startSession();
    return () => {
      if (recognitionRef.current) recognitionRef.current.stop();
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      if (autoSubmitTimerRef.current) clearTimeout(autoSubmitTimerRef.current);
      if (speakWatchdogRef.current) clearInterval(speakWatchdogRef.current);
    };
  }, [startSession]);

  // Animate the avatar's mouth ONLY while Mav's voice is actually playing
  // (asking/answering aloud) by swapping closed/opened frames. At every other
  // time — including while the AI is processing the student's answer — it stays
  // on the closed frame.
  useEffect(() => {
    if (!aiVoiceActive) {
      setAvatarMouthOpen(false);
      return;
    }
    const interval = setInterval(() => {
      setAvatarMouthOpen((prev) => !prev);
    }, 200);
    return () => clearInterval(interval);
  }, [aiVoiceActive]);

  // Keep the student's camera on for the duration of the interview.
  useEffect(() => {
    let cancelled = false;
    async function startCamera() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
        setCameraError("Camera isn't supported in this browser.");
        return;
      }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
        if (cancelled) {
          stream.getTracks().forEach((t) => t.stop());
          return;
        }
        cameraStreamRef.current = stream;
        if (studentVideoRef.current) studentVideoRef.current.srcObject = stream;
        setCameraOn(true);
        setCameraError("");
      } catch {
        setCameraError("Camera is off — allow camera access to show your video.");
        setCameraOn(false);
      }
    }
    startCamera();
    return () => {
      cancelled = true;
      if (cameraStreamRef.current) {
        cameraStreamRef.current.getTracks().forEach((t) => t.stop());
        cameraStreamRef.current = null;
      }
    };
  }, []);

  // Release the camera once the assessment is complete.
  useEffect(() => {
    if (isFinished && cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      setCameraOn(false);
    }
  }, [isFinished]);

  // Stable callback ref for the student's <video>. Must NOT be an inline arrow:
  // an inline ref is re-invoked on every render (e.g. the 200ms avatar swap),
  // which would re-assign srcObject and make the camera flicker/jump. Here we
  // only (re)attach the stream when the element or stream actually changes.
  const attachStudentVideo = useCallback((el) => {
    studentVideoRef.current = el;
    if (el && cameraStreamRef.current && el.srcObject !== cameraStreamRef.current) {
      el.srcObject = cameraStreamRef.current;
    }
  }, []);

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
      // Ignore events from a recognition instance we've already replaced, so a
      // stale "aborted" can't switch the mic indicator off after a new one opened.
      if (recognitionRef.current !== recognition) return;
      // Chrome's SpeechRecognition fires transient "network"/"no-speech"/"aborted"/
      // "audio-capture" errors even while the mic keeps working fine — never surface
      // those. Only a genuine permission block is worth telling the student about.
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        setError("Microphone access is blocked. Allow mic permission, or type your answer below.");
      }
      setMicActive(false);
    };

    recognition.onend = () => {
      // Guard against a superseded recognition's late onend killing the live mic.
      if (recognitionRef.current !== recognition) return;
      setMicActive(false);
      // If recognition ended (silence/stop) and we have text, submit it.
      const answer = finalTextRef.current.trim();
      if (answer && !submittingRef.current && waitingForStudent) {
        submitAnswer(answer);
      }
    };

    // Detach the previous instance's handlers before replacing it, then make
    // this the current one *before* start() so the guards above resolve correctly.
    if (recognitionRef.current) {
      recognitionRef.current.onend = null;
      recognitionRef.current.onerror = null;
      recognitionRef.current.onresult = null;
    }
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
          <Link href={backHref} className="btn btn-primary">
            Go back
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
                {!isCourse && (
                  <span style={{ fontSize: "12px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontWeight: "600" }}>
                    {results.next_chapter_unlocked ? "NEXT MODULE UNLOCKED" : results.passed ? "COURSE COMPLETE" : "REVIEW MODULE REQUIRED"}
                  </span>
                )}
              </div>
            </div>

            {!results.passed && results.suggested_review?.length > 0 && (
              <div className="card" style={{ padding: "24px", marginBottom: "24px", backgroundColor: "#fff8f0", border: "1px solid var(--color-warning)" }}>
                <h4 style={{ color: "var(--color-warning)", fontSize: "13px", fontWeight: "700", marginBottom: "12px" }}>Suggested Review</h4>
                <ul style={{ fontSize: "13.5px", paddingLeft: "16px" }}>
                  {results.suggested_review.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
                <Link href={reviewHref} className="btn btn-secondary" style={{ marginTop: "16px" }}>
                  Review course material
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
              {!isCourse && results.next_chapter_unlocked && (
                <button className="btn btn-primary" onClick={() => router.push(continueHref)}>
                  {continueLabel}
                </button>
              )}
              <Link href="/dashboard" className="btn btn-secondary">Return to workspace</Link>
            </div>
          </div>
        </div>
      </>
    );
  }

  // Captions follow whoever is *actively* talking, and disappear during silence:
  //  • student speaking (mic on, words detected) → show the live transcript
  //  • Mav's voice playing → show her line
  //  • nobody talking → no caption
  let captionText = "";
  let captionSpeaker = "";
  if (micActive && liveTranscript.trim()) {
    captionText = liveTranscript;
    captionSpeaker = "You (Speaking)";
  } else if (aiVoiceActive && currentAIText) {
    captionText = currentAIText;
    captionSpeaker = "AI Assessor";
  }

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
                {heading}
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
              <img
                src={(avatarMouthOpen ? avatarOpened : avatarClosed).src}
                alt="Mav — AI Assessor avatar"
                draggable={false}
                style={{
                  width: 168,
                  height: 168,
                  borderRadius: "50%",
                  objectFit: "cover",
                  boxShadow: "var(--shadow-lg)",
                  userSelect: "none",
                }}
              />
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
                <span>Mav — AI Assessor ({panelLabel})</span>
              </div>
            </div>

            <div className={`meet-panel meet-panel-student ${micActive ? "speaking" : ""}`}>
              <video
                ref={attachStudentVideo}
                autoPlay
                playsInline
                muted
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  transform: "scaleX(-1)",
                  display: cameraOn ? "block" : "none",
                }}
              />
              {!cameraOn && <div className="meet-avatar">{studentInitials}</div>}
              {!cameraOn && cameraError && (
                <div
                  style={{
                    position: "absolute",
                    top: 16,
                    left: 16,
                    right: 16,
                    fontSize: "12px",
                    color: "#f28b82",
                    textAlign: "center",
                  }}
                >
                  {cameraError}
                </div>
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
