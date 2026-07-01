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

// ── OpenAI Realtime API (speech-to-speech) ─────────────────────────────────────
// The browser opens ONE WebRTC connection straight to OpenAI and streams the mic
// audio continuously; OpenAI streams Mav's voice back as it speaks. There is no
// per-turn record→upload→STT→LLM→TTS round-trip through our backend, which is
// what kept latency at ~10s before. Now the only backend calls are:
//   • POST /api/interview/realtime/start  → ephemeral token + context (once)
//   • POST /api/interview/realtime/finish → grade the transcript (once, at end)
//
// SDP exchange endpoint. GA `gpt-realtime` uses /v1/realtime/calls; override via
// NEXT_PUBLIC_OPENAI_REALTIME_URL if your account is on a different path.
const REALTIME_BASE_URL =
  process.env.NEXT_PUBLIC_OPENAI_REALTIME_URL || "https://api.openai.com/v1/realtime/calls";

// RMS above which we treat Mav's incoming audio as "actively speaking" — drives
// the avatar lip-sync and the "AI SPEAKING" label without depending on any
// particular server event name.
const AI_VOICE_RMS_THRESHOLD = 0.01;
// Hold "speaking" true for this long after the level drops, so the natural
// sub-second gaps between words don't make the avatar/status/bar flicker.
const AI_VOICE_HOLD_MS = 600;

// The interview is capped at exactly this many questions. The model is also
// instructed to stop at this count, but we enforce it client-side (count the
// student's answers) so a free-flowing realtime session can never run long.
const MAX_QUESTIONS = 5;

// TEMP instrumentation: timestamped logs across the realtime pipeline. Flip off
// to silence.
const VOICE_DEBUG = true;
function tlog(label) {
  if (!VOICE_DEBUG || typeof console === "undefined") return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  console.log(`[realtime ${now.toFixed(0)}ms] ${label}`);
}

// Turn a raw fetch/network rejection into a calm, actionable message for the UI.
function friendlyNetworkError(err) {
  if (err?.name === "AbortError") {
    return "The connection took too long — please try again.";
  }
  if (/failed to fetch|networkerror|load failed|fetch failed/i.test(err?.message || "")) {
    return "Couldn't reach the interview service. Check your connection and try again.";
  }
  return err?.message || "Something went wrong — please try again.";
}

/**
 * Shared, voice-driven AI interview room used by both the (legacy) per-module
 * assessment and the course-wide final assessment. Conversation runs over the
 * OpenAI Realtime API directly from the browser; the backend only mints the
 * token and grades the result.
 *
 * Props:
 *   doStart       async () => realtime start payload
 *                 { session_id, client_secret, model, course_name, ... }
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
  const [currentAIText, setCurrentAIText] = useState("");
  const [micActive, setMicActive] = useState(false);       // student currently speaking (server VAD)
  const [micMuted, setMicMuted] = useState(false);
  const [showCaptions, setShowCaptions] = useState(true);
  const [isFinished, setIsFinished] = useState(false);
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liveTranscript, setLiveTranscript] = useState("");
  const [questionNum, setQuestionNum] = useState(0);       // 0 → greeting, then Q1, Q2…
  const [status, setStatus] = useState("CONNECTING");
  const [typedAnswer, setTypedAnswer] = useState("");
  const [avatarMouthOpen, setAvatarMouthOpen] = useState(false);
  const [aiVoiceActive, setAiVoiceActive] = useState(false);
  const [cameraOn, setCameraOn] = useState(false);
  const [cameraError, setCameraError] = useState("");
  // Whole-session recording (screen + Mav's voice + student mic → R2).
  const [hasStarted, setHasStarted] = useState(false);   // consent gate passed
  const [preparing, setPreparing] = useState(false);     // acquiring screen share
  const [recordingNotice, setRecordingNotice] = useState(""); // non-fatal warning
  // True from connect until the student first speaks — shows the "greeting" label.
  const [isGreeting, setIsGreeting] = useState(false);

  const studentVideoRef = useRef(null);
  const cameraStreamRef = useRef(null);

  // ── Realtime (WebRTC) refs ──
  const pcRef = useRef(null);                 // RTCPeerConnection to OpenAI
  const dcRef = useRef(null);                 // data channel for realtime events
  const remoteAudioRef = useRef(null);        // <audio> playing Mav's voice
  const pcMicStreamRef = useRef(null);        // mic track sent to OpenAI
  const voiceCtxRef = useRef(null);           // AudioContext analysing Mav's voice
  const voiceIntervalRef = useRef(null);      // RMS polling interval for lip-sync
  const transcriptRef = useRef([]);           // source of truth sent to /finish
  const aiTextRef = useRef("");               // assistant transcript accumulator
  const userTextRef = useRef("");             // student transcript accumulator
  const answersRef = useRef(0);               // count of answers the student has given
  const autoEndTriggeredRef = useRef(false);  // guard: auto-finish fires once
  const teardownDoneRef = useRef(false);
  const [shouldEnd, setShouldEnd] = useState(false); // 5 answers given → wrap up

  // ── Whole-session recorder refs (independent of the realtime mic) ──
  const sessionIdRef = useRef(null);          // live mirror of sessionId for late callbacks
  const sessionRecorderRef = useRef(null);    // MediaRecorder for the full session
  const sessionChunksRef = useRef([]);        // recorded blob chunks
  const displayStreamRef = useRef(null);      // getDisplayMedia (screen + system audio)
  const recordMicStreamRef = useRef(null);    // dedicated mic stream for the recording mix
  const recordAudioCtxRef = useRef(null);     // AudioContext that mixes screen + mic audio
  const recordingActiveRef = useRef(false);   // true while the session recorder is running
  const recordingPreparedRef = useRef(false); // devices acquired + recorder built, not yet started
  const recordingUploadedRef = useRef(false); // guard: upload/stop runs exactly once
  const finalizeSessionRecordingRef = useRef(null);

  const studentInitials = user?.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : "ST";

  // "Thinking/talking" — used for the panel activity indicator.
  const isAISpeaking = aiVoiceActive || status === "AI PROCESSING" || status === "AI SPEAKING";
  const connected = !!sessionId && !isFinished && status !== "CONNECTING";
  const yourTurn = connected && !aiVoiceActive && !isFinished;

  // Append a finalized line to the transcript ref sent to /finish.
  const pushTranscript = useCallback((entry) => {
    transcriptRef.current = [...transcriptRef.current, entry];
  }, []);

  // Watch Mav's incoming audio level so the avatar lip-syncs and the status label
  // flips to "AI SPEAKING" only while sound is actually playing — independent of
  // any particular server event name.
  const setupVoiceAnalyser = useCallback((stream) => {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      const ctx = new AudioCtx();
      voiceCtxRef.current = ctx;
      if (ctx.state === "suspended") ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      const buf = new Uint8Array(analyser.fftSize);
      // Hysteresis: go active immediately when the level rises, but only fall
      // back to idle after AI_VOICE_HOLD_MS of continuous silence. Since React
      // skips a re-render when the state value is unchanged, holding `true`
      // across the word gaps stops the bottom-bar/avatar flicker.
      let lastLoudAt = 0;
      voiceIntervalRef.current = setInterval(() => {
        analyser.getByteTimeDomainData(buf);
        let sum = 0;
        for (let i = 0; i < buf.length; i++) { const v = (buf[i] - 128) / 128; sum += v * v; }
        const rms = Math.sqrt(sum / buf.length);
        const now = Date.now();
        if (rms > AI_VOICE_RMS_THRESHOLD) {
          lastLoudAt = now;
          setAiVoiceActive(true);
        } else if (now - lastLoudAt > AI_VOICE_HOLD_MS) {
          setAiVoiceActive(false);
        }
      }, 100);
    } catch (e) {
      tlog("voice analyser init failed (non-fatal): " + (e?.message || e));
    }
  }, []);

  // Handle one realtime server event arriving on the data channel. Field names are
  // matched tolerantly (delta/done suffixes) so minor API-version differences in
  // the transcript event names don't drop captions.
  const handleRealtimeEvent = useCallback((evt) => {
    const t = evt.type || "";
    if (t === "input_audio_buffer.speech_started") {
      setIsGreeting(false);
      setMicActive(true);
      setStatus("LISTENING");
    } else if (t === "input_audio_buffer.speech_stopped") {
      setMicActive(false);
      setStatus("AI PROCESSING");
    } else if (t.endsWith("input_audio_transcription.delta")) {
      userTextRef.current += evt.delta || "";
      setLiveTranscript(userTextRef.current);
    } else if (t.endsWith("input_audio_transcription.completed")) {
      const text = (evt.transcript || userTextRef.current || "").trim();
      userTextRef.current = "";
      if (text) {
        pushTranscript({ speaker: "student", text });
        setLiveTranscript(text);
        answersRef.current += 1;
      }
    } else if (t === "response.created") {
      aiTextRef.current = "";
      setStatus("AI SPEAKING");
    } else if (t.includes("audio_transcript") && t.endsWith(".delta")) {
      aiTextRef.current += evt.delta || "";
      setCurrentAIText(aiTextRef.current);
    } else if (t.includes("audio_transcript") && t.endsWith(".done")) {
      const text = (evt.transcript || aiTextRef.current || "").trim();
      aiTextRef.current = "";
      if (text) {
        pushTranscript({ speaker: "ai", text });
        setCurrentAIText(text);
        setQuestionNum((n) => Math.min(n + 1, MAX_QUESTIONS));
      }
    } else if (t === "response.done") {
      // Once the student has answered all questions, flag the interview to end
      // after Mav finishes speaking her closing remark (handled in an effect).
      if (answersRef.current >= MAX_QUESTIONS) {
        setShouldEnd(true);
      } else {
        setStatus("WAITING FOR YOU");
      }
    } else if (t === "error") {
      tlog("realtime error event: " + JSON.stringify(evt.error || evt));
    }
  }, [pushTranscript]);

  // Configure the session once the data channel is open, then ask Mav to open the
  // interview (speak the greeting + first question).
  const configureSession = useCallback((dc) => {
    try {
      // Enable transcription of the student's speech and server-side turn
      // detection so Mav waits for the student to finish before replying.
      dc.send(JSON.stringify({
        type: "session.update",
        session: {
          type: "realtime",
          audio: {
            input: {
              // Pin transcription to English so the captions (and the saved
              // transcript) don't get mis-detected as another language.
              transcription: { model: "whisper-1", language: "en" },
              turn_detection: { type: "server_vad", silence_duration_ms: 700 },
            },
          },
        },
      }));
      // Kick off the conversation — Mav greets and asks the first question.
      dc.send(JSON.stringify({ type: "response.create" }));
    } catch (e) {
      tlog("configureSession failed: " + (e?.message || e));
    }
  }, []);

  // Tear down the WebRTC connection + analyser + mic. Idempotent.
  const teardownRealtime = useCallback(() => {
    if (teardownDoneRef.current) return;
    teardownDoneRef.current = true;
    if (voiceIntervalRef.current) { clearInterval(voiceIntervalRef.current); voiceIntervalRef.current = null; }
    if (voiceCtxRef.current) { try { voiceCtxRef.current.close(); } catch { /* noop */ } voiceCtxRef.current = null; }
    if (dcRef.current) { try { dcRef.current.close(); } catch { /* noop */ } dcRef.current = null; }
    if (pcMicStreamRef.current) { pcMicStreamRef.current.getTracks().forEach((tr) => tr.stop()); pcMicStreamRef.current = null; }
    if (pcRef.current) { try { pcRef.current.close(); } catch { /* noop */ } pcRef.current = null; }
    if (remoteAudioRef.current) { try { remoteAudioRef.current.pause(); } catch { /* noop */ } remoteAudioRef.current.srcObject = null; remoteAudioRef.current = null; }
    setAiVoiceActive(false);
    setMicActive(false);
  }, []);

  // Open the WebRTC connection to OpenAI using the ephemeral client secret.
  const connectRealtime = useCallback(async (startData) => {
    const clientSecret = startData.client_secret;
    const model = startData.model;
    if (!clientSecret) throw new Error("No realtime token returned — cannot start the interview.");
    teardownDoneRef.current = false;

    const pc = new RTCPeerConnection();
    pcRef.current = pc;

    // Play Mav's voice and analyse it for lip-sync.
    const audioEl = new Audio();
    audioEl.autoplay = true;
    remoteAudioRef.current = audioEl;
    pc.ontrack = (e) => {
      const [stream] = e.streams;
      audioEl.srcObject = stream;
      audioEl.play().catch((err) => tlog("remote audio play() blocked: " + (err?.message || err)));
      setupVoiceAnalyser(stream);
    };

    // Stream the student's mic to OpenAI.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    pcMicStreamRef.current = mic;
    mic.getTracks().forEach((tr) => pc.addTrack(tr, mic));

    // Realtime events flow over a data channel.
    const dc = pc.createDataChannel("oai-events");
    dcRef.current = dc;
    dc.onopen = () => { tlog("data channel open"); configureSession(dc); };
    dc.onmessage = (e) => {
      let evt;
      try { evt = JSON.parse(e.data); } catch { return; }
      handleRealtimeEvent(evt);
    };

    // SDP offer/answer handshake with OpenAI (authenticated by the ephemeral key).
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    const resp = await fetch(`${REALTIME_BASE_URL}?model=${encodeURIComponent(model || "")}`, {
      method: "POST",
      body: offer.sdp,
      headers: {
        Authorization: `Bearer ${clientSecret}`,
        "Content-Type": "application/sdp",
      },
    });
    if (!resp.ok) {
      const detail = await resp.text().catch(() => "");
      throw new Error(`Realtime connection failed (${resp.status}). ${detail.slice(0, 200)}`);
    }
    const answerSdp = await resp.text();
    await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });
    tlog("WebRTC connected to OpenAI Realtime");
  }, [configureSession, handleRealtimeEvent, setupVoiceAnalyser]);

  // Send a typed answer over the data channel (the accessibility fallback when
  // the student would rather type than speak).
  const sendTypedAnswer = useCallback((text) => {
    const dc = dcRef.current;
    const trimmed = (text || "").trim();
    if (!dc || dc.readyState !== "open" || !trimmed) return;
    pushTranscript({ speaker: "student", text: trimmed });
    setLiveTranscript(trimmed);
    dc.send(JSON.stringify({
      type: "conversation.item.create",
      item: { type: "message", role: "user", content: [{ type: "input_text", text: trimmed }] },
    }));
    dc.send(JSON.stringify({ type: "response.create" }));
    setStatus("AI PROCESSING");
  }, [pushTranscript]);

  // Toggle the local mic on/off (mute). Realtime streams continuously, so muting
  // simply disables the outgoing track.
  const toggleMute = useCallback(() => {
    const stream = pcMicStreamRef.current;
    if (!stream) return;
    setMicMuted((prev) => {
      const nextMuted = !prev;
      stream.getAudioTracks().forEach((tr) => { tr.enabled = !nextMuted; });
      return nextMuted;
    });
  }, []);

  // ── Whole-session recording (screen + Mav's voice + student mic → R2) ──
  // Begin recording the whole interview: screen + system/tab audio (which carries
  // Mav's voice from the tab) mixed with the student's mic. Returns true if running.
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

    let display;
    try {
      display = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: true,
      });
    } catch {
      return false; // declined / dismissed
    }
    displayStreamRef.current = display;

    let mic = null;
    try {
      mic = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      recordMicStreamRef.current = mic;
    } catch {
      // No mic → still record the screen + Mav's voice.
    }

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
      const a = display.getAudioTracks()[0];
      if (a) tracks.push(a);
    }

    const combined = new MediaStream(tracks);

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

    if (videoTrack) {
      videoTrack.addEventListener("ended", () => {
        if (recordingActiveRef.current) finalizeSessionRecordingRef.current?.();
      });
    }

    recordingPreparedRef.current = true;
    tlog("session recording prepared (waiting for interview screen)");
    return true;
  }, []);

  // Start the prepared recorder once the interview screen is ready.
  const beginSessionCapture = useCallback(() => {
    if (!recordingPreparedRef.current || recordingActiveRef.current) return;
    const rec = sessionRecorderRef.current;
    if (!rec) return;
    try {
      rec.start(1000);
      recordingActiveRef.current = true;
      tlog("session recording started (interview screen visible)");
    } catch (e) {
      tlog("failed to start prepared recorder: " + (e?.message || e));
    }
  }, []);

  // Stop the full-session recorder, upload the file to R2, release devices.
  // Idempotent — safe to call from finish, end-call, and unmount.
  const finalizeSessionRecording = useCallback(async () => {
    if (recordingUploadedRef.current) return;
    const recorder = sessionRecorderRef.current;
    if (!recorder || !recordingActiveRef.current) {
      recordingActiveRef.current = false;
      recordingPreparedRef.current = false;
      if (recordAudioCtxRef.current) { try { recordAudioCtxRef.current.close(); } catch { /* noop */ } recordAudioCtxRef.current = null; }
      if (displayStreamRef.current) { displayStreamRef.current.getTracks().forEach((t) => t.stop()); displayStreamRef.current = null; }
      if (recordMicStreamRef.current) { recordMicStreamRef.current.getTracks().forEach((t) => t.stop()); recordMicStreamRef.current = null; }
      return;
    }
    recordingUploadedRef.current = true;
    recordingActiveRef.current = false;

    const stopped = new Promise((resolve) => {
      recorder.onstop = () => resolve();
      try { recorder.stop(); } catch { resolve(); }
    });
    await stopped;

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
      tlog("interview recording upload failed: " + (e?.message || e));
    }
  }, [authFetch]);

  useEffect(() => {
    finalizeSessionRecordingRef.current = finalizeSessionRecording;
  }, [finalizeSessionRecording]);

  // Start the interview: fetch the ephemeral token + context, start the recorder,
  // then open the WebRTC connection. Mav greets and the conversation begins.
  const startSession = useCallback(async () => {
    setLoading(true);
    setError("");
    setIsGreeting(true);
    try {
      const data = await doStart();
      setSessionId(data.session_id);
      sessionIdRef.current = data.session_id;
      setStatus("CONNECTING");

      // Start recording now so the connection wait isn't captured; the greeting
      // and the whole conversation that follow ARE recorded.
      beginSessionCapture();

      await connectRealtime(data);

      setStatus("AI SPEAKING");
    } catch (err) {
      setIsGreeting(false);
      setError(friendlyNetworkError(err));
      if (!recordingActiveRef.current) finalizeSessionRecordingRef.current?.();
    } finally {
      setLoading(false);
    }
  }, [doStart, connectRealtime, beginSessionCapture]);

  // Consent gate: camera + mic + screen-share are mandatory (screen-share is what
  // lets us record Mav's voice + the student for the teacher to review later).
  const beginInterview = useCallback(async () => {
    setPreparing(true);
    setRecordingNotice("");

    try {
      const camTest = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      camTest.getTracks().forEach((t) => t.stop());
    } catch {
      setPreparing(false);
      setRecordingNotice("⚠️ Camera access is required. Please allow camera permission in your browser and try again.");
      return;
    }

    try {
      const micTest = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      micTest.getTracks().forEach((t) => t.stop());
    } catch {
      setPreparing(false);
      setRecordingNotice("⚠️ Microphone access is required. Please allow microphone permission in your browser and try again.");
      return;
    }

    const ok = await startSessionRecording();
    setPreparing(false);
    if (ok) {
      setHasStarted(true);
    } else {
      setRecordingNotice(
        "⚠️ Screen sharing is required to start the interview. Click the button again and select your screen or this tab — make sure to tick \"Share tab audio\" so Mav's voice is captured."
      );
    }
  }, [startSessionRecording]);

  // Kick off the interview only AFTER the consent gate is passed.
  useEffect(() => {
    if (!hasStarted) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    startSession();
    return () => {
      finalizeSessionRecordingRef.current?.();
      teardownRealtime();
    };
  }, [hasStarted, startSession, teardownRealtime]);

  // Animate the avatar's mouth ONLY while Mav's voice is actually playing.
  useEffect(() => {
    if (!aiVoiceActive) return;
    const interval = setInterval(() => setAvatarMouthOpen((prev) => !prev), 200);
    return () => clearInterval(interval);
  }, [aiVoiceActive]);

  // Play/pause the avatar video based on whether Mav is speaking
  useEffect(() => {
    const video = avatarVideoRef.current;
    if (!video) return;
    if (aiVoiceActive) {
      video.play().catch((err) => {
        tlog("Failed to play avatar video: " + (err?.message || err));
      });
    } else {
      video.pause();
      try {
        video.currentTime = 0;
      } catch { /* noop */ }
    }
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

  // Release the camera once the assessment is complete.
  useEffect(() => {
    if (!isFinished) return;
    if (cameraStreamRef.current) {
      cameraStreamRef.current.getTracks().forEach((t) => t.stop());
      cameraStreamRef.current = null;
      setCameraOn(false);
    }
    teardownRealtime();
  }, [isFinished, teardownRealtime]);

  // Once the interview is over, stop the full-session recorder and upload it to R2.
  useEffect(() => {
    if (!isFinished) return;
    finalizeSessionRecording();
  }, [isFinished, finalizeSessionRecording]);

  // Stable callback ref for the student's <video> so the camera doesn't flicker
  // when the component re-renders (e.g. the 200ms avatar swap).
  const attachStudentVideo = useCallback((el) => {
    studentVideoRef.current = el;
    if (el && cameraStreamRef.current && el.srcObject !== cameraStreamRef.current) {
      el.srcObject = cameraStreamRef.current;
    }
  }, []);

  // End the interview: close the realtime connection, then grade the transcript.
  const handleEndCall = useCallback(async () => {
    if (!sessionId) return;
    teardownRealtime();
    setStatus("AI PROCESSING");
    try {
      const res = await authFetch("/api/interview/realtime/finish", {
        method: "POST",
        body: JSON.stringify({ session_id: sessionId, transcript: transcriptRef.current }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Failed to finish interview");
      }
      const data = await res.json();
      setResults(data);
      setIsFinished(true);
      setStatus("COMPLETE");
    } catch (err) {
      setError(friendlyNetworkError(err));
      setStatus("WAITING FOR YOU");
    }
  }, [authFetch, sessionId, teardownRealtime]);

  // After the student has answered all MAX_QUESTIONS, end the interview once Mav
  // has finished speaking her closing remark (so we don't cut her off), then grade.
  useEffect(() => {
    if (!shouldEnd || isFinished || aiVoiceActive) return;
    if (autoEndTriggeredRef.current) return;
    autoEndTriggeredRef.current = true;
    handleEndCall();
  }, [shouldEnd, aiVoiceActive, isFinished, handleEndCall]);

  // ── Consent gate (screen share + camera + mic are mandatory) ────────────────────
  if (!hasStarted) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ display: "grid", placeItems: "center", minHeight: "100vh", backgroundColor: "var(--bg-canvas)" }}>
          <div className="card" style={{ maxWidth: 540, padding: "40px", textAlign: "center", backgroundColor: "#ffffff" }}>
            <h2 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", marginBottom: "12px" }}>{heading}</h2>

            <div style={{ backgroundColor: "#f8f9fa", borderRadius: "10px", padding: "16px 20px", marginBottom: "20px", textAlign: "left" }}>
              <p style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)", marginBottom: "10px" }}>📋 Required before starting:</p>
              <ul style={{ margin: 0, padding: "0 0 0 18px", fontSize: "13.5px", lineHeight: "2", color: "var(--text-muted)" }}>
                <li>🖥️ <strong>Screen sharing</strong> — select this tab and tick <em>&ldquo;Share tab audio&rdquo;</em> so Mav&apos;s voice is captured</li>
                <li>📷 <strong>Camera</strong> — your video must be visible during the interview</li>
                <li>🎙️ <strong>Microphone</strong> — your voice must be accessible to answer questions</li>
              </ul>
            </div>

            <p style={{ color: "var(--text-muted)", fontSize: "13px", lineHeight: "1.6", marginBottom: "20px" }}>
              This oral interview is <strong>recorded</strong> (your screen, the AI interviewer&apos;s voice and your microphone) so your teacher can review it afterwards.
              The interview <strong>cannot begin</strong> without all three permissions granted.
            </p>

            {recordingNotice && (
              <div style={{
                backgroundColor: "#fff3cd",
                border: "1px solid #ffc107",
                borderRadius: "8px",
                padding: "12px 16px",
                marginBottom: "16px",
                fontSize: "13px",
                color: "#856404",
                textAlign: "left",
              }}>
                {recordingNotice}
              </div>
            )}

            <button
              className="btn btn-primary"
              style={{ width: "100%" }}
              onClick={beginInterview}
              disabled={preparing}
            >
              {preparing ? "Checking permissions…" : "📸 Share Screen, Camera & Mic — Begin Interview"}
            </button>

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
          <p style={{ color: "var(--text-muted)" }}>Connecting to your AI interviewer…</p>
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
  //  • Mav's voice playing → show her line
  //  • student speaking     → show the live transcript / "Listening…" prompt
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
                LIVE AI INTERVIEW — {questionNum === 0 ? "GREETING" : `Q${questionNum}/${MAX_QUESTIONS}`}
              </span>
              <h1 style={{ fontSize: "20px", fontWeight: "600", color: "#ffffff", margin: 0 }}>
                {heading}
              </h1>
            </div>
            <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#e8eaed", backgroundColor: "#202124", padding: "6px 12px", borderRadius: "16px", border: "1px solid #3c4043", fontFamily: "JetBrains Mono" }}>
                {status}
              </span>
            </div>
          </div>

          {/* Video panels */}
          <div className="meet-grid">
            <div className={`meet-panel ${isAISpeaking ? "speaking" : ""}`}>
              <video
                ref={avatarVideoRef}
                src="/avatar.mp4"
                loop
                muted
                playsInline
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  userSelect: "none",
                  display: aiVoiceActive ? "block" : "none",
                }}
              />
              <img
                src={avatarClosed.src}
                alt="Mav — AI Assessor avatar"
                draggable={false}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  objectFit: "cover",
                  userSelect: "none",
                  display: aiVoiceActive ? "none" : "block",
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

          {/* Live hint */}
          {connected && !aiVoiceActive && (
            <div style={{ textAlign: "center", marginTop: "8px", fontSize: "12px", color: "#9aa0a6" }}>
              Just speak naturally — Mav listens continuously and replies in real time.
            </div>
          )}

          {/* Fallback text input (type instead of speak) */}
          {yourTurn && (
            <div style={{ marginTop: "16px", display: "flex", gap: "8px", maxWidth: "600px", margin: "16px auto 0" }}>
              <input
                className="form-input"
                placeholder="Prefer to type? Enter your answer here…"
                value={typedAnswer}
                onChange={(e) => setTypedAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && typedAnswer.trim()) {
                    sendTypedAnswer(typedAnswer);
                    setTypedAnswer("");
                  }
                }}
                style={{ flex: 1, background: "#202124", borderColor: "#3c4043", color: "#fff" }}
              />
              <button
                className="btn btn-secondary btn-sm"
                onClick={() => { if (typedAnswer.trim()) { sendTypedAnswer(typedAnswer); setTypedAnswer(""); } }}
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
                  🎙 Listening… speak your answer, Mav replies when you pause
                </span>
              ) : aiVoiceActive && isGreeting ? (
                <span style={{ color: "#8ab4f8" }}>👋 Mav is greeting you…</span>
              ) : aiVoiceActive ? (
                <span style={{ color: "#8ab4f8" }}>🔊 Mav is speaking…</span>
              ) : status === "AI PROCESSING" ? (
                <span style={{ color: "#9aa0a6" }}>⏳ Thinking…</span>
              ) : connected ? (
                <span style={{ color: "#81c995", fontWeight: "600" }}>🎤 Your turn — just speak</span>
              ) : (
                <span style={{ color: "#9aa0a6" }}>⏳ Connecting…</span>
              )}
            </div>

            <div className="meet-bar-actions">
              <button
                onClick={toggleMute}
                className={`meet-action-btn ${micMuted ? "" : "mic-active"}`}
                title={micMuted ? "Unmute microphone" : "Mute microphone"}
              >
                {micMuted ? "🔇" : "🎤"}
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
