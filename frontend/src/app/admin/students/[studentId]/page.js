"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useParams, useRouter } from "next/navigation";

// Player for interview recordings.
// MediaRecorder (WebM) files lack a duration header, so the browser reports
// duration = Infinity (or a bogus small value) and the seek bar is non-functional.
// Fix: on metadata load, if duration is missing/broken, seek to a huge timestamp so
// the browser scans to the end and learns the real duration, then seek back to 0.
// We use the `seeked` event (fires once when the seek actually lands) NOT `timeupdate`
// (which fires continuously during normal playback and would snap the bar back on
// every tick). A guard ref prevents re-running once already fixed.
function RecordingPlayer({ src }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);

  const handleLoadedMetadata = () => {
    const v = ref.current;
    if (!v || fixedRef.current) return;
    // Infinity = no duration header; NaN = file unreadable.
    const dur = v.duration;
    if (dur === Infinity || Number.isNaN(dur)) {
      fixedRef.current = true;

      // `seeked` fires exactly once when the browser finishes the seek operation,
      // meaning the full file has been parsed and the real duration is now known.
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        v.currentTime = 0; // snap back to the start
      };
      v.addEventListener("seeked", onSeeked);
      // Seeking past the end forces the browser to read the entire file.
      v.currentTime = 1e101;
    }
  };

  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      style={{ width: "100%", borderRadius: "var(--radius-sm)", backgroundColor: "#000", maxHeight: 240 }}
    />
  );
}

function StudentProfilePage() {
  const { authFetch } = useAuth();
  const { studentId } = useParams();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const [activeTab, setActiveTab] = useState("profile"); // "profile" | "interviews"
  const [interviews, setInterviews] = useState([]);
  const [loadingInterviews, setLoadingInterviews] = useState(false);
  const [selectedCourseId, setSelectedCourseId] = useState("");

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    authFetch(`/api/admin/students/${studentId}`)
      .then((r) => { if (!r.ok) throw new Error("Failed to load student"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [studentId, authFetch]);

  useEffect(() => {
    if (activeTab === "interviews" && studentId) {
      setLoadingInterviews(true);
      authFetch(`/api/admin/students/${studentId}/interviews`)
        .then((r) => { if (!r.ok) throw new Error("Failed to load interviews"); return r.json(); })
        .then((data) => {
          setInterviews(data);
          // Auto select first course if available and none selected yet
          if (data.length > 0 && !selectedCourseId) {
            const uniqueCourses = Array.from(new Set(data.map(i => i.course_id))).filter(Boolean);
            if (uniqueCourses.length > 0) {
              setSelectedCourseId(uniqueCourses[0]);
            }
          }
        })
        .catch((err) => console.error(err))
        .finally(() => setLoadingInterviews(false));
    }
  }, [activeTab, studentId, authFetch]);

  const s = data?.student;
  const enrollments = data?.enrollments ?? [];
  const evaluations = data?.evaluations ?? [];
  const certificates = data?.certificates ?? [];

  const avgScore = evaluations.length
    ? Math.round(evaluations.reduce((acc, e) => acc + (e.score ?? 0), 0) / evaluations.length * 10) / 10
    : 0;
  const passedCount = evaluations.filter((e) => e.passed).length;

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container admin-container">

          <button onClick={() => router.push("/admin?tab=students")} style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "13px", marginBottom: "28px", padding: 0 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="15 18 9 12 15 6" /></svg>
            Back
          </button>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "16px" }}>
              <span style={{ width: 36, height: 36, border: "3px solid var(--border-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading student profile…</span>
            </div>
          ) : error ? (
            <div style={{ padding: "20px", background: "var(--bg-danger)", border: "1px solid var(--border-danger)", borderRadius: "var(--radius-sm)", color: "var(--color-danger)", fontSize: "13px" }}>❌ {error}</div>
          ) : (
            <>
              {/* Tab navigation: Column 1 */}
              <div className="tabs" style={{ gridColumn: "1", marginBottom: "28px" }}>
                <div className={`tab ${activeTab === "profile" ? "active" : ""}`} onClick={() => setActiveTab("profile")}>
                  Profile & Progress
                </div>
                <div className={`tab ${activeTab === "interviews" ? "active" : ""}`} onClick={() => setActiveTab("interviews")}>
                  Interviews
                </div>
              </div>

              {/* Content Wrapper: Column 2 */}
              <div style={{ gridColumn: "2", width: "100%" }}>
                {/* Student identity card */}
                <div className="card admin-identity-card" style={{ marginBottom: "28px" }}>
                  <div style={{ width: 60, height: 60, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand), #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
                    {s?.name?.[0]?.toUpperCase()}
                  </div>
                  <div className="admin-identity-info">
                    <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", margin: 0, marginBottom: "4px" }}>{s?.name}</h1>
                    <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>{s?.email}</p>
                    <p style={{ color: "var(--text-subtle)", fontSize: "12px", margin: "4px 0 0" }}>
                      Member since {s?.joined ? new Date(s.joined).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}
                    </p>
                  </div>
                  <div className="admin-identity-stats">
                    {[
                      { label: "Courses", value: enrollments.length, color: "var(--brand)" },
                      { label: "Evals", value: evaluations.length, color: "var(--color-warning)" },
                      { label: "Passed", value: passedCount, color: "var(--color-success)" },
                      { label: "Certs", value: certificates.length, color: "#8b5cf6" },
                    ].map((stat) => (
                      <div key={stat.label} style={{ minWidth: "60px" }}>
                        <div style={{ fontSize: "26px", fontWeight: "700", color: stat.color, fontFamily: "JetBrains Mono" }}>{stat.value}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Average score bar */}
                {evaluations.length > 0 && (
                  <div className="card" style={{ marginBottom: "28px" }}>
                    <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "10px" }}>
                      <span style={{ fontSize: "13px", color: "var(--text-muted)", fontWeight: "500" }}>Overall Average Score</span>
                      <span style={{ fontSize: "14px", fontWeight: "700", color: avgScore >= 70 ? "var(--color-success)" : "var(--color-warning)", fontFamily: "JetBrains Mono" }}>{avgScore}%</span>
                    </div>
                    <div style={{ height: "8px", borderRadius: "4px", background: "var(--border-muted)", overflow: "hidden" }}>
                      <div style={{ height: "100%", width: `${avgScore}%`, background: avgScore >= 70 ? "var(--color-success)" : "var(--color-warning)", borderRadius: "4px", transition: "width 0.6s ease" }} />
                    </div>
                    <div style={{ fontSize: "11px", color: "var(--text-subtle)", marginTop: "6px" }}>{passedCount} of {evaluations.length} evaluations passed</div>
                  </div>
                )}

                {activeTab === "profile" ? (
                  <>
                    <div className="admin-grid-2">
                      {/* Enrollments */}
                      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-muted)" }}>
                          <h2 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono" }}>Course Enrollments</h2>
                        </div>
                        {enrollments.length === 0 ? (
                          <p style={{ padding: "24px", color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>No enrollments yet.</p>
                        ) : (
                          <div style={{ padding: "0 4px" }}>
                            {enrollments.map((e, i) => (
                              <div key={i} style={{ padding: "12px 16px", borderBottom: i < enrollments.length - 1 ? "1px solid var(--border-muted)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div>
                                  <div style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--text-title)", marginBottom: "2px" }}>{e.course_title}</div>
                                  <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Current Chapter index: {e.chapter + 1}</div>
                                </div>
                                <span className={`badge ${e.status === "completed" ? "badge-success" : e.status === "in_progress" ? "" : "badge-warning"}`} style={{ textTransform: "capitalize", fontSize: "10px" }}>
                                  {e.status?.replace("_", " ")}
                                </span>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>

                      {/* Evaluations */}
                      <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                        <div style={{ padding: "16px 20px", borderBottom: "1px solid var(--border-muted)" }}>
                          <h2 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono" }}>Evaluations</h2>
                        </div>
                        {evaluations.length === 0 ? (
                          <p style={{ padding: "24px", color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>No evaluations yet.</p>
                        ) : (
                          <div style={{ padding: "0 4px" }}>
                            {evaluations.map((e, i) => (
                              <div key={i} style={{ padding: "12px 16px", borderBottom: i < evaluations.length - 1 ? "1px solid var(--border-muted)" : "none", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                                <div>
                                  <div style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--text-title)", marginBottom: "2px" }}>
                                    {e.type === "capstone" ? "Capstone Interview" : e.chapter_title}
                                  </div>
                                  <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "capitalize" }}>
                                    {e.course_title} ({e.type})
                                  </div>
                                </div>
                                <div style={{ textAlign: "right" }}>
                                  <div style={{ fontSize: "15px", fontWeight: "700", color: e.passed ? "var(--color-success)" : "var(--color-danger)", fontFamily: "JetBrains Mono" }}>{e.score?.toFixed(1)}%</div>
                                  <div style={{ fontSize: "10px", color: e.passed ? "var(--color-success)" : "var(--color-danger)", fontWeight: "600" }}>{e.passed ? "✓ Passed" : "✗ Failed"}</div>
                                </div>
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Certificates */}
                    {certificates.length > 0 && (
                      <div className="card" style={{ padding: "20px 24px", marginTop: "20px" }}>
                        <h2 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)", marginBottom: "14px", textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono" }}>Certificates Earned</h2>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: "10px" }}>
                          {certificates.map((cert, i) => (
                            <div key={i} style={{ display: "inline-flex", alignItems: "center", gap: "8px", padding: "8px 14px", background: "rgba(99,102,241,0.08)", border: "1px solid rgba(99,102,241,0.2)", borderRadius: "20px", fontSize: "12px", color: "#6366f1", fontWeight: "600" }}>
                              🎓 {cert.course_title}
                              <span style={{ color: "var(--text-muted)", fontWeight: "400" }}>· {new Date(cert.issued).toLocaleDateString()}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </>
                ) : (
                  /* Interviews Tab View */
                  <div className="card" style={{ padding: "24px" }}>
                    <div style={{ marginBottom: "24px" }}>
                      <label className="form-label" style={{ fontSize: "14px", fontWeight: "600", marginBottom: "8px", display: "block" }}>
                        Select Course
                      </label>
                      <select
                        className="form-input"
                        value={selectedCourseId}
                        onChange={(e) => setSelectedCourseId(e.target.value)}
                        style={{ maxWidth: "400px", display: "block", cursor: "pointer" }}
                      >
                        <option value="">-- Choose a Course --</option>
                        {enrollments.map((e) => (
                          <option key={e.course_id} value={e.course_id}>
                            {e.course_title}
                          </option>
                        ))}
                      </select>
                    </div>

                    {loadingInterviews ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "200px", gap: "12px" }}>
                        <span style={{ width: 28, height: 28, border: "3px solid var(--border-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                        <span style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>Loading recordings…</span>
                      </div>
                    ) : !selectedCourseId ? (
                      <p style={{ color: "var(--text-muted)", fontSize: "13.5px", margin: 0 }}>Please select a course to view recordings.</p>
                    ) : (
                      (() => {
                        const courseInterviews = interviews.filter((i) => i.course_id === selectedCourseId);
                        if (courseInterviews.length === 0) {
                          return (
                            <div style={{ padding: "32px", textAlign: "center", border: "1px dashed var(--border-muted)", borderRadius: "var(--radius-sm)", color: "var(--text-muted)", fontSize: "13.5px" }}>
                              No interview recordings found for this course.
                            </div>
                          );
                        }
                        return (
                          <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "24px" }}>
                            {courseInterviews.map((i) => (
                              <div key={i.id} className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px", backgroundColor: "var(--bg-canvas)" }}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "12px" }}>
                                  <div>
                                    <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                                      {i.chapter_title}
                                    </h3>
                                    <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: "4px 0 0" }}>
                                      Attempted on {new Date(i.created_at).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}
                                    </p>
                                  </div>
                                  {i.evaluation ? (
                                    <div style={{ textAlign: "right" }}>
                                      <span style={{ 
                                        fontSize: "12px", 
                                        fontWeight: "700", 
                                        padding: "4px 10px", 
                                        borderRadius: "12px", 
                                        background: i.evaluation.passed ? "var(--bg-success)" : "var(--bg-danger)", 
                                        color: i.evaluation.passed ? "var(--color-success)" : "var(--color-danger)",
                                        border: i.evaluation.passed ? "1px solid var(--border-success)" : "1px solid var(--border-danger)",
                                      }}>
                                        {i.evaluation.score}% · {i.evaluation.passed ? "PASSED" : "FAILED"}
                                      </span>
                                    </div>
                                  ) : (
                                    <div>
                                      <span className="badge badge-warning" style={{ fontSize: "10px" }}>UNGRADED</span>
                                    </div>
                                  )}
                                </div>

                                <div style={{ maxWidth: "500px", width: "100%" }}>
                                  <RecordingPlayer src={i.recording_url} />
                                </div>

                                <div>
                                  <a
                                    href={i.recording_url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    style={{ fontSize: "13px", color: "var(--brand)", textDecoration: "none", fontWeight: "600", display: "inline-flex", alignItems: "center", gap: "4px" }}
                                  >
                                    Open in new tab ↗
                                  </a>
                                </div>
                              </div>
                            ))}
                          </div>
                        );
                      })()
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentProfilePage, ["admin"]);
