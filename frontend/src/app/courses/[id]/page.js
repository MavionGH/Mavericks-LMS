"use client";
import Navbar from "@/components/Navbar";
import Skeleton from "@/components/Skeleton";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { useAuth } from "@/context/AuthContext";

// Player for interview recordings.
function RecordingPlayer({ src }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);

  const handleLoadedMetadata = () => {
    const v = ref.current;
    if (!v || fixedRef.current) return;
    if (v.duration === Infinity || Number.isNaN(v.duration)) {
      fixedRef.current = true;
      const onUpdate = () => {
        v.removeEventListener("timeupdate", onUpdate);
        v.currentTime = 0; // snap back to the start now that duration is known
      };
      v.addEventListener("timeupdate", onUpdate);
      v.currentTime = 1e101; // jump past the end → browser resolves the duration
    }
  };

  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      style={{ width: "100%", borderRadius: "var(--radius-sm)", backgroundColor: "#000", maxHeight: 240, marginTop: "8px" }}
    />
  );
}


export default function CourseDetailPage() {
  const params = useParams();
  const { user, authFetch } = useAuth();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);

  // ── Enrollment state ──
  const [enrollment, setEnrollment] = useState(null);
  const [enrollLoading, setEnrollLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState("");
  const [evaluations, setEvaluations] = useState([]);
  const [activeTab, setActiveTab] = useState("modules");

  // ── Load evaluations to check if final interview is passed ──
  useEffect(() => {
    if (!user) return;
    authFetch(`/api/student/courses/${params.id}/evaluations`)
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => setEvaluations(data))
      .catch(() => setEvaluations([]));
  }, [params.id, user, authFetch]);

  // ── Load course (public, no auth required) ──
  useEffect(() => {
    fetch(`http://localhost:8000/api/courses/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCourse)
      .finally(() => setLoading(false));
  }, [params.id]);

  // ── Check whether the signed-in student is already enrolled ──
  useEffect(() => {
    let active = true;
    async function checkEnrollment() {
      if (!user) {
        setEnrollLoading(false);
        return;
      }
      setEnrollLoading(true);
      try {
        const res = await authFetch(`/api/enrollment/course/${params.id}`);
        if (active && res.ok) setEnrollment(await res.json());
      } catch {
        /* not enrolled / network issue — treated as not enrolled */
      } finally {
        if (active) setEnrollLoading(false);
      }
    }
    checkEnrollment();
    return () => {
      active = false;
    };
  }, [params.id, user, authFetch]);

  const handleEnroll = async () => {
    if (!user) return;
    setEnrolling(true);
    setEnrollError("");
    try {
      const res = await authFetch("/api/enrollment/enroll", {
        method: "POST",
        body: JSON.stringify({ course_id: params.id }),
      });
      if (!res.ok) {
        const detail = await res
          .json()
          .then((d) => d?.detail)
          .catch(() => null);
        throw new Error(detail || "Could not enroll in this course");
      }
      setEnrollment(await res.json());
    } catch (err) {
      setEnrollError(err.message);
    } finally {
      setEnrolling(false);
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ paddingTop: "40px", paddingBottom: "40px" }}>
            {/* Hero area */}
            <div className="card" style={{ padding: "32px", display: "flex", gap: "32px" }}>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", flex: 1 }}>
                <Skeleton variant="text" width="30%" height={12} />
                <Skeleton variant="text" width="65%" height={28} />
                <Skeleton variant="text" width="85%" height={14} />
                <Skeleton variant="text" width="75%" height={14} />
                <div style={{ display: "flex", gap: "12px", marginTop: "16px" }}>
                  <Skeleton variant="rectangular" width="130px" height={40} borderRadius="4px" />
                  <Skeleton variant="rectangular" width="100px" height={40} borderRadius="4px" />
                </div>
              </div>
              <Skeleton variant="rectangular" width={240} height={160} borderRadius="8px" style={{ flexShrink: 0 }} />
            </div>
            {/* Modules list */}
            <div className="card" style={{ padding: "24px" }}>
              <Skeleton variant="text" width="200px" height={18} style={{ marginBottom: "20px" }} />
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: "12px", padding: "14px 0", borderBottom: "1px solid var(--border-muted)" }}>
                  <Skeleton variant="circular" width={28} height={28} />
                  <Skeleton variant="text" width="60%" height={14} />
                  <Skeleton variant="rectangular" width="70px" height={24} borderRadius="10px" style={{ marginLeft: "auto" }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      </>
    );
  }

  if (!course) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)" }}>Course not found</p>
          <Link href="/courses" className="btn btn-primary" style={{ marginTop: "16px" }}>Back to catalog</Link>
        </div>
      </>
    );
  }

  const chapters = [...(course.chapters || [])].sort((a, b) => a.order_index - b.order_index);
  const isEnrolled = !!enrollment;
  const currentIndex = enrollment?.current_chapter_index ?? 0;
  const passedFinalInterview = evaluations.some(
    (ev) => ev.chapter === "Course Capstone" && ev.passed
  );

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          <div className="card" style={{ padding: "40px", marginBottom: "32px", display: "flex", gap: "32px", backgroundColor: "var(--bg-surface)" }}>
            <div className="mono" style={{ fontSize: "28px", fontWeight: "700", width: "80px", height: "80px", borderRadius: "var(--radius-md)", backgroundColor: "var(--brand-muted)", display: "grid", placeItems: "center", color: "var(--brand)", overflow: "hidden", flexShrink: 0 }}>
              {course.thumbnail ? (
                <img
                  src={course.thumbnail}
                  alt={course.title}
                  style={{ width: "100%", height: "100%", objectFit: "cover" }}
                />
              ) : (
                course.title?.slice(0, 2).toUpperCase()
              )}
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: "32px", fontWeight: "700", marginBottom: "12px" }}>{course.title}</h1>
              <p style={{ color: "var(--text-main)", marginBottom: "24px", lineHeight: "1.6" }}>{course.description}</p>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                {chapters.length} Modules · {course.quiz_threshold || 70}% quiz passing threshold · {course.pass_threshold || 70}% interview passing threshold
              </div>
              <div style={{ marginTop: "28px" }}>
                {!user ? (
                  <Link href="/login" className="btn btn-primary">Sign in to enroll</Link>
                ) : chapters.length === 0 ? (
                  <span className="badge badge-warning">No modules added yet</span>
                ) : enrollLoading ? (
                  <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Checking enrollment…</span>
                ) : isEnrolled ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                    <span className="badge badge-success">✓ You are enrolled</span>
                    <Link href={`/learn/${params.id}`} className="btn btn-primary">Continue learning</Link>
                  </div>
                ) : (
                  <div>
                    <button className="btn btn-primary" onClick={handleEnroll} disabled={enrolling}>
                      {enrolling ? "Enrolling…" : "Enroll in this course"}
                    </button>
                    {enrollError && (
                      <p style={{ color: "var(--color-danger)", fontSize: "13px", marginTop: "8px" }}>{enrollError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Tabs header */}
          {isEnrolled && (
            <div style={{ display: "flex", gap: "24px", borderBottom: "1px solid var(--border-muted)", marginBottom: "32px" }}>
              <button
                type="button"
                onClick={() => setActiveTab("modules")}
                style={{
                  padding: "12px 4px",
                  fontSize: "14px",
                  fontWeight: "700",
                  color: activeTab === "modules" ? "var(--brand)" : "var(--text-muted)",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "modules" ? "2px solid var(--brand)" : "2px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontFamily: "JetBrains Mono",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em"
                }}
              >
                Modules
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("interview")}
                style={{
                  padding: "12px 4px",
                  fontSize: "14px",
                  fontWeight: "700",
                  color: activeTab === "interview" ? "var(--brand)" : "var(--text-muted)",
                  background: "none",
                  border: "none",
                  borderBottom: activeTab === "interview" ? "2px solid var(--brand)" : "2px solid transparent",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontFamily: "JetBrains Mono",
                  textTransform: "uppercase",
                  letterSpacing: "0.03em"
                }}
              >
                Final Interview
              </button>
            </div>
          )}

          {/* Tab Content: Modules */}
          {(!isEnrolled || activeTab === "modules") && (
            <>
              <h2 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono" }}>Syllabus Structure</h2>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {chapters.map((ch, i) => {
                  const unlocked = isEnrolled && i <= currentIndex;
                  const isPassed = isEnrolled && (enrollment.status === "completed" || enrollment.status === "capstone_ready" || i < currentIndex);
                  return (
                    <div className="card" key={ch.id} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "24px", backgroundColor: "var(--bg-surface)" }}>
                      <div className="mono" style={{ width: "36px", height: "36px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-muted)", display: "grid", placeItems: "center", fontSize: "12px" }}>
                        {String(i + 1).padStart(2, "0")}
                      </div>
                      <div style={{ flex: 1 }}>
                        <span style={{ fontWeight: "700", fontSize: "15px" }}>{ch.title}</span>
                        {ch.youtube_url && user && (
                          <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Includes video lecture</p>
                        )}
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                        {!user ? null : unlocked ? (
                          <>
                            {isPassed && (
                              <span style={{
                                fontSize: "9px", fontWeight: "700", padding: "2px 6px",
                                borderRadius: "4px", backgroundColor: "var(--bg-success)", color: "var(--color-success)",
                                textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", flexShrink: 0
                              }}>Passed</span>
                            )}
                            <Link href={`/learn/${params.id}/${ch.id}`} className="btn btn-secondary btn-sm">Enter Module</Link>
                          </>
                        ) : !isEnrolled ? (
                          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>🔒 Enroll to unlock</span>
                        ) : (
                          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>🔒 Locked</span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {chapters.length === 0 && (
                  <p style={{ color: "var(--text-muted)" }}>Teacher has not added modules yet.</p>
                )}
              </div>
            </>
          )}

          {/* Tab Content: Interview */}
          {isEnrolled && activeTab === "interview" && (
            <div style={{ display: "flex", flexDirection: "column", gap: "32px" }}>
              {/* Capstone Interview Action Card */}
              {chapters.length > 0 && (
                <div className="card" style={{ padding: "28px", display: "flex", flexWrap: "wrap", alignItems: "center", gap: "24px", backgroundColor: "var(--bg-surface)", border: "1px dashed var(--brand)", borderRadius: "var(--radius-lg)" }}>
                  <div className="mono" style={{ width: "48px", height: "48px", borderRadius: "50%", border: "1px solid var(--brand)", display: "grid", placeItems: "center", fontSize: "20px", color: "var(--brand)", backgroundColor: "var(--brand-muted)" }}>
                    🎙
                  </div>
                  <div style={{ flex: 1, minWidth: "240px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", flexWrap: "wrap" }}>
                      <h3 style={{ fontWeight: "800", fontSize: "18px", margin: 0, color: "var(--text-title)" }}>Final Capstone AI Interview</h3>
                      {passedFinalInterview && (
                        <span style={{
                          fontSize: "9px", fontWeight: "700", padding: "3px 8px",
                          borderRadius: "4px", backgroundColor: "var(--bg-success)", color: "var(--color-success)",
                          textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono"
                        }}>Passed</span>
                      )}
                    </div>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", marginTop: "6px", lineHeight: "1.5" }}>
                      Mav will ask you comprehensive questions spanning all modules in this course to test your overall competency.
                    </p>
                  </div>
                  <div>
                    <Link href={`/interview/${params.id}`} className="btn btn-primary" style={{ padding: "12px 24px" }}>
                      {evaluations.length > 0 ? "Retake Interview" : "Start Interview"}
                    </Link>
                  </div>
                </div>
              )}

              {/* Evaluation History Section */}
              <div>
                <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono", color: "var(--text-title)" }}>
                  Interview History & Recordings
                </h3>
                
                {evaluations.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "48px 32px", border: "1px dashed var(--border-muted)", borderRadius: "var(--radius-lg)", backgroundColor: "var(--bg-surface)" }}>
                    <div style={{ fontSize: "36px", marginBottom: "16px" }}>🎙</div>
                    <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>No interviews taken yet</h3>
                    <p style={{ fontSize: "13px", color: "var(--text-muted)", maxWidth: "400px", margin: "0 auto", lineHeight: "1.6" }}>
                      Once you complete your modules, you can start the final AI interview. Your recording, scores, and evaluation feedback will appear here.
                    </p>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    {evaluations.map((ev, idx) => (
                      <div key={idx} className="card" style={{ padding: "24px", backgroundColor: "var(--bg-surface)", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-lg)" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "16px", marginBottom: "20px" }}>
                          <div>
                            <span style={{
                              fontSize: "10px", fontWeight: "700", padding: "2px 6px",
                              borderRadius: "4px", backgroundColor: "var(--bg-canvas)", color: "var(--text-muted)",
                              textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono"
                            }}>{ev.chapter}</span>
                            <h4 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", margin: "8px 0 2px 0" }}>{course.title}</h4>
                            <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Taken on {ev.date}</span>
                          </div>
                          <div style={{ textAlign: "right" }}>
                            <div style={{ fontSize: "24px", fontWeight: "800", color: ev.passed ? "var(--color-success)" : "var(--color-danger)", lineHeight: 1 }}>
                              {ev.score}%
                            </div>
                            <span style={{
                              fontSize: "9px", fontWeight: "700", padding: "2px 6px",
                              borderRadius: "4px", backgroundColor: ev.passed ? "var(--bg-success)" : "var(--bg-danger)", color: ev.passed ? "var(--color-success)" : "var(--color-danger)",
                              textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", display: "inline-block", marginTop: "6px"
                            }}>{ev.passed ? "Passed" : "Failed"}</span>
                          </div>
                        </div>

                        {/* Grid for Score Breakdown & Video */}
                        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "24px" }}>
                          
                          {/* Metrics Breakdown */}
                          <div style={{ display: "flex", flexDirection: "column", gap: "16px", padding: "20px", backgroundColor: "var(--bg-canvas)", borderRadius: "var(--radius-md)", border: "1px solid var(--border-muted)" }}>
                            <h5 style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 4px 0" }}>Competency Metrics</h5>
                            {[
                              { label: "Technical Competency", val: ev.technical },
                              { label: "Communication Skills", val: ev.communication },
                              { label: "Confidence & Presence", val: ev.confidence }
                            ].map((m, i) => (
                              <div key={i}>
                                <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px", fontSize: "12px", fontWeight: "600", color: "var(--text-main)" }}>
                                  <span>{m.label}</span>
                                  <span style={{ fontWeight: "700" }}>{m.val} / 100</span>
                                </div>
                                <div style={{ width: "100%", height: "6px", backgroundColor: "var(--border-muted)", borderRadius: "3px", overflow: "hidden" }}>
                                  <div 
                                    style={{ 
                                      height: "100%", 
                                      width: `${m.val}%`, 
                                      backgroundColor: m.val >= 70 ? "var(--color-success)" : m.val >= 50 ? "var(--color-warning)" : "var(--color-danger)",
                                      borderRadius: "3px"
                                    }} 
                                  />
                                </div>
                              </div>
                            ))}
                          </div>

                          {/* Recording Player option */}
                          {ev.recording_url && (
                            <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between" }}>
                              <div>
                                <h5 style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", margin: "0 0 10px 0" }}>Interview Video Recording</h5>
                                <RecordingPlayer src={ev.recording_url} />
                              </div>
                              <div style={{ textAlign: "right", marginTop: "12px" }}>
                                <a 
                                  href={ev.recording_url} 
                                  target="_blank" 
                                  rel="noreferrer"
                                  style={{ fontSize: "12px", color: "var(--brand)", textDecoration: "none", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "4px" }}
                                >
                                  Open recording in new tab
                                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/></svg>
                                </a>
                              </div>
                            </div>
                          )}

                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
