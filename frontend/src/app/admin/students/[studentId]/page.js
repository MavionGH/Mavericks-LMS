"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useParams, useRouter } from "next/navigation";

function StudentProfilePage() {
  const { authFetch } = useAuth();
  const { studentId } = useParams();
  const router = useRouter();

  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!studentId) return;
    setLoading(true);
    authFetch(`/api/admin/students/${studentId}`)
      .then((r) => { if (!r.ok) throw new Error("Failed to load student"); return r.json(); })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [studentId, authFetch]);

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
        <div className="container" style={{ padding: "48px 32px" }}>

          <button onClick={() => router.back()} style={{ display: "inline-flex", alignItems: "center", gap: "6px", background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "13px", marginBottom: "28px", padding: 0 }}>
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
              {/* Student identity card */}
              <div className="card" style={{ padding: "28px 32px", marginBottom: "28px", display: "flex", alignItems: "center", gap: "20px" }}>
                <div style={{ width: 60, height: 60, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand), #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "24px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
                  {s?.name?.[0]?.toUpperCase()}
                </div>
                <div style={{ flex: 1 }}>
                  <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", margin: 0, marginBottom: "4px" }}>{s?.name}</h1>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>{s?.email}</p>
                  <p style={{ color: "var(--text-subtle)", fontSize: "12px", margin: "4px 0 0" }}>
                    Member since {s?.joined ? new Date(s.joined).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" }) : "—"}
                  </p>
                </div>
                <div style={{ display: "flex", gap: "24px", textAlign: "center" }}>
                  {[
                    { label: "Courses", value: enrollments.length, color: "var(--brand)" },
                    { label: "Evals", value: evaluations.length, color: "var(--color-warning)" },
                    { label: "Passed", value: passedCount, color: "var(--color-success)" },
                    { label: "Certs", value: certificates.length, color: "#8b5cf6" },
                  ].map((stat) => (
                    <div key={stat.label}>
                      <div style={{ fontSize: "26px", fontWeight: "700", color: stat.color, fontFamily: "JetBrains Mono" }}>{stat.value}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Average score bar */}
              {evaluations.length > 0 && (
                <div className="card" style={{ padding: "20px 28px", marginBottom: "28px" }}>
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

              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
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
                            <div style={{ fontSize: "12.5px", fontWeight: "600", color: "var(--text-title)", marginBottom: "2px" }}>Course #{String(e.course_id).slice(-6)}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>Chapter {e.chapter + 1}</div>
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
                            <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "capitalize", marginBottom: "2px" }}>{e.type?.replace("_", " ") ?? "oral"}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-subtle)" }}>Chapter #{String(e.chapter_id).slice(-5)}</div>
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
                        🎓 Course #{String(cert.course_id).slice(-6)}
                        <span style={{ color: "var(--text-muted)", fontWeight: "400" }}>· {new Date(cert.issued).toLocaleDateString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentProfilePage, ["admin"]);
