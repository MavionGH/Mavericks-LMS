"use client";
import Navbar from "@/components/Navbar";
import Skeleton, { SkeletonCardGrid, SkeletonMetrics } from "@/components/Skeleton";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useEffect, useState, useRef } from "react";

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
      style={{ width: "100%", borderRadius: "var(--radius-sm)", backgroundColor: "#000", maxHeight: 200, marginTop: "12px" }}
    />
  );
}

function StudentDashboard() {
  const { user, authFetch } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  // Oral Assessments states
  const [showOralModal, setShowOralModal] = useState(false);
  const [evaluations, setEvaluations] = useState([]);
  const [evalsLoading, setEvalsLoading] = useState(false);
  const [courseFilter, setCourseFilter] = useState("");
  const [selectedEvaluation, setSelectedEvaluation] = useState(null);

  useEffect(() => {
    async function loadStats() {
      try {
        const res = await authFetch("/api/student/dashboard");
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch (err) {
        console.error("Failed to load dashboard stats", err);
      } finally {
        setLoading(false);
      }
    }
    loadStats();
  }, [authFetch]);

  const openOralModal = () => {
    setShowOralModal(true);
    setEvalsLoading(true);
    authFetch("/api/student/evaluations")
      .then((res) => (res.ok ? res.json() : []))
      .then((data) => {
        setEvaluations(data);
      })
      .catch((err) => console.error("Error loading evaluations", err))
      .finally(() => setEvalsLoading(false));
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ paddingTop: "40px", paddingBottom: "40px" }}>
            <div style={{ marginBottom: "28px" }}>
              <Skeleton variant="text" width="240px" height={28} />
              <Skeleton variant="text" width="340px" height={16} style={{ marginTop: "8px" }} />
            </div>
            <SkeletonMetrics count={4} />
            <div style={{ marginBottom: "20px", marginTop: "12px" }}>
              <Skeleton variant="text" width="180px" height={20} />
            </div>
            <SkeletonCardGrid count={3} />
          </div>
        </div>
      </>
    );
  }

  const MY_COURSES = stats?.enrolled_courses || [];

  const modalOverlayStyle = {
    position: "fixed",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    backdropFilter: "blur(4px)",
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1000,
    padding: "20px",
  };

  const modalContentStyle = {
    backgroundColor: "var(--bg-surface)",
    borderRadius: "16px",
    border: "1px solid var(--border-muted)",
    width: "100%",
    maxWidth: "600px",
    maxHeight: "85vh",
    overflowY: "auto",
    padding: "32px",
    boxShadow: "var(--shadow-lg)",
    position: "relative",
  };

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em" }}>
                Learner Workspace
              </h1>
              <span style={{
                fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                borderRadius: "4px", background: "var(--brand-muted)", color: "var(--brand)",
                border: "1px solid var(--brand-border)", fontFamily: "JetBrains Mono",
              }}>
                STUDENT
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Welcome back, <strong style={{ color: "var(--text-title)" }}>{user?.name}</strong>. Track your progress, certificates, and evaluation metrics.
            </p>
          </div>

          {/* Metrics */}
          <div className="grid-4" style={{ marginBottom: "32px" }}>
            {[
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }}>
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                ),
                value: stats?.active_tracks ?? 0,
                label: "Active Tracks",
                link: "/courses"
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-success)' }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                ),
                value: stats?.modules_completed ?? 0,
                label: "Modules Completed",
                link: "/courses"
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                ),
                value: stats?.oral_assessments ?? 0,
                label: "Oral Assessments",
                action: openOralModal
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)' }}>
                    <path d="M6 9H4.5a2.5 2.5 0 0 1 0-5H6" />
                    <path d="M18 9h1.5a2.5 2.5 0 0 0 0-5H18" />
                    <path d="M4 22h16" />
                    <path d="M10 14.66V17c0 .55-.45 1-1 1H4v2h16v-2h-5c-.55 0-1-.45-1-1v-2.34" />
                    <path d="M12 2a6 6 0 0 0-6 6v5a6 6 0 0 0 12 0V8a6 6 0 0 0-6-6z" />
                  </svg>
                ),
                value: stats?.earned_credentials ?? 0,
                label: "Earned Credentials",
                link: "/certificates"
              },
            ].map((s, i) => {
              const cardContent = (
                <div 
                  className="card stat-card" 
                  style={{ 
                    cursor: s.link || s.action ? "pointer" : "default"
                  }}
                  onClick={s.action}
                >
                  <div className="stat-icon" style={{ display: 'flex', alignItems: 'center' }}>{s.icon}</div>
                  <div>
                    <div className="stat-value">{s.value}</div>
                    <div className="stat-label">{s.label}</div>
                  </div>
                </div>
              );

              if (s.link) {
                return (
                  <Link href={s.link} key={i} style={{ textDecoration: "none", color: "inherit" }}>
                    {cardContent}
                  </Link>
                );
              }

              return <div key={i}>{cardContent}</div>;
            })}
          </div>

          {/* Enrolled Courses */}
          <h2 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
            Enrolled Tracks
          </h2>
          {MY_COURSES.length === 0 ? (
            <div className="empty-state" style={{ padding: "40px", textAlign: "center", backgroundColor: "var(--bg-card)", border: "1px dashed var(--border-muted)", borderRadius: "8px", marginBottom: "40px" }}>
              <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>You are not enrolled in any tracks yet.</p>
              <Link href="/courses" className="btn btn-primary" style={{ marginTop: "16px", display: "inline-block" }}>Browse Catalog</Link>
            </div>
          ) : (
            <div className="grid-2" style={{ marginBottom: "40px" }}>
              {MY_COURSES.map((c) => (
                <div className="card" key={c.id} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", backgroundColor: "var(--bg-surface)" }}>
                  <div>
                    <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
                      <div className="mono" style={{ fontSize: "14px", fontWeight: "700", width: "36px", height: "36px", border: "1px solid var(--border-muted)", backgroundColor: "var(--bg-canvas)", display: "grid", placeItems: "center", color: "var(--brand)", borderRadius: "var(--radius-sm)" }}>
                        {c.icon}
                      </div>
                      <div>
                        <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)" }}>{c.title}</h3>
                        <span className="badge badge-accent" style={{ fontSize: "9px", padding: "1px 6px", marginTop: "2px" }}>{c.status}</span>
                      </div>
                    </div>
                    <p style={{ fontSize: "13.5px", color: "var(--text-muted)", marginBottom: "20px" }}>Current: {c.currentChapter}</p>
                  </div>
                  <div>
                    <div className="progress-bar-container" style={{ marginBottom: "8px", height: 6 }}>
                      <div className="progress-bar-fill" style={{ width: `${c.progress}%` }} />
                    </div>
                    <div className="flex-between">
                      <span style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", fontWeight: "600" }}>{c.progress}% COMPLETED</span>
                      <Link href={`/learn/${c.id}/ch1`} className="btn btn-secondary btn-sm">Enter workspace</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Oral Assessments History Modal */}
      {showOralModal && (
        <div style={modalOverlayStyle} onClick={() => setShowOralModal(false)}>
          <div style={modalContentStyle} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h2 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                Oral Assessment History
              </h2>
              <button 
                onClick={() => setShowOralModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "24px", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            {/* Filter input */}
            <div style={{ marginBottom: "20px" }}>
              <input 
                type="text" 
                placeholder="Filter by course name..."
                value={courseFilter}
                onChange={(e) => setCourseFilter(e.target.value)}
                style={{
                  width: "100%",
                  padding: "10px 14px",
                  borderRadius: "8px",
                  border: "1px solid var(--border-subtle)",
                  backgroundColor: "var(--bg-canvas)",
                  color: "var(--text-main)",
                  fontSize: "14px",
                  outline: "none"
                }}
              />
            </div>

            {evalsLoading ? (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} style={{ padding: "16px", backgroundColor: "var(--bg-canvas)", border: "1px solid var(--border-muted)", borderRadius: "8px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <div style={{ flex: 1, display: "flex", flexDirection: "column", gap: "6px" }}>
                      <Skeleton variant="text" width="60%" height={14} />
                      <Skeleton variant="text" width="40%" height={10} />
                    </div>
                    <Skeleton variant="rectangular" width="60px" height={24} borderRadius="12px" />
                  </div>
                ))}
              </div>
            ) : evaluations.length === 0 ? (
              <div style={{ padding: "40px", textAlign: "center", color: "var(--text-muted)" }}>
                No oral assessments taken yet.
              </div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", maxHeight: "50vh", overflowY: "auto" }}>
                {evaluations
                  .filter(ev => ev.course.toLowerCase().includes(courseFilter.toLowerCase()))
                  .map((ev, idx) => (
                    <div 
                      key={idx}
                      style={{
                        padding: "16px",
                        backgroundColor: "var(--bg-canvas)",
                        border: "1px solid var(--border-muted)",
                        borderRadius: "8px",
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center"
                      }}
                    >
                      <div style={{ textAlign: "left" }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", margin: "0 0 4px 0" }}>
                          {ev.course}
                        </h4>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                          {ev.chapter} · {ev.date}
                        </span>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                        <div style={{ textAlign: "right" }}>
                          <span style={{ fontSize: "16px", fontWeight: "800", color: ev.passed ? "var(--color-success)" : "var(--color-danger)" }}>
                            {ev.score}%
                          </span>
                          <div style={{ fontSize: "10px", fontWeight: "600", textTransform: "uppercase", color: ev.passed ? "var(--color-success)" : "var(--color-danger)" }}>
                            {ev.passed ? "Passed" : "Failed"}
                          </div>
                        </div>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => setSelectedEvaluation(ev)}
                        >
                          Details
                        </button>
                      </div>
                    </div>
                  ))
                }
              </div>
            )}
          </div>
        </div>
      )}

      {/* Detailed Evaluation Result Popup Modal */}
      {selectedEvaluation && (
        <div style={{ ...modalOverlayStyle, zIndex: 1100 }} onClick={() => setSelectedEvaluation(null)}>
          <div style={{ ...modalContentStyle, maxWidth: "450px" }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                Assessment Result
              </h3>
              <button 
                onClick={() => setSelectedEvaluation(null)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "24px", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            <div style={{ textAlign: "center", marginBottom: "24px" }}>
              <span className="badge badge-accent" style={{ marginBottom: "8px" }}>
                {selectedEvaluation.chapter.toUpperCase()}
              </span>
              <h4 style={{ fontSize: "18px", fontWeight: "800", color: "var(--text-title)", marginBottom: "4px" }}>
                {selectedEvaluation.course}
              </h4>
              <p style={{ color: "var(--text-muted)", fontSize: "12px", margin: 0 }}>
                Taken on {selectedEvaluation.date}
              </p>
            </div>

            <div style={{ 
              padding: "24px", 
              backgroundColor: "var(--bg-canvas)", 
              border: "1px solid var(--border-muted)", 
              borderRadius: "12px", 
              textAlign: "center",
              marginBottom: "24px" 
            }}>
              <div style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "4px" }}>
                Overall Score
              </div>
              <div style={{ fontSize: "40px", fontWeight: "800", color: selectedEvaluation.passed ? "var(--color-success)" : "var(--color-danger)", lineHeight: 1 }}>
                {selectedEvaluation.score}%
              </div>
              <div style={{ 
                fontSize: "12px", 
                fontWeight: "700", 
                color: selectedEvaluation.passed ? "var(--color-success)" : "var(--color-danger)", 
                textTransform: "uppercase", 
                marginTop: "8px" 
              }}>
                {selectedEvaluation.passed ? "✓ Passed Requirements" : "✗ Needs Improvement"}
              </div>
            </div>

            {/* Metrics Breakdown */}
            <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginBottom: "24px" }}>
              {[
                { label: "Technical Competency", val: selectedEvaluation.technical },
                { label: "Communication Skills", val: selectedEvaluation.communication },
                { label: "Confidence & Presence", val: selectedEvaluation.confidence }
              ].map((m, i) => (
                <div key={i}>
                  <div className="flex-between" style={{ marginBottom: "6px", fontSize: "12px", fontWeight: "600", color: "var(--text-muted)" }}>
                    <span>{m.label}</span>
                    <span style={{ color: "var(--text-title)" }}>{m.val} / 100</span>
                  </div>
                  <div className="progress-bar-container" style={{ height: 6 }}>
                    <div 
                      className="progress-bar-fill" 
                      style={{ 
                        width: `${m.val}%`,
                        backgroundColor: m.val >= 70 ? "var(--color-success)" : m.val >= 50 ? "var(--color-warning)" : "var(--color-danger)"
                      }} 
                    />
                  </div>
                </div>
              ))}
            </div>

            {/* Recording Player Option */}
            {selectedEvaluation.recording_url ? (
              <div style={{ marginBottom: "24px", textAlign: "left" }}>
                <div style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                  Interview Video Recording
                </div>
                <RecordingPlayer src={selectedEvaluation.recording_url} />
                <div style={{ textAlign: "right", marginTop: "6px" }}>
                  <a 
                    href={selectedEvaluation.recording_url} 
                    target="_blank" 
                    rel="noreferrer"
                    style={{ fontSize: "11px", color: "var(--brand)", textDecoration: "none", fontWeight: "600" }}
                  >
                    Open recording in new tab ↗
                  </a>
                </div>
              </div>
            ) : (
              <div style={{ marginBottom: "24px", textAlign: "center", padding: "12px", border: "1px dashed var(--border-muted)", borderRadius: "8px" }}>
                <p style={{ color: "var(--text-muted)", fontSize: "12.5px", margin: 0 }}>
                  No video recording available for this session.
                </p>
              </div>
            )}

            <button 
              className="btn btn-primary" 
              onClick={() => setSelectedEvaluation(null)}
              style={{ width: "100%" }}
            >
              Close
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default withAuth(StudentDashboard, ["student"]);
