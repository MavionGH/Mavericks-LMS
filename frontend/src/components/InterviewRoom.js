"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { GoogleGenAI, Modality, Type } from "@google/genai";
// AI avatar frames (in frontend/local). Swapping between them while the AI
// speaks makes the avatar look like it's talking.
import avatarClosed from "../../local/closed.png";
import avatarOpened from "../../local/opened.png";

// ── Gemini Live API (speech-to-speech) ──────────────────────────────────────────
// The browser opens ONE WebSocket connection straight to Gemini and streams the
// mic audio continuously (16kHz PCM16); Gemini streams Mav's voice back as she
// speaks (24kHz PCM16). There is no per-turn record→upload→STT→LLM→TTS round-trip
// through our backend. The only backend calls are:
//   • POST /api/interview/realtime/start  → ephemeral token + context (once)
//   • POST /api/interview/realtime/finish → grade the transcript (once, at end)
//
// Ephemeral tokens require the v1alpha API surface (see also realtime.py).
const GEMINI_API_VERSION = "v1alpha";

// Gemini Live's required audio wire format: mono PCM16, 16kHz in, 24kHz out.
const MIC_SAMPLE_RATE = 16000;
const PLAYBACK_SAMPLE_RATE = 24000;
// RMS above which the student's own mic is treated as "speaking" — mirrors the
// AI_VOICE_RMS_THRESHOLD approach below since Gemini Live (unlike OpenAI) has no
// discrete speech_started/speech_stopped server event to key off of.
const MIC_RMS_THRESHOLD = 0.02;
const MIC_VOICE_HOLD_MS = 500;

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

// Mav calls this tool exactly once per genuine answer or explicit skip — never
// for a repeat/clarify request or off-topic chitchat (see the system
// instructions built server-side in realtime.py). It's the ONLY signal we use
// to advance the question counter and decide when to wrap up, since Gemini
// Live's transcription has no notion of "this reply counted as progress" on
// its own the way a discrete per-turn event would.
const MARK_ANSWERED_TOOL = {
  functionDeclarations: [
    {
      name: "mark_question_answered",
      description:
        "Call this exactly once, right after the candidate gives a complete " +
        "response to the CURRENT interview question — either a genuine attempt " +
        "(right or wrong) or an explicit 'I don't know' / skip / move on. Do NOT " +
        "call this when repeating/clarifying the question, or when answering an " +
        "off-topic/personal/chitchat remark before re-asking the same question.",
      parameters: { type: Type.OBJECT, properties: {} },
    },
  ],
};

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

// ── PCM16 <-> base64 helpers for the raw audio Gemini Live expects ──────────────
// Convert Float32 samples (Web Audio's native format) to little-endian Int16 PCM.
function floatTo16BitPCM(float32Array) {
  const out = new Int16Array(float32Array.length);
  for (let i = 0; i < float32Array.length; i++) {
    const s = Math.max(-1, Math.min(1, float32Array[i]));
    out[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  return out;
}

// Average-based downsample from the mic's native rate to Gemini's required 16kHz.
function downsampleTo16k(float32Array, inputSampleRate) {
  if (inputSampleRate === MIC_SAMPLE_RATE) return float32Array;
  const ratio = inputSampleRate / MIC_SAMPLE_RATE;
  const newLength = Math.round(float32Array.length / ratio);
  const result = new Float32Array(newLength);
  let offsetResult = 0;
  let offsetBuffer = 0;
  while (offsetResult < newLength) {
    const nextOffsetBuffer = Math.round((offsetResult + 1) * ratio);
    let accum = 0;
    let count = 0;
    for (let i = offsetBuffer; i < nextOffsetBuffer && i < float32Array.length; i++) {
      accum += float32Array[i];
      count++;
    }
    result[offsetResult] = count ? accum / count : 0;
    offsetResult++;
    offsetBuffer = nextOffsetBuffer;
  }
  return result;
}

function arrayBufferToBase64(buffer) {
  let binary = "";
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function base64ToInt16Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Int16Array(bytes.buffer);
}

// ── Fallback progress classifier ────────────────────────────────────────────────
// `mark_question_answered` (see MARK_ANSWERED_TOOL below) is the primary signal
// for question progress, but LLM tool-calling isn't 100% reliable — verified
// live, Mav sometimes does the right conversational thing (moves on) without
// actually calling the tool. This mirrors the same fast-path regexes the
// graph-based interview already uses server-side (see llm.py's
// _GREETING_PATTERNS/_PERSONAL_PATTERNS/_CLARIFICATION_PATTERNS/_OFFTOPIC_PATTERNS)
// as a safety net: only consulted when the tool didn't fire for a given turn.
const SKIP_PHRASES = [
  "i don't know", "i dont know", "i do not know", "not sure", "no idea",
  "no experience", "skip", "pass", "move on", "move to next", "next question",
  "i'm not sure", "i am not sure", "don't know", "dont know",
];
const REPEAT_RE = /\b(repeat|say (that|it) again|come again|didn'?t (catch|hear)|one more time|repeat (that|it|the question)|say (that )?once more|what was the question|what'?s the question again)\b/i;
const CLARIFY_RE = /\b(what do you mean|can you (explain|clarify|elaborate|rephrase)|i don'?t understand|could you (explain|clarify|repeat)|what is meant by|please (explain|clarify|repeat))\b/i;
const GREETING_RE = /^\s*(hi+|hello+|hey+|good (morning|afternoon|evening|day)|howdy|sup|yo|greetings)\b/i;
const PERSONAL_RE = /\b(how are you|how do you do|you doing|are you (ok|good|fine|well|alright)|what('s| is) up|how'?s it going)\b/i;
const OFFTOPIC_RE = /\b(weather|the time|what time|today'?s date|who (are|is) you|your name|tell me a joke|joke|news|sports|music|movie|song|recipe|food|cook|are you (real|human|a robot))\b/i;

function looksLikeAnsweredTurn(text) {
  const t = (text || "").trim().toLowerCase();
  if (!t) return false;
  if (SKIP_PHRASES.some((p) => t.includes(p))) return true;
  if (REPEAT_RE.test(t) || CLARIFY_RE.test(t)) return false;
  if (GREETING_RE.test(t) || PERSONAL_RE.test(t) || OFFTOPIC_RE.test(t)) return false;
  // Short, ambiguous utterances ("what?", "sorry?", a stray word) are NOT
  // treated as genuine answers by default — only a clear skip phrase or
  // substantive text (roughly a sentence or more) counts. Mirrors llm.py's
  // _is_obvious_answer fast-path, and matters most on the LAST question: a
  // false "answered" here would otherwise end the interview right then.
  if (t.split(/\s+/).length < 6) return false;
  return true; // substantive, non-chitchat text -> treat as a genuine answer
}

// Mav is told (see realtime.py's wrap-up instructions) to include a clear
// closing word only once the 5th question has actually been answered/skipped.
// Gating the actual "leave the meeting" trigger on detecting this phrase in
// her own reply — rather than purely on the answer counter above — means a
// mis-fired tool call or heuristic on a repeat/chitchat aside during the LAST
// question can never end the interview by itself; only Mav's own real
// goodbye can.
const GOODBYE_RE = /\b(goodbye|good bye|take care|that'?s all for today|that concludes|assessment is complete|thanks? for (your time|joining|participating)|all the best|wish you (well|luck)|talk to you (soon|later))\b/i;

/**
 * Shared, voice-driven AI interview room used by both the (legacy) per-module
 * assessment and the course-wide final assessment. Conversation runs over the
 * Gemini Live API directly from the browser; the backend only mints the
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
  const [isGrading, setIsGrading] = useState(false); // ended the call, waiting on /finish's grading
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

  // ── Realtime (Gemini Live) refs ──
  const sessionRef = useRef(null);            // Gemini Live Session (ai.live.connect())
  const pcMicStreamRef = useRef(null);        // mic track streamed to Gemini
  const micCtxRef = useRef(null);             // AudioContext capturing + downsampling the mic
  const micProcessorRef = useRef(null);       // ScriptProcessorNode doing the PCM16 encode
  const micActiveRef = useRef(false);         // mirrors micActive state for the audio callback
  const playCtxRef = useRef(null);            // AudioContext playing Mav's voice (24kHz PCM16)
  const playGainRef = useRef(null);           // gain node all played chunks route through
  const playAnalyserRef = useRef(null);       // analyser on the playback chain, drives lip-sync
  const nextPlayTimeRef = useRef(0);          // scheduling cursor for gapless chunk playback
  const voiceIntervalRef = useRef(null);      // RMS polling interval for lip-sync
  const transcriptRef = useRef([]);           // source of truth sent to /finish
  const aiTextRef = useRef("");               // assistant transcript accumulator
  const userTextRef = useRef("");             // student transcript accumulator
  const answersRef = useRef(0);               // count of answers the student has given
  const turnToolFiredRef = useRef(false);     // did mark_question_answered fire this turn?
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
  // any particular server event name. `analyser` is already wired into the
  // playback graph by connectRealtime (Gemini streams raw PCM chunks, not a
  // MediaStream, so there's no <audio>/ontrack to hang an analyser off of here).
  const setupVoiceAnalyser = useCallback((analyser) => {
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
  }, []);

  // Schedule one 24kHz PCM16 chunk of Mav's voice for gapless playback, queued
  // back-to-back on the shared AudioContext clock.
  const playPcmChunk = useCallback((base64Pcm) => {
    const ctx = playCtxRef.current;
    const gain = playGainRef.current;
    if (!ctx || !gain) return;
    const int16 = base64ToInt16Array(base64Pcm);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x8000;
    const buffer = ctx.createBuffer(1, float32.length, PLAYBACK_SAMPLE_RATE);
    buffer.copyToChannel(float32, 0);
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.connect(gain);
    const startAt = Math.max(ctx.currentTime, nextPlayTimeRef.current);
    src.start(startAt);
    nextPlayTimeRef.current = startAt + buffer.duration;
  }, []);

  // Handle one Gemini Live server message. Unlike OpenAI, Gemini has no discrete
  // speech_started/response.created-style events — each message just carries
  // whatever text/audio/transcription is ready, and `turnComplete` marks the end
  // of Mav's spoken turn. The student's "speaking" indicator is driven
  // separately from local mic RMS (see startMicCapture) since Gemini's input
  // transcription isn't tied to a start/stop boundary either.
  const handleRealtimeEvent = useCallback((message) => {
    if (message.setupComplete) {
      tlog("Gemini Live setup complete");
      return;
    }

    // Mav calling `mark_question_answered` is the sole signal that the current
    // question counted as answered — see MARK_ANSWERED_TOOL and the system
    // instructions built in realtime.py for exactly when she's told to call it.
    if (message.toolCall?.functionCalls?.length) {
      for (const call of message.toolCall.functionCalls) {
        if (call.name === "mark_question_answered") {
          turnToolFiredRef.current = true;
          answersRef.current += 1;
          setQuestionNum(Math.min(answersRef.current, MAX_QUESTIONS));
        }
        // Every tool call must get a response or Gemini stalls generation —
        // acknowledge unconditionally, even for an unexpected function name.
        try {
          sessionRef.current?.sendToolResponse({
            functionResponses: { id: call.id, name: call.name, response: { output: "ok" } },
          });
        } catch (e) {
          tlog("sendToolResponse failed: " + (e?.message || e));
        }
      }
    }

    const sc = message.serverContent;
    if (!sc) return;

    const inputText = sc.inputTranscription?.text;
    if (inputText) {
      userTextRef.current += inputText;
      setLiveTranscript(userTextRef.current);
    }

    const outputText = sc.outputTranscription?.text;
    if (outputText) {
      if (!aiTextRef.current) setStatus("AI SPEAKING");
      aiTextRef.current += outputText;
      setCurrentAIText(aiTextRef.current);
    }

    for (const part of sc.modelTurn?.parts || []) {
      if (part.inlineData?.data) playPcmChunk(part.inlineData.data);
    }

    if (sc.interrupted) {
      tlog("Gemini Live turn interrupted by the student");
    }

    if (sc.turnComplete) {
      // Flush whatever accumulated since the last turn: the student's spoken
      // answer (if any — the opening turn has none) first, then Mav's reply,
      // preserving conversation order in the saved transcript.
      const studentText = userTextRef.current.trim();
      userTextRef.current = "";
      if (studentText) {
        pushTranscript({ speaker: "student", text: studentText });
        setLiveTranscript(studentText);
        // Progress is normally driven solely by the mark_question_answered tool
        // call above. But LLM tool-calling isn't 100% reliable — verified live,
        // Mav sometimes moves on without calling it — so if it didn't fire this
        // turn, fall back to classifying the student's own words instead.
        if (!turnToolFiredRef.current && looksLikeAnsweredTurn(studentText)) {
          answersRef.current += 1;
          setQuestionNum(Math.min(answersRef.current, MAX_QUESTIONS));
        }
      }
      turnToolFiredRef.current = false;
      const aiText = aiTextRef.current.trim();
      aiTextRef.current = "";
      if (aiText) {
        pushTranscript({ speaker: "ai", text: aiText });
        setCurrentAIText(aiText);
      }
      // Flag the interview to end (after Mav finishes speaking, handled in an
      // effect) ONLY when she's actually said a real goodbye — not purely on
      // the answer counter. This is deliberate: if a repeat/clarify or
      // chitchat aside during the LAST question were ever misclassified as an
      // answer (mis-fired tool call, or a heuristic miss), the counter alone
      // would end the meeting right then, even though Mav just re-asked the
      // question. Requiring her own closing language as well means only an
      // actual wrap-up can end the session.
      if (aiText && GOODBYE_RE.test(aiText) && answersRef.current >= MAX_QUESTIONS - 1) {
        setShouldEnd(true);
      } else {
        setStatus("WAITING FOR YOU");
      }
    }
  }, [pushTranscript, playPcmChunk]);

  // Kick Mav off right after connecting — Gemini Live (unlike OpenAI) won't
  // speak first on its own, so we send a scripted turn asking her to begin.
  // This goes in as `clientContent`, not spoken audio, so it never reaches
  // input transcription and can't leak into the saved transcript as something
  // the student "said".
  const configureSession = useCallback((session) => {
    try {
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: "Let's begin the interview." }] }],
        turnComplete: true,
      });
    } catch (e) {
      tlog("configureSession failed: " + (e?.message || e));
    }
  }, []);

  // Tear down the Gemini Live session + mic capture + playback graph. Idempotent.
  const teardownRealtime = useCallback(() => {
    if (teardownDoneRef.current) return;
    teardownDoneRef.current = true;
    if (voiceIntervalRef.current) { clearInterval(voiceIntervalRef.current); voiceIntervalRef.current = null; }
    if (micProcessorRef.current) { try { micProcessorRef.current.disconnect(); } catch { /* noop */ } micProcessorRef.current = null; }
    if (micCtxRef.current) { try { micCtxRef.current.close(); } catch { /* noop */ } micCtxRef.current = null; }
    if (pcMicStreamRef.current) { pcMicStreamRef.current.getTracks().forEach((tr) => tr.stop()); pcMicStreamRef.current = null; }
    if (sessionRef.current) { try { sessionRef.current.close(); } catch { /* noop */ } sessionRef.current = null; }
    if (playCtxRef.current) { try { playCtxRef.current.close(); } catch { /* noop */ } playCtxRef.current = null; }
    playGainRef.current = null;
    playAnalyserRef.current = null;
    nextPlayTimeRef.current = 0;
    micActiveRef.current = false;
    setAiVoiceActive(false);
    setMicActive(false);
  }, []);

  // Capture the student's mic, downsample to 16kHz PCM16, and stream it to
  // Gemini continuously. Also drives the local "LISTENING" indicator from mic
  // RMS, since Gemini's automatic voice-activity detection doesn't surface a
  // discrete speech_started/speech_stopped event to the client the way OpenAI did.
  const startMicCapture = useCallback((stream, session) => {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const ctx = new AudioCtx();
    micCtxRef.current = ctx;
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    micProcessorRef.current = processor;
    const inputSampleRate = ctx.sampleRate;
    let lastLoudAt = 0;

    processor.onaudioprocess = (e) => {
      const input = e.inputBuffer.getChannelData(0);
      let sum = 0;
      for (let i = 0; i < input.length; i++) sum += input[i] * input[i];
      const rms = Math.sqrt(sum / input.length);
      const now = Date.now();
      if (rms > MIC_RMS_THRESHOLD) {
        lastLoudAt = now;
        if (!micActiveRef.current) {
          micActiveRef.current = true;
          setIsGreeting(false);
          setMicActive(true);
          setStatus("LISTENING");
        }
      } else if (micActiveRef.current && now - lastLoudAt > MIC_VOICE_HOLD_MS) {
        micActiveRef.current = false;
        setMicActive(false);
      }

      const downsampled = downsampleTo16k(input, inputSampleRate);
      const pcm16 = floatTo16BitPCM(downsampled);
      const b64 = arrayBufferToBase64(pcm16.buffer);
      try {
        session.sendRealtimeInput({ audio: { data: b64, mimeType: `audio/pcm;rate=${MIC_SAMPLE_RATE}` } });
      } catch {
        // Session already closing — drop the chunk.
      }
    };

    source.connect(processor);
    // A ScriptProcessorNode only fires while connected into the graph; route it
    // through a muted gain so the student never hears their own mic looped back.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    processor.connect(mute);
    mute.connect(ctx.destination);
  }, []);

  // Open the Gemini Live session using the ephemeral token, wire up playback for
  // Mav's voice, then start streaming the student's mic.
  const connectRealtime = useCallback(async (startData) => {
    const clientSecret = startData.client_secret;
    const model = startData.model;
    const voice = startData.voice;
    const instructions = startData.instructions;
    if (!clientSecret) throw new Error("No realtime token returned — cannot start the interview.");
    teardownDoneRef.current = false;

    // Playback graph for Mav's voice (Gemini streams raw 24kHz PCM16, not a
    // MediaStream, so we build our own AudioContext instead of an <audio> el).
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    const playCtx = new AudioCtx({ sampleRate: PLAYBACK_SAMPLE_RATE });
    playCtxRef.current = playCtx;
    const gain = playCtx.createGain();
    const analyser = playCtx.createAnalyser();
    analyser.fftSize = 512;
    gain.connect(analyser);
    analyser.connect(playCtx.destination);
    playGainRef.current = gain;
    playAnalyserRef.current = analyser;
    nextPlayTimeRef.current = 0;
    setupVoiceAnalyser(analyser);

    const ai = new GoogleGenAI({ apiKey: clientSecret, apiVersion: GEMINI_API_VERSION });
    const session = await ai.live.connect({
      model,
      config: {
        responseModalities: [Modality.AUDIO],
        systemInstruction: instructions,
        speechConfig: voice
          ? { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } }
          : undefined,
        inputAudioTranscription: {},
        outputAudioTranscription: {},
        tools: [MARK_ANSWERED_TOOL],
      },
      callbacks: {
        onopen: () => tlog("Gemini Live session open"),
        onmessage: (message) => handleRealtimeEvent(message),
        onerror: (e) => tlog("Gemini Live error: " + (e?.message || e)),
        onclose: () => tlog("Gemini Live session closed"),
      },
    });
    sessionRef.current = session;
    // `connect()` only resolves once the socket is open, so it's safe to kick
    // off the conversation immediately rather than waiting on the onopen callback.
    configureSession(session);

    // Stream the student's mic to Gemini.
    const mic = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: false,
    });
    pcMicStreamRef.current = mic;
    startMicCapture(mic, session);

    tlog("Gemini Live connected");
  }, [configureSession, handleRealtimeEvent, setupVoiceAnalyser, startMicCapture]);

  // Send a typed answer (the accessibility fallback when the student would
  // rather type than speak) as a scripted client-content turn. Rather than
  // pushing to the transcript / counting progress here, it's written into
  // userTextRef so it flows through the exact same turnComplete handling as a
  // spoken answer — one shared place decides the tool-call-or-heuristic count.
  const sendTypedAnswer = useCallback((text) => {
    const session = sessionRef.current;
    const trimmed = (text || "").trim();
    if (!session || !trimmed) return;
    userTextRef.current = trimmed;
    setLiveTranscript(trimmed);
    try {
      session.sendClientContent({
        turns: [{ role: "user", parts: [{ text: trimmed }] }],
        turnComplete: true,
      });
    } catch (e) {
      tlog("sendTypedAnswer failed: " + (e?.message || e));
    }
    setStatus("AI PROCESSING");
  }, []);

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
  // then open the Gemini Live session. Mav greets and the conversation begins.
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
  // isGrading swaps the whole screen to a "Calculating your results…" page for
  // the (few-second) grading round-trip, instead of leaving the meet UI up.
  const handleEndCall = useCallback(async () => {
    if (!sessionId) return;
    teardownRealtime();
    setStatus("AI PROCESSING");
    setIsGrading(true);
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
    } finally {
      setIsGrading(false);
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

  if (isGrading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ display: "grid", placeItems: "center", minHeight: "100vh", backgroundColor: "var(--bg-canvas)" }}>
          <div style={{ textAlign: "center" }}>
            <div style={{
              width: 36, height: 36,
              margin: "0 auto 20px",
              border: "3px solid var(--border-muted)",
              borderTopColor: "var(--brand)",
              borderRadius: "50%",
              animation: "spin 0.7s linear infinite",
            }} />
            <p style={{ color: "var(--text-title)", fontSize: "16px", fontWeight: "600", marginBottom: "8px" }}>
              Calculating your results…
            </p>
            <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
              Grading your responses on technical accuracy, communication, and confidence.
            </p>
          </div>
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
