"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useEffect, useState } from "react";

function StudentDashboard() {
  const { user, authFetch } = useAuth();
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

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

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", display: "flex", justifyContent: "center", alignItems: "center", minHeight: "100vh" }}>
          <p style={{ color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>Loading workspace...</p>
        </div>
      </>
    );
  }

  const MY_COURSES = stats?.enrolled_courses || [];
  const RECENT_EVALUATIONS = stats?.recent_evaluations || [];

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
                label: "Active Tracks"
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-success)' }}>
                    <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                    <polyline points="22 4 12 14.01 9 11.01" />
                  </svg>
                ),
                value: stats?.modules_completed ?? 0,
                label: "Modules Completed"
              },
              {
                icon: (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }}>
                    <path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z" />
                    <path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8" />
                  </svg>
                ),
                value: stats?.oral_assessments ?? 0,
                label: "Oral Assessments"
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
                label: "Earned Credentials"
              },
            ].map((s, i) => (
               <div className="card stat-card" key={i}>
                <div className="stat-icon" style={{ display: 'flex', alignItems: 'center' }}>{s.icon}</div>
                <div>
                  <div className="stat-value">{s.value}</div>
                  <div className="stat-label">{s.label}</div>
                </div>
              </div>
            ))}
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
                <div className="card" key={c.id} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", backgroundColor: "#ffffff" }}>
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

          {/* Evaluations */}
          <h2 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
            Oral Evaluation Log
          </h2>
          <div className="table-container">
            {RECENT_EVALUATIONS.length === 0 ? (
               <div style={{ padding: "32px", textAlign: "center" }}>
                 <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>No evaluations recorded yet.</p>
               </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Topic Module</th><th>Track Course</th><th>Tech</th><th>Speech</th><th>Conf</th><th>Overall</th><th>Status</th><th>Date</th>
                  </tr>
                </thead>
                <tbody>
                  {RECENT_EVALUATIONS.map((e, i) => (
                    <tr key={i}>
                      <td style={{ fontWeight: "700", color: "var(--text-title)" }}>{e.chapter}</td>
                      <td style={{ color: "var(--text-main)" }}>{e.course}</td>
                      <td className="mono">{e.technical}%</td>
                      <td className="mono">{e.communication}%</td>
                      <td className="mono">{e.confidence}%</td>
                      <td className="mono" style={{ fontWeight: "700", color: "var(--brand)" }}>{e.score}%</td>
                      <td><span className={`badge ${e.passed ? "badge-success" : "badge-danger"}`}>{e.passed ? "PASSED" : "FAILED"}</span></td>
                      <td style={{ color: "var(--text-muted)" }}>{e.date}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentDashboard, ["student"]);
