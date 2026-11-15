"use client";
import React, { useState, useEffect } from "react";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import styles from "./landing.module.css";
import FeaturedCourses from "@/components/FeaturedCourses";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";

// Mock data for the interactive simulator using the exact student dashboard schema
const SIMULATOR_QUESTIONS = [
  {
    id: 1,
    question: "Explain the difference between a Process and a Thread in operating systems, and how they share memory.",
    choices: [
      {
        text: "Processes are isolated instances with their own memory space. Threads exist inside processes and share the parent process's memory space, enabling fast communication but introducing the risk of race conditions.",
        technical: 98,
        communication: 95,
        confidence: 92,
        feedback: "Exceptional explanation. You correctly identified virtual memory boundaries for processes, shared memory segments (heap, static text) for threads, and associated thread safety concerns."
      },
      {
        text: "Threads are just processes that run faster because they don't use memory. Processes have to load everything from the hard drive every time, which makes them much slower.",
        technical: 45,
        communication: 60,
        confidence: 75,
        feedback: "Incomplete and partially incorrect. Threads do use memory (private stack and register states) and share virtual memory with the parent process. Processes do not run directly from disk."
      },
      {
        text: "Processes run on the GPU while threads run on the CPU. They communicate through standard database calls which are synchronized automatically.",
        technical: 12,
        communication: 40,
        confidence: 85,
        feedback: "Incorrect. Both processes and threads are CPU scheduling entities. They are not split between CPU and GPU, and their inter-process communication does not rely on database syncs."
      }
    ]
  },
  {
    id: 2,
    question: "What is the difference between REST and GraphQL, and in which scenario would you prefer GraphQL?",
    choices: [
      {
        text: "REST uses fixed endpoints returning fixed data structures. GraphQL uses a single endpoint allowing clients to query exactly the fields they need, which is ideal for complex nested resources or low-bandwidth mobile environments.",
        technical: 96,
        communication: 92,
        confidence: 95,
        feedback: "Perfect analysis of resource over-fetching, endpoint architecture, and client-driven schema querying."
      },
      {
        text: "GraphQL is always faster because it uses binary protocols like WebSockets instead of HTTP. REST is old and cannot send JSON payloads.",
        technical: 38,
        communication: 55,
        confidence: 65,
        feedback: "Incorrect. GraphQL operates over HTTP/POST in most configurations, and REST is heavily reliant on JSON payloads."
      },
      {
        text: "GraphQL is a database query language like SQL but for frontend components, while REST is a system for caching database queries locally.",
        technical: 20,
        communication: 45,
        confidence: 80,
        feedback: "Misunderstood core concept. GraphQL is an API query language and runtime, not a database layer, and REST is an architectural style for network resources."
      }
    ]
  }
];

const ROADMAP_STEPS = [
  { id: "01", name: "Watch Module Videos", desc: "Watch structured lecture materials and visual walkthroughs to understand the core technical concepts of the track.", status: "completed" },
  { id: "02", name: "Read Documentation", desc: "Read deep-dive articles, written breakdowns, and code transcripts to reinforce theoretical structures.", status: "completed" },
  { id: "03", name: "Complete Quizzes", desc: "Take chapter checkpoint quizzes to test syntax recall and verify basic conceptual understanding.", status: "completed" },
  { id: "04", name: "AI Oral Assessment", desc: "Unlock and face the voice-to-voice AI evaluator once all module materials are complete to test your out-loud articulation.", status: "active" },
  { id: "05", name: "Earn Certificates", desc: "Pass the comprehensive AI oral exam with a passing score to instantly generate your verifiable course certificate.", status: "locked" }
];

export default function LandingPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  // Redirect authenticated users to their corresponding dashboard
  useEffect(() => {
    if (!loading && user) {
      if (user.role === "admin") {
        router.replace("/admin");
      } else if (user.role === "teacher") {
        router.replace("/teacher");
      } else {
        router.replace("/dashboard");
      }
    }
  }, [user, loading, router]);

  // Simulator State
  const [simStep, setSimStep] = useState("idle"); // idle, speaking, options, analyzing, results
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [selectedChoice, setSelectedChoice] = useState(null);
  const [waveformBars, setWaveformBars] = useState(Array(30).fill(10));
  const [activeStep, setActiveStep] = useState(2); // index of active step in roadmap UI

  // Clean up any speaking speech synthesis on unmount
  useEffect(() => {
    return () => {
      if (typeof window !== "undefined" && window.speechSynthesis) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  // Waveform animation loop when AI is "speaking" or "analyzing"
  useEffect(() => {
    let interval;
    if (simStep === "speaking" || simStep === "analyzing") {
      interval = setInterval(() => {
        setWaveformBars(
          Array(30)
            .fill(0)
            .map(() => Math.floor(Math.random() * 45) + 8)
        );
      }, 100);
    } else {
      setWaveformBars(Array(30).fill(10));
    }
    return () => clearInterval(interval);
  }, [simStep]);

  // Helper to trigger Speech Synthesis with a human-like voice
  const speakText = (text, onEndCallback = () => {}) => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      
      // Load voices and look for standard natural/premium english voices
      const voices = window.speechSynthesis.getVoices();
      const preferredVoice = voices.find(
        (v) =>
          v.lang.startsWith("en") &&
          (v.name.includes("Google") || v.name.includes("Natural") || v.name.includes("Microsoft") || v.name.includes("Apple"))
      ) || voices.find((v) => v.lang.startsWith("en"));

      if (preferredVoice) {
        utterance.voice = preferredVoice;
      }

      utterance.pitch = 1.0;
      utterance.rate = 0.95; // Slightly slower for clear, professional exam delivery
      
      utterance.onend = () => {
        onEndCallback();
      };
      utterance.onerror = () => {
        onEndCallback();
      };

      window.speechSynthesis.speak(utterance);
    } else {
      // Fallback if synthesis is not supported
      onEndCallback();
    }
  };

  // Start the Simulator
  const startSimulator = () => {
    setSimStep("speaking");
    setSelectedChoice(null);

    const questionText = SIMULATOR_QUESTIONS[currentQuestionIndex].question;
    
    // Speak the question, then reveal choices once the question finishes reading
    let fallbackTimer = setTimeout(() => {
      setSimStep("options");
    }, 7000);

    speakText(questionText, () => {
      clearTimeout(fallbackTimer);
      setSimStep("options");
    });
  };

  // User submits their response option
  const selectResponse = (choice) => {
    setSelectedChoice(choice);
    setSimStep("analyzing");
    
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }

    setTimeout(() => {
      setSimStep("results");
      // Speak the feedback results
      speakText(choice.feedback);
    }, 2400);
  };

  // Next question
  const nextQuestion = () => {
    if (typeof window !== "undefined" && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    setCurrentQuestionIndex((prev) => (prev + 1) % SIMULATOR_QUESTIONS.length);
    setSimStep("idle");
    setSelectedChoice(null);
  };

  const currentQ = SIMULATOR_QUESTIONS[currentQuestionIndex];

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", overflowX: "hidden" }}>
        
        {/* HERO SECTION - SWISS / INTERNATIONAL GRID */}
        <section className={styles.gridSection}>
          {/* Swiss Modernist corner crosshairs */}
          <div className={`${styles.crosshair} ${styles.crosshairTL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairTR}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairBL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairBR}`}>+</div>
          
          <div className={styles.swissContainer}>
            <div className={styles.badge}>MAVERICKS LEARNING PLATFORM / MLP</div>
            <h1 className={styles.swissTitle}>
              True Mastery<br />
              Is Not <span className={styles.accentText}>Multiple Choice.</span>
            </h1>
            <p className={styles.swissSubtitle}>
              Welcome to the systematic evolution of technical learning. MLP replaces passive video watching and rote memorization quizzes with real-time AI oral assessments that evaluate comprehension, communication, and cognitive structure.
            </p>
            
            <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "48px" }}>
              <Link href="/register" className={styles.swissBtn}>Start Your Journey</Link>
              <a href="#simulator" className={styles.swissBtnSecondary}>Try AI Voice Interview</a>
            </div>
            
            <div className={styles.swissGrid2}>
              <div className={styles.gridCol}>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>[ SYSTEM ARCHITECTURE ]</div>
                <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-title)", marginBottom: "16px" }}>VOICE-FIRST COMPREHENSION GATING</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: "1.6" }}>
                  Traditional technical assessments fail to verify conceptual structure. MLP gates progression through active verbal checkpoints, prompting students to articulate complex concepts logically to a responsive, speech-based evaluator.
                </p>
              </div>
              <div className={styles.gridCol}>
                <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "var(--text-muted)", marginBottom: "8px" }}>[ VALIDATION METHODOLOGY ]</div>
                <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-title)", marginBottom: "16px" }}>TRI-METRIC RESPONSE SCORING</h3>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", lineHeight: "1.6" }}>
                  Every verbal response is transcribed, parsed, and scored across three distinct vectors: Technical Competency (correctness), Communication Skills (clarity and structure), and Confidence & Presence (delivery speed and hesitation).
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE EXPERIENCE: SIMULATOR DEMO */}
        <section id="simulator" className={styles.gridSection} style={{ backgroundColor: "var(--bg-surface)" }}>
          <div className={`${styles.crosshair} ${styles.crosshairTL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairTR}`}>+</div>
          
          <div className={styles.swissContainer}>
            <div style={{ textAlign: "center", marginBottom: "48px" }}>
              <div className={styles.badge} style={{ backgroundColor: "var(--text-title)" }}>INTERFACE DEMO</div>
              <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", fontWeight: 900, color: "var(--text-title)", textTransform: "uppercase", letterSpacing: "-0.04em" }}>
                Experience the Oral Checkpoint
              </h2>
              <p style={{ color: "var(--text-muted)", maxWidth: "600px", margin: "12px auto 0 auto", fontSize: "15px" }}>
                Interactive simulation of the MLP voice examination interface. Click start to hear the AI evaluator's prompt.
              </p>
            </div>

            <div style={{ maxWidth: "800px", margin: "0 auto" }}>
              <div className={styles.simConsole}>
                {/* Console header */}
                <div className={styles.simHeader}>
                  <div className={styles.simTitle}>
                    <span className={styles.simDot} style={{ backgroundColor: simStep === "idle" ? "var(--text-muted)" : "#ff3e3e" }}></span>
                    MLP INTERVIEW AGENT // SESSION_009_SYS
                  </div>
                  <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "10px", color: "var(--text-muted)" }}>
                    Q: {currentQuestionIndex + 1}/{SIMULATOR_QUESTIONS.length}
                  </div>
                </div>

                {/* Console contents */}
                <div className={styles.simContent}>
                  {simStep === "idle" && (
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <p style={{ fontFamily: "JetBrains Mono, monospace", color: "var(--text-muted)", fontSize: "14px", marginBottom: "24px" }}>
                        SYSTEM STANDBY. READY TO COMMENCE AUDIO TEST.
                      </p>
                      <button className={styles.swissBtn} onClick={startSimulator}>
                        Initialize Voice Exam
                      </button>
                    </div>
                  )}

                  {simStep === "speaking" && (
                    <div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#ff3e3e", marginBottom: "16px" }}>
                        [ AGENT IS INQUIRING... ]
                      </div>
                      <div className={styles.simPrompt}>
                        "{currentQ.question}"
                      </div>
                      <div className={styles.waveformContainer}>
                        {waveformBars.map((h, i) => (
                          <div
                            key={i}
                            className={`${styles.waveBar} ${styles.waveBarActive}`}
                            style={{ height: `${h}px` }}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {simStep === "options" && (
                    <div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "var(--text-muted)", marginBottom: "16px" }}>
                        [ AGENT IS LISTENING. SELECT YOUR VERBAL RESPONSE ALTERNATIVE: ]
                      </div>
                      <div className={styles.simPrompt}>
                        "{currentQ.question}"
                      </div>
                      <div className={styles.simChoices}>
                        {currentQ.choices.map((c, i) => (
                          <button key={i} className={styles.choiceBtn} onClick={() => selectResponse(c)}>
                            "{c.text}"
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {simStep === "analyzing" && (
                    <div style={{ textAlign: "center", padding: "40px 0" }}>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "#ff3e3e", marginBottom: "16px" }}>
                        [ TRANSCRIBING AUDIO & COMPUTING SPEECH METRICS... ]
                      </div>
                      <div className={styles.waveformContainer}>
                        {waveformBars.map((h, i) => (
                          <div
                            key={i}
                            className={`${styles.waveBar} ${styles.waveBarActive}`}
                            style={{ height: `${h}px` }}
                          />
                        ))}
                      </div>
                      <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Analyzing pronunciation density, pauses, and syntax structure...</p>
                    </div>
                  )}

                  {simStep === "results" && selectedChoice && (
                    <div>
                      <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", color: "var(--color-success)", marginBottom: "16px", fontWeight: "bold" }}>
                        [ TRANSLATION COMPLETED. VERIFICATION LOG DETAILS: ]
                      </div>
                      <div style={{ fontSize: "14px", color: "var(--text-main)", borderLeft: "3px solid var(--border-subtle)", paddingLeft: "16px", marginBottom: "24px", fontStyle: "italic" }}>
                        "{selectedChoice.text}"
                      </div>
                      
                      <h4 style={{ fontSize: "13px", fontWeight: "700", textTransform: "uppercase", color: "var(--text-title)", marginBottom: "8px" }}>Evaluator Feedback:</h4>
                      <p style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "24px" }}>
                        {selectedChoice.feedback}
                      </p>

                      <div className={styles.metricRow}>
                        <div className={styles.metricBox}>
                          <div className={styles.metricLabel}>Technical Competency</div>
                          <div className={styles.metricValue} style={{ color: selectedChoice.technical >= 80 ? "var(--color-success)" : "var(--color-danger)" }}>
                            {selectedChoice.technical}%
                          </div>
                        </div>
                        <div className={styles.metricBox}>
                          <div className={styles.metricLabel}>Communication Skills</div>
                          <div className={styles.metricValue} style={{ color: selectedChoice.communication >= 80 ? "var(--color-success)" : "var(--color-danger)" }}>
                            {selectedChoice.communication}%
                          </div>
                        </div>
                        <div className={styles.metricBox}>
                          <div className={styles.metricLabel}>Confidence & Presence</div>
                          <div className={styles.metricValue} style={{ color: selectedChoice.confidence >= 80 ? "var(--color-success)" : "var(--color-danger)" }}>
                            {selectedChoice.confidence}%
                          </div>
                        </div>
                      </div>

                      <div style={{ display: "flex", gap: "16px", marginTop: "32px", justifyContent: "flex-end" }}>
                        <button className={styles.swissBtnSecondary} onClick={nextQuestion}>
                          Try Next Question
                        </button>
                        <Link href="/register" className={styles.swissBtn}>
                          Join MLP Platform
                        </Link>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* SWISS FEATURE GRID */}
        <section className={styles.gridSection}>
          <div className={styles.swissContainer}>
            <div style={{ marginBottom: "40px" }}>
              <div className={styles.badge}>KEY PLATFORM MECHANICS</div>
              <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", fontWeight: 900, color: "var(--text-title)", textTransform: "uppercase", letterSpacing: "-0.04em" }}>
                Built to enforce conceptual structure
              </h2>
            </div>
            
            <div className={styles.swissFeatures}>
              <div className={styles.featureCard}>
                <span className={styles.featureNum}>01 // SYSTEMATIC</span>
                <h3 className={styles.featureTitle}>Speech to Code</h3>
                <p className={styles.featureDesc}>
                  We analyze how you verbally construct algorithms, evaluate complexity trade-offs, and debug architectures before you build.
                </p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureNum}>02 // STRICT</span>
                <h3 className={styles.featureTitle}>Progression Gating</h3>
                <p className={styles.featureDesc}>
                  No guesses. The platform locks subsequent course modules until you pass the live voice-to-voice interview checkpoint.
                </p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureNum}>03 // DETAILED</span>
                <h3 className={styles.featureTitle}>Tri-Metric Grading</h3>
                <p className={styles.featureDesc}>
                  Instant feedback maps your specific gaps in technical competency, communication skills, and confidence & presence.
                </p>
              </div>
              <div className={styles.featureCard}>
                <span className={styles.featureNum}>04 // VERIFIABLE</span>
                <h3 className={styles.featureTitle}>Video & Transcript Archive</h3>
                <p className={styles.featureDesc}>
                  Every assessment is fully recorded. Access complete video replays and speech transcripts directly from your dashboard workspace.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* INTERACTIVE PROGRESSION ROADMAP */}
        <section className={styles.gridSection} style={{ backgroundColor: "var(--bg-surface)" }}>
          <div className={`${styles.crosshair} ${styles.crosshairBL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairBR}`}>+</div>
          
          <div className={styles.swissContainer}>
            <div style={{ textAlign: "center", marginBottom: "40px" }}>
              <div className={styles.badge} style={{ backgroundColor: "var(--text-title)" }}>LEARNER PATHWAY</div>
              <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", fontWeight: 900, color: "var(--text-title)", textTransform: "uppercase", letterSpacing: "-0.04em" }}>
                The Gated Journey to Completion
              </h2>
              <p style={{ color: "var(--text-muted)", maxWidth: "600px", margin: "12px auto 0 auto", fontSize: "15px" }}>
                Select nodes to inspect how MLP structures the learning curve and enforces comprehension.
              </p>
            </div>

            <div className={styles.roadmapGrid}>
              {ROADMAP_STEPS.map((step, idx) => (
                <React.Fragment key={step.id}>
                  <div
                    onClick={() => setActiveStep(idx)}
                    className={`${styles.roadmapNode} ${activeStep === idx ? styles.roadmapNodeActive : ""} ${step.status === "locked" ? styles.roadmapNodeLocked : ""}`}
                    style={{ cursor: "pointer" }}
                  >
                    <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "11px", fontWeight: "bold", color: activeStep === idx ? "var(--brand)" : "var(--text-muted)", display: "block", marginBottom: "8px" }}>
                      PHASE {step.id}
                    </span>
                    <h3 style={{ fontSize: "15px", fontWeight: "800", color: "var(--text-title)" }}>
                      {step.name}
                    </h3>
                  </div>
                  {idx < ROADMAP_STEPS.length - 1 && (
                    <div className={styles.roadmapArrow}>→</div>
                  )}
                </React.Fragment>
              ))}
            </div>

            {/* Dynamic Step Detail Container */}
            <div style={{ border: "2px solid var(--text-title)", padding: "32px", background: "var(--bg-canvas)", marginTop: "24px" }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid var(--border-muted)", paddingBottom: "12px", marginBottom: "16px" }}>
                <span style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", fontWeight: "bold", color: "var(--brand)" }}>
                  // LOGGING DETAIL_PHASE_0{activeStep + 1}
                </span>
                <span style={{
                  fontSize: "11px",
                  fontWeight: "bold",
                  textTransform: "uppercase",
                  padding: "4px 8px",
                  backgroundColor: ROADMAP_STEPS[activeStep].status === "completed" ? "var(--bg-success)" : ROADMAP_STEPS[activeStep].status === "active" ? "var(--brand-muted)" : "var(--bg-element)",
                  color: ROADMAP_STEPS[activeStep].status === "completed" ? "var(--color-success)" : ROADMAP_STEPS[activeStep].status === "active" ? "var(--brand)" : "var(--text-muted)"
                }}>
                  {ROADMAP_STEPS[activeStep].status}
                </span>
              </div>
              <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-title)", marginBottom: "8px" }}>
                {ROADMAP_STEPS[activeStep].name}
              </h3>
              <p style={{ color: "var(--text-main)", fontSize: "15px", lineHeight: "1.6" }}>
                {ROADMAP_STEPS[activeStep].desc}
              </p>
            </div>
          </div>
        </section>

        {/* FEATURED COURSES CATALOG SECTION */}
        <section className={styles.gridSection}>
          <div className={styles.swissContainer}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-end", flexWrap: "wrap", marginBottom: "40px", gap: "16px" }}>
              <div>
                <div className={styles.badge}>MLP ACTIVE TRACKS</div>
                <h2 style={{ fontSize: "clamp(1.8rem, 4vw, 3rem)", fontWeight: 900, color: "var(--text-title)", textTransform: "uppercase", letterSpacing: "-0.04em" }}>
                  Active Learning Curriculums
                </h2>
              </div>
              <Link href="/courses" className={styles.swissBtnSecondary}>
                View All Courses
              </Link>
            </div>

            <FeaturedCourses />
          </div>
        </section>

        {/* SWISS PLATFORM METRICS */}
        <section className={styles.gridSection} style={{ backgroundColor: "var(--bg-surface)" }}>
          <div className={styles.swissContainer}>
            <div className={styles.swissGrid2}>
              <div className={styles.gridCol} style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span className={styles.statBigNum}>94.2%</span>
                <span className={styles.statLabel}>GRADING METRIC ALIGNMENT</span>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "12px", lineHeight: "1.6" }}>
                  Our voice scoring models match senior software engineering reviewers with high consistency, checking logic structure and verbal clarity dynamically.
                </p>
              </div>
              <div className={styles.gridCol} style={{ display: "flex", flexDirection: "column", justifyContent: "center" }}>
                <span className={styles.statBigNum}>0.8s</span>
                <span className={styles.statLabel}>REAL-TIME VOICE LATENCY</span>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", marginTop: "12px", lineHeight: "1.6" }}>
                  Experience smooth conversational flow. Our optimized TTS/STT pipelines process user replies and generate natural responses in sub-second times.
                </p>
              </div>
            </div>
            
            <div className={styles.quoteBlock}>
              "MLP bridges the gap between coding in a vacuum and discussing code in professional environments. It is the closest simulation to a real technical interview available today."
            </div>
          </div>
        </section>

        {/* FINAL CALL TO ACTION */}
        <section className={styles.gridSection} style={{ borderBottom: "none" }}>
          <div className={`${styles.crosshair} ${styles.crosshairTL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairTR}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairBL}`}>+</div>
          <div className={`${styles.crosshair} ${styles.crosshairBR}`}>+</div>
          
          <div className={styles.swissContainer} style={{ textAlign: "center", padding: "60px 0" }}>
            <div className={styles.badge} style={{ backgroundColor: "var(--brand)" }}>REGISTRATION GATE</div>
            <h2 className={styles.swissTitle}>
              Evolve Your <br /><span className={styles.accentText}>Learning.</span>
            </h2>
            <p className={styles.swissSubtitle} style={{ margin: "0 auto 40px auto" }}>
              Join Mavericks Learning Platform today. Build clean code, challenge the AI interviewer, and unlock verified certification credentials.
            </p>
            <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
              <Link href="/register" className={styles.swissBtn}>
                Register Account
              </Link>
              <Link href="/login" className={styles.swissBtnSecondary}>
                Sign In
              </Link>
            </div>
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ borderTop: "2px solid var(--border-muted)", padding: "40px 0", backgroundColor: "var(--bg-surface)" }}>
          <div className={styles.swissContainer}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "24px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                <span style={{ fontWeight: "900", letterSpacing: "-0.04em", color: "var(--text-title)" }}>MAVERICKS LEARNING PLATFORM</span>
                <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>© 2026 MLP Learning Systems. Built on Swiss Modernist Principles.</span>
              </div>
              <div style={{ display: "flex", gap: "24px" }}>
                <Link href="/courses" style={{ color: "var(--text-title)", fontSize: "13px", fontWeight: "700", textDecoration: "none", textTransform: "uppercase" }}>Catalog</Link>
                <Link href="/login" style={{ color: "var(--text-title)", fontSize: "13px", fontWeight: "700", textDecoration: "none", textTransform: "uppercase" }}>Console</Link>
              </div>
            </div>
          </div>
        </footer>

      </div>
    </>
  );
}
