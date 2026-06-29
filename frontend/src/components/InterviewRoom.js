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

// Handoff gap between TTS ending and the mic opening. speechSynthesis needs a tick
// to release the audio session before we start recording. Small and deterministic.
const MIC_HANDOFF_MS = 150;

// ── Voice capture (MediaRecorder + local VAD) ──────────────────────────────────
// The browser Web Speech API (Google cloud STT) is unreachable on many networks,
// so we record the answer locally and transcribe it server-side (Groq Whisper).
// A lightweight Voice Activity Detector watches the mic level to auto-stop on
// silence — no cloud dependency, works everywhere the backend can reach Groq.
//
// VAD_THRESHOLD : normalized RMS above which we consider the student to be speaking
// SILENCE_MS    : trailing silence (after speech) that triggers auto-submit
// MAX_RECORD_MS : hard cap on a single answer's recording length
// MIN_SPEECH_MS : minimum voiced time before a silence is allowed to auto-submit
const VAD_THRESHOLD = 0.02;
const SILENCE_MS = 2500;
const MAX_RECORD_MS = 60000;
const MIN_SPEECH_MS = 300;

// TEMP instrumentation: timestamped logs across the whole voice pipeline so the
// exact latency of every stage (TTS end → mic → audiostart → first word →
// caption) is measurable in the console. Flip to false to silence.
const VOICE_DEBUG = true;
function tlog(label) {
  if (!VOICE_DEBUG || typeof console === "undefined") return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  console.log(`[voice ${now.toFixed(0)}ms] ${label}`);
}

// Known FEMALE TTS voice names across Windows / Chrome / macOS / Android. The
// Web Speech API exposes no gender field, so name-matching is the reliable way to
// keep Mav's voice female regardless of the device's installed voices.
const FEMALE_VOICE_HINTS = /(zira|aria|jenny|jessa|michelle|female|samantha|victoria|karen|moira|tessa|fiona|serena|allison|ava|susan|google us english|google uk english female|libby|sonia|natasha|clara|amber|emma|hazel|catherine|linda|heera|hoda|salli|joanna|kimberly|ivy|kendra)/i;

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
  // Whole-session recording (screen + Mav's voice + student mic → R2).
  const [hasStarted, setHasStarted] = useState(false);   // consent gate passed
  const [preparing, setPreparing] = useState(false);     // acquiring screen share
  const [recordingNotice, setRecordingNotice] = useState(""); // non-fatal warning

  const studentVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);
  const speakWatchdogRef = useRef(null);
  const questionStartRef = useRef(null);
  const pauseCountRef = useRef(0);
  const longPauseMsRef = useRef(0);
  const submittingRef = useRef(false);
  const fillerCountRef = useRef(0);
  const startListeningRef = useRef(null);  // ref to break circular dep
  const waitingForStudentRef = useRef(false); // live mirror of waitingForStudent

  // ── Recording / VAD refs ──
  const micStreamRef = useRef(null);       // held mic capture (reused each turn)
  const mediaRecorderRef = useRef(null);
  const audioChunksRef = useRef([]);       // recorded blob chunks for this answer
  const audioCtxRef = useRef(null);        // AudioContext for VAD analysis
  const vadIntervalRef = useRef(null);     // VAD polling interval
  const speechDetectedRef = useRef(false); // any voiced audio captured this turn
  const speechStartedAtRef = useRef(0);    // when voice first detected this turn
  const lastVoiceRef = useRef(0);          // last moment voice was above threshold
  const recordStartRef = useRef(0);        // when recording began
  const transcribingRef = useRef(false);   // awaiting server transcription

  // ── Whole-session recorder refs (independent of the per-answer mic capture) ──
  // We record the ENTIRE interview — the shared screen, Mav's TTS voice (captured
  // from the tab/system audio of the screen share) and the student's mic — into a
  // single file, then upload it to Cloudflare R2 when the interview ends.
  const sessionIdRef = useRef(null);          // live mirror of sessionId for late callbacks
  const sessionRecorderRef = useRef(null);    // MediaRecorder for the full session
  const sessionChunksRef = useRef([]);        // recorded blob chunks
  const displayStreamRef = useRef(null);      // getDisplayMedia (screen + system audio)
  const recordMicStreamRef = useRef(null);    // dedicated mic stream for the recording mix
  const recordAudioCtxRef = useRef(null);     // AudioContext that mixes screen + mic audio
  const recordingActiveRef = useRef(false);   // true while the session recorder is running
  const recordingPreparedRef = useRef(false); // devices acquired + recorder built, not yet started
  const recordingUploadedRef = useRef(false); // guard: upload/stop runs exactly once
  // Stable handle to the latest finalizer so the (once-registered) screen-share
  // "ended" listener and the unmount cleanup always call the current version.
  const finalizeSessionRecordingRef = useRef(null);

  const studentInitials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "ST";

  // "Thinking/talking" — used only for the panel activity indicator, NOT for the
  // avatar mouth (the avatar must move only while Mav's voice is actually playing).
  const isAISpeaking =
    status === "AI PROCESSING" ||
    status === "AI SPEAKING" ||
    (!waitingForStudent && !micActive && !isFinished);

  // Speak `text` via TTS. Audio is the single source of truth for timing:
  // `aiVoiceActive` flips on only when the voice ACTUALLY starts (utterance
  // `onstart`, or the watchdog detecting real playback) — never before audio
  // begins — and off the instant it ends. `onEnd` is guaranteed to fire exactly
  // once, even when the browser's `onstart`/`onend` are flaky, so the mic always
  // reopens after Mav finishes.
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
      tlog("TTS finished (audio playback ended, avatar stops)");
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
    utter.pitch = 1.1; // slightly higher → reads as a female voice on generic engines
    utter.volume = 1;
    // Mav is female, so prefer a FEMALE en-US voice. There is no standard gender
    // field, so we match the well-known female voice names across Windows / Chrome
    // / macOS / Android, preferring a local (low-latency) one. Falls back to any
    // en voice so the greeting is never skipped.
    const voices = window.speechSynthesis.getVoices();
    const en = voices.filter((v) => /^en(-|_|$)/i.test(v.lang));
    const isFemale = (v) => FEMALE_VOICE_HINTS.test(v.name);
    const preferred =
      en.find((v) => isFemale(v) && v.localService && /en-US/i.test(v.lang)) ||
      en.find((v) => isFemale(v) && /en-US/i.test(v.lang)) ||
      en.find((v) => isFemale(v)) ||
      en.find((v) => v.localService && /en-US/i.test(v.lang)) ||
      en.find((v) => /en-US/i.test(v.lang)) ||
      en[0] ||
      voices[0];
    if (preferred) utter.voice = preferred;
    tlog(`TTS voice: ${preferred ? `${preferred.name} (${preferred.lang})` : "default"}`);

    // Audio events are the ONLY thing that turns the avatar/captions on, so they
    // can never appear before sound. `onstart` (and `onboundary`, which fires as
    // words are actually spoken) signal real playback; the watchdog below is used
    // solely to detect the END and to bail out if speech never starts — it does
    // NOT switch the avatar on from the queued `speaking` flag.
    let loggedFirstAudio = false;
    const markSpeaking = () => {
      if (!loggedFirstAudio) { loggedFirstAudio = true; tlog("TTS first audio (onstart/onboundary)"); }
      setAiVoiceActive(true);
    };
    utter.onstart = markSpeaking;
    utter.onboundary = markSpeaking;
    utter.onend = finish;
    utter.onerror = finish;

    tlog("TTS speak() called");
    window.speechSynthesis.speak(utter);

    // Watchdog: detect real end-of-speech even when `onend` never fires, and bail
    // out if speech never starts. `everSpoke` is for END detection only.
    let ticks = 0;
    let everSpoke = false;
    speakWatchdogRef.current = setInterval(() => {
      ticks += 1;
      if (window.speechSynthesis.speaking) everSpoke = true;
      const reallyEnded = everSpoke && !window.speechSynthesis.speaking && !window.speechSynthesis.pending;
      const neverStarted = !everSpoke && ticks > 8; // ~2s with no speech at all
      if (reallyEnded || neverStarted) finish();
    }, 250);
  }, []);

  const submitAnswer = useCallback(async (answerText) => {
    if (submittingRef.current || !sessionId) return;
    const trimmed = answerText.trim();
    if (!trimmed) return;

    submittingRef.current = true;
    setStatus("AI PROCESSING");
    setWaitingForStudent(false);
    setMicActive(false);

    const responseTime = questionStartRef.current ? Date.now() - questionStartRef.current : 0;
    const pauseCount = pauseCountRef.current;
    const longPauseMs = longPauseMsRef.current;
    const fillerWordCount = fillerCountRef.current;

    // Show the raw (filler-included) answer in the UI transcript. Keep it visible
    // as the caption (don't clear liveTranscript) until Mav starts speaking, so the
    // student sees what was transcribed.
    setTranscript((prev) => [...prev, { speaker: "student", text: trimmed }]);
    setLiveTranscript(trimmed);
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

      if (data.passed !== undefined) {
        // Interview is over, but DON'T jump to the results page yet. Mav must say
        // her goodbye *during* the interview (avatar still on screen, lip-syncing),
        // and only once her voice actually finishes do we switch to the results
        // page. This avoids the jarring "goodbye plays over the results screen".
        const goodbye = data.passed
          ? "Congratulations! You passed the assessment. Thank you for completing the interview. Take care and goodbye!"
          : "Thank you for participating. You can review the material and try the assessment again anytime. Take care and goodbye!";
        setResults(data);
        setWaitingForStudent(false);
        setMicActive(false);
        setStatus("AI SPEAKING");
        setCurrentAIText(goodbye);
        setTranscript((prev) => [...prev, { speaker: "ai", text: goodbye }]);
        speakText(goodbye, () => {
          // Mav has finished speaking → now end the interview and show results.
          setIsFinished(true);
          setStatus("COMPLETE");
        });
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
            tlog("handoff: opening mic for student answer");
            if (startListeningRef.current) startListeningRef.current();
          }, MIC_HANDOFF_MS);
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

  // Begin recording the whole interview: screen + system/tab audio (which carries
  // Mav's TTS voice) from getDisplayMedia, mixed with the student's mic. Returns
  // true if recording is running, false if the student declined / it's unsupported
  // (the interview still proceeds in that case — recording is best-effort).
  const startSessionRecording = useCallback(async () => {
    if (recordingActiveRef.current) return true;
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getDisplayMedia ||
      typeof window === "undefined" ||
      !window.MediaRecorder
    ) {
      setRecordingNotice("Recording isn't supported in this browser — the interview will continue without it.");
      return false;
    }

    // 1) Screen + audio. The browser shows its screen-share picker here; the
    //    student must tick "share tab/system audio" so Mav's voice is captured.
    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });
    } catch {
      return false; // declined / dismissed — caller decides what to do next
    }
    displayStreamRef.current = display;

    // 2) Student mic (separate from the per-answer STT mic so the two never fight).
    let mic = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      recordMicStreamRef.current = mic;
    } catch {
      // No mic → we still record the screen + Mav's voice (student audio missing).
    }

    // 3) Mix the screen audio and the mic into one track via an AudioContext.
    const videoTrack = display.getVideoTracks()[0];
    const tracks = [];
    if (videoTrack) tracks.push(videoTrack);
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      recordAudioCtxRef.current = ctx;
      const dest = ctx.createMediaStreamDestination();
      if (display.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream(display.getAudioTracks())).connect(dest);
      }
      if (mic && mic.getAudioTracks().length) {
        ctx.createMediaStreamSource(new MediaStream(mic.getAudioTracks())).connect(dest);
      }
      const mixed = dest.stream.getAudioTracks()[0];
      if (mixed) tracks.push(mixed);
    } catch {
      // Mixing failed → fall back to the raw screen audio track alone.
      const a = display.getAudioTracks()[0];
      if (a) tracks.push(a);
    }

    const combined = new MediaStream(tracks);

    // 4) Record the combined stream for the whole session.
    let recorder;
    try {
      const mime = window.MediaRecorder.isTypeSupported?.("video/webm;codecs=vp9,opus")
        ? "video/webm;codecs=vp9,opus"
        : (window.MediaRecorder.isTypeSupported?.("video/webm") ? "video/webm" : "");
      recorder = mime ? new MediaRecorder(combined, { mimeType: mime }) : new MediaRecorder(combined);
    } catch {
      setRecordingNotice("Couldn't start the recorder — the interview will continue without recording.");
      display.getTracks().forEach((t) => t.stop());
      if (mic) mic.getTracks().forEach((t) => t.stop());
      return false;
    }
    sessionChunksRef.current = [];
    recordingUploadedRef.current = false;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) sessionChunksRef.current.push(e.data); };
    sessionRecorderRef.current = recorder;

    // If the student stops the screen share from the browser's own UI, end the
    // recording gracefully (the interview itself keeps going).
    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (recordingActiveRef.current) finalizeSessionRecordingRef.current?.();
      });
    }

    // NOTE: we do NOT call recorder.start() here. The screen-share permission must
    // be acquired during the user's click (above), but the model can take 1-2 min
    // to return the first question, and we don't want that loading time in the
    // recording. beginSessionCapture() actually starts the recorder once the
    // interview screen is ready.
    recordingPreparedRef.current = true;
    tlog("session recording prepared (waiting for interview screen)");
    return true;
  }, []);

  // Start the prepared recorder. Called the moment the interview screen is ready
  // (first question received) so the model-loading wait is never recorded.
  const beginSessionCapture = useCallback(() => {
    if (!recordingPreparedRef.current || recordingActiveRef.current) return;
    const rec = sessionRecorderRef.current;
    if (!rec) return;
    try {
      rec.start(1000); // gather data every second so nothing is lost on stop
      recordingActiveRef.current = true;
      tlog("session recording started (interview screen visible)");
    } catch (e) {
      tlog("failed to start prepared recorder: " + (e?.message || e));
    }
  }, []);

  // Stop the full-session recorder, upload the resulting file to R2, and release
  // the screen/mic devices. Idempotent — safe to call from finish, end-call, and
  // unmount; only the first call does the work.
  const finalizeSessionRecording = useCallback(async () => {
    if (recordingUploadedRef.current) return;
    const recorder = sessionRecorderRef.current;
    if (!recorder || !recordingActiveRef.current) {
      // Recorder was never started (e.g. prepared, then the interview aborted
      // before the screen appeared). Just release the captured devices.
      recordingActiveRef.current = false;
      recordingPreparedRef.current = false;
      if (recordAudioCtxRef.current) { try { recordAudioCtxRef.current.close(); } catch { /* noop */ } recordAudioCtxRef.current = null; }
      if (displayStreamRef.current) { displayStreamRef.current.getTracks().forEach((t) => t.stop()); displayStreamRef.current = null; }
      if (recordMicStreamRef.current) { recordMicStreamRef.current.getTracks().forEach((t) => t.stop()); recordMicStreamRef.current = null; }
      return;
    }
    recordingUploadedRef.current = true;
    recordingActiveRef.current = false;

    // Wait for the recorder to flush its final chunk before building the blob.
    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });
    await stopped;

    // Tear down capture devices now that recording has ended.
    if (recordAudioCtxRef.current) { try { recordAudioCtxRef.current.close(); } catch { /* noop */ } recordAudioCtxRef.current = null; }
    if (displayStreamRef.current) { displayStreamRef.current.getTracks().forEach((t) => t.stop()); displayStreamRef.current = null; }
    if (recordMicStreamRef.current) { recordMicStreamRef.current.getTracks().forEach((t) => t.stop()); recordMicStreamRef.current = null; }

    const chunks = sessionChunksRef.current;
    sessionChunksRef.current = [];
    const sid = sessionIdRef.current;
    if (!chunks.length || !sid) {
      tlog("session recording: nothing to upload");
      return;
    }

    const blob = new Blob(chunks, { type: chunks[0].type || "video/webm" });
    tlog(`uploading interview recording ${(blob.size / (1024 * 1024)).toFixed(1)}MB`);
    try {
      const form = new FormData();
      form.append("recording", blob, "interview.webm");
      const res = await authFetch(`/api/interview/recording/${sid}`, { method: "POST", body: form });
      if (!res.ok) throw new Error("upload failed");
      tlog("interview recording uploaded");
    } catch (e) {
      // Non-fatal: the student already has their result; the recording just won't
      // appear in the teacher panel.
      tlog("interview recording upload failed: " + (e?.message || e));
    }
  }, [authFetch]);

  useEffect(() => {
    finalizeSessionRecordingRef.current = finalizeSessionRecording;
  }, [finalizeSessionRecording]);

  const startSession = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const data = await doStart();
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setTitleText(data.chapter_title || "");
      setQuestionNum(data.question_number);

      const msg = data.text;
      setTranscript([{ speaker: "ai", text: msg }]);
      setCurrentAIText(msg);
      setStatus("AI SPEAKING");
      setWaitingForStudent(false);

      // The interview screen is now ready — START recording here so the (often
      // 1-2 min) model-loading wait above is never captured. The greeting and the
      // whole conversation that follow ARE recorded.
      beginSessionCapture();

      speakText(msg, () => {
        setTimeout(() => {
          setWaitingForStudent(true);
          setStatus("WAITING FOR YOU");
          questionStartRef.current = Date.now();
          tlog("handoff: opening mic after greeting");
          if (startListeningRef.current) startListeningRef.current();
        }, MIC_HANDOFF_MS);
      });
    } catch (err) {
      setError(friendlyNetworkError(err));
      // The interview never started — release the prepared (never-recorded) screen
      // share so the student isn't left sharing their screen for nothing.
      if (!recordingActiveRef.current) finalizeSessionRecordingRef.current?.();
    } finally {
      setLoading(false);
    }
  }, [doStart, speakText, beginSessionCapture]);

  // Warm the TTS voice list on mount. Browsers load voices asynchronously, so
  // touching getVoices() (and listening for "voiceschanged") here means the list
  // is ready by the time the start-interview network call returns — the greeting
  // then speaks with the preferred voice and is never skipped due to loading.
  useEffect(() => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    window.speechSynthesis.getVoices();
    const onVoices = () => window.speechSynthesis.getVoices();
    window.speechSynthesis.addEventListener?.("voiceschanged", onVoices);
    return () => window.speechSynthesis.removeEventListener?.("voiceschanged", onVoices);
  }, []);

  // Begin the recorded interview once the student has consented to screen sharing.
  // We acquire the screen+audio capture FIRST (needs the click's user gesture),
  // then kick off the interview turn. If sharing is declined the student can still
  // continue without a recording.
  const beginInterview = useCallback(async () => {
    setPreparing(true);
    setRecordingNotice("");
    const ok = await startSessionRecording();
    setPreparing(false);
    if (ok) {
      setHasStarted(true);
    } else {
      setRecordingNotice(
        "Screen sharing wasn't enabled, so this interview can't be recorded. Click “Share screen & begin” to try again, or continue without recording."
      );
    }
  }, [startSessionRecording]);

  const continueWithoutRecording = useCallback(() => {
    setRecordingNotice("");
    setHasStarted(true);
  }, []);

  useEffect(() => {
    // Kick off the interview turn only AFTER the consent gate is passed.
    if (!hasStarted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startSession();
    return () => {
      // Flush/upload the recording if the student leaves mid-interview.
      finalizeSessionRecordingRef.current?.();
      if (vadIntervalRef.current) clearInterval(vadIntervalRef.current);
      if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
        try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
      }
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
      if (micStreamRef.current) {
        micStreamRef.current.getTracks().forEach((t) => t.stop());
        micStreamRef.current = null;
      }
      if (typeof window !== "undefined") window.speechSynthesis?.cancel();
      if (speakWatchdogRef.current) clearInterval(speakWatchdogRef.current);
    };
  }, [hasStarted, startSession]);

  // Animate the avatar's mouth ONLY while Mav's voice is actually playing
  // (asking/answering aloud) by swapping closed/opened frames. When the voice is
  // not playing we simply don't run the interval; the render gates the open frame
  // on `aiVoiceActive`, so the avatar shows the closed frame at every other time
  // (including while the AI processes the student's answer) — no reset setState.
  useEffect(() => {
    if (!aiVoiceActive) return;
    const interval = setInterval(() => {
      setAvatarMouthOpen((prev) => !prev);
    }, 200);
    return () => clearInterval(interval);
  }, [aiVoiceActive]);

  // Mirror waitingForStudent into a ref so recognition's late `onend` reads the
  // CURRENT value, not the value captured when the (stale) callback was built.
  useEffect(() => {
    waitingForStudentRef.current = waitingForStudent;
  }, [waitingForStudent]);

  // Prime the mic PERMISSION once up front, then immediately release the device so
  // the permission prompt is resolved before the first question. startListening()
  // acquires (and then holds) its own stream for recording when the mic opens.
  useEffect(() => {
    let cancelled = false;
    async function primeMicPermission() {
      if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) return;
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
        stream.getTracks().forEach((t) => t.stop());
        if (!cancelled) tlog("mic permission primed");
      } catch {
        // The recorder will request permission later; non-fatal.
      }
    }
    primeMicPermission();
    return () => { cancelled = true; };
  }, []);

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

  // Release the camera AND microphone once the assessment is complete.
  useEffect(() => {
    if (!isFinished) return;
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      setCameraOn(false);
    }
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null;
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
  }, [isFinished]);

  // Once the interview is over, stop the full-session recorder and upload it to R2.
  // Idempotent (covers normal completion, "end early", and the unmount path).
  useEffect(() => {
    if (!isFinished) return;
    finalizeSessionRecording();
  }, [isFinished, finalizeSessionRecording]);

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

  // Stop the active recorder + VAD. The recorder's onstop handler then builds the
  // blob, transcribes it server-side, and submits. Idempotent.
  const stopRecording = useCallback(() => {
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
    const rec = mediaRecorderRef.current;
    if (rec && rec.state !== "inactive") {
      try { rec.stop(); } catch { /* noop */ }
    }
  }, []);

  // Open the mic and RECORD the student's answer, then transcribe it server-side
  // (Groq Whisper). The browser Web Speech API is unreliable/blocked on many
  // networks, so we never depend on it. A local Voice Activity Detector watches
  // the mic level and auto-stops after a trailing silence; the student can also
  // tap the mic to submit immediately.
  const startListening = useCallback(async () => {
    if (
      typeof navigator === "undefined" ||
      !navigator.mediaDevices?.getUserMedia ||
      typeof window === "undefined" ||
      !window.MediaRecorder
    ) {
      setError("Voice recording isn't supported in this browser. Please type your answer below.");
      setMicActive(false);
      return;
    }

    // Stop TTS so Mav's voice isn't recorded into the answer.
    window.speechSynthesis?.cancel();

    // Acquire (or reuse) a held mic stream.
    let stream = micStreamRef.current;
    try {
      if (!stream || !stream.active) {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
          video: false,
        });
        micStreamRef.current = stream;
      }
    } catch {
      setError("Couldn't access your microphone. Allow mic permission, or type your answer below.");
      setMicActive(false);
      return;
    }

    // Reset per-answer state.
    fillerCountRef.current = 0;
    pauseCountRef.current = 0;
    longPauseMsRef.current = 0;
    speechDetectedRef.current = false;
    speechStartedAtRef.current = 0;
    audioChunksRef.current = [];
    recordStartRef.current = Date.now();
    lastVoiceRef.current = Date.now();
    setLiveTranscript("");
    setFillerCount(0);

    // Build the recorder.
    let recorder;
    try {
      const mime = window.MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus"
        : (window.MediaRecorder.isTypeSupported?.("audio/webm") ? "audio/webm" : "");
      recorder = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch {
      setError("Couldn't start the recorder. Please type your answer below.");
      setMicActive(false);
      return;
    }
    mediaRecorderRef.current = recorder;
    recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) audioChunksRef.current.push(e.data); };

    recorder.onstop = async () => {
      if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
      if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
      setMicActive(false);

      const chunks = audioChunksRef.current;
      audioChunksRef.current = [];
      // Transcribe whenever we have audio. We intentionally do NOT gate on the VAD
      // (speechDetected): the recorder captures audio independently, so a manual
      // mic-off always submits even if VAD/AudioContext misbehaves. Pure silence
      // simply transcribes to "" and is handled below.
      if (!chunks.length) {
        tlog("recording stopped — no audio captured, not submitting");
        setLiveTranscript("");
        if (waitingForStudentRef.current && !submittingRef.current) setStatus("WAITING FOR YOU");
        return;
      }

      const blob = new Blob(chunks, { type: chunks[0].type || "audio/webm" });
      tlog(`transcribing ${(blob.size / 1024).toFixed(0)}KB audio`);
      transcribingRef.current = true;
      setStatus("TRANSCRIBING");
      setLiveTranscript("");
      try {
        const form = new FormData();
        form.append("audio", blob, "answer.webm");
        const res = await authFetch("/api/interview/transcribe", { method: "POST", body: form });
        if (!res.ok) throw new Error("Transcription failed");
        const data = await res.json();
        const text = (data.text || "").trim();
        transcribingRef.current = false;
        tlog("transcript: " + JSON.stringify(text));
        if (!text) {
          setLiveTranscript("");
          setError("I couldn't hear that clearly — tap the mic to try again, or type your answer below.");
          setStatus("WAITING FOR YOU");
          return;
        }
        fillerCountRef.current = countFillers(text);
        submitAnswer(text);
      } catch (err) {
        transcribingRef.current = false;
        setLiveTranscript("");
        setError(friendlyNetworkError(err));
        setStatus("WAITING FOR YOU");
      }
    };

    try {
      recorder.start();
    } catch {
      setError("Couldn't start recording. Please type your answer below.");
      setMicActive(false);
      return;
    }
    setMicActive(true);
    setStatus("LISTENING");
    tlog("MediaRecorder.start() — recording answer");

    // ── Voice Activity Detection: auto-submit on trailing silence ──
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      audioCtxRef.current = ctx;
      // The context can start "suspended" under autoplay policy → resume so the
      // analyser actually receives samples (otherwise VAD reads constant silence).
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);

      vadIntervalRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();

        if (rms > VAD_THRESHOLD) {
          if (!speechDetectedRef.current) {
            speechDetectedRef.current = true;
            speechStartedAtRef.current = now;
            tlog("VAD: speech detected");
          }
          lastVoiceRef.current = now;
        } else if (speechDetectedRef.current) {
          const voiced = lastVoiceRef.current - speechStartedAtRef.current;
          const silence = now - lastVoiceRef.current;
          if (silence >= SILENCE_MS && voiced >= MIN_SPEECH_MS) {
            tlog(`VAD: ${SILENCE_MS}ms trailing silence → auto-submitting`);
            stopRecording();
            return;
          }
        }
        if (now - recordStartRef.current >= MAX_RECORD_MS) {
          tlog("VAD: max record length reached → auto-submitting");
          stopRecording();
        }
      }, 100);
    } catch (e) {
      // VAD is best-effort; without it the student can still submit via the mic button.
      tlog("VAD init failed (non-fatal): " + (e?.message || e));
    }
  }, [submitAnswer, authFetch, stopRecording]);

  // Always keep the ref current so speakText onEnd callbacks don't go stale
  useEffect(() => {
    startListeningRef.current = startListening;
  }, [startListening]);

  const stopListeningAndSubmit = useCallback(() => {
    // Manual stop: finalize the recording. Its onstop handler transcribes + submits
    // (or returns to WAITING if nothing was actually spoken).
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      tlog("manual stop → finalizing answer");
      stopRecording();
    } else {
      setMicActive(false);
      setStatus("WAITING FOR YOU");
    }
  }, [stopRecording]);

  const handleToggleMic = () => {
    if (!waitingForStudent || submittingRef.current || transcribingRef.current) return;
    if (micActive) {
      stopListeningAndSubmit();
    } else {
      startListening();
    }
  };

  const handleEndCall = async () => {
    if (!sessionId) return;
    if (vadIntervalRef.current) { clearInterval(vadIntervalRef.current); vadIntervalRef.current = null; }
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== "inactive") {
      mediaRecorderRef.current.onstop = null; // don't transcribe/submit a half answer
      try { mediaRecorderRef.current.stop(); } catch { /* noop */ }
    }
    if (audioCtxRef.current) { try { audioCtxRef.current.close(); } catch { /* noop */ } audioCtxRef.current = null; }
    if (micStreamRef.current) {
      micStreamRef.current.getTracks().forEach((t) => t.stop());
      micStreamRef.current = null;
    }
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

  // ── Consent gate ──────────────────────────────────────────────────────────
  // Screen capture can only be requested from a user gesture, and recording the
  // interview requires the student's explicit consent, so we gate the whole
  // session behind a single "Share screen & begin" click.
  if (!hasStarted) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ display: "grid", placeItems: "center", minHeight: "100vh", backgroundColor: "var(--bg-canvas)" }}>
          <div className="card" style={{ maxWidth: 520, padding: "40px", textAlign: "center", backgroundColor: "#ffffff" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", marginBottom: "12px" }}>{heading}</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: "1.6", marginBottom: "20px" }}>
              This oral interview is <strong>recorded</strong> (your screen, the
              interviewer&apos;s voice and your microphone) so your teacher can review it
              afterwards. When you click below, choose your screen or this tab and
              <strong> tick “Share tab/system audio”</strong> so the interviewer&apos;s voice is captured.
            </p>
            {recordingNotice && (
              <p style={{ color: "var(--color-warning)", fontSize: "13px", marginBottom: "16px" }}>{recordingNotice}</p>
            )}
            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={beginInterview}
              disabled={preparing}
            >
              {preparing ? "Waiting for screen permission…" : "Share screen & begin"}
            </button>
            {recordingNotice && (
              <button
                className="btn btn-secondary"
                style={{ width: "100%", marginTop: "12px" }}
                onClick={continueWithoutRecording}
                disabled={preparing}
              >
                Continue without recording
              </button>
            )}
            <Link href={backHref} style={{ display: "inline-block", marginTop: "16px", fontSize: "13px", color: "var(--text-muted)" }}>
              Cancel
            </Link>
          </div>
        </div>
      </>
    );
  }

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

  // Captions follow whoever is *actively* talking:
  //  • Mav's voice playing       → show her line
  //  • mic recording             → "Listening…" prompt (server STT isn't live)
  //  • transcribing / transcript → show the student's transcribed answer
  let captionText = "";
  let captionSpeaker = "";
  if (aiVoiceActive && currentAIText) {
    captionText = currentAIText;
    captionSpeaker = "AI Assessor";
  } else if (micActive) {
    captionText = liveTranscript.trim() ? liveTranscript : "🎙 Listening… speak your answer";
    captionSpeaker = "You (Speaking)";
  } else if (liveTranscript.trim()) {
    captionText = liveTranscript;
    captionSpeaker = "You";
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
              {/* eslint-disable-next-line @next/next/no-img-element -- two tiny
                  local avatar frames swapped every 200ms; next/image's optimizer
                  pipeline would add latency/flicker to the lip-sync animation. */}
              <img
                src={(aiVoiceActive && avatarMouthOpen ? avatarOpened : avatarClosed).src}
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
          {micActive && (
            <div style={{ textAlign: "center", marginTop: "8px", fontSize: "12px", color: "#9aa0a6" }}>
              Speak your answer — it submits automatically after a short pause, or click 🎤 to submit now
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
              {status === "TRANSCRIBING" ? (
                <span style={{ color: "#8ab4f8" }}>📝 Transcribing your answer…</span>
              ) : micActive ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>
                  🎙 Listening… speak your answer. Click 🎤 to submit, or just pause when done
                </span>
              ) : status === "AI SPEAKING" ? (
                <span style={{ color: "#8ab4f8" }}>🔊 Mav is speaking… mic opens automatically when done</span>
              ) : waitingForStudent ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>🎤 Mic is open — speak your answer or click 🎤 to submit manually</span>
              ) : (
                <span style={{ color: "#9aa0a6" }}>I am processing your response…</span>
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
