"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

// Static fallback data shown until the API populates
const COURSES_ADMIN = [
  { id: "1", title: "JavaScript Fundamentals", chapters: 8,  students: 342, passRate: 78, published: true  },
  { id: "2", title: "React & Next.js Mastery",  chapters: 12, students: 256, passRate: 82, published: true  },
  { id: "3", title: "Python for Data Science",  chapters: 10, students: 189, passRate: 71, published: true  },
  { id: "4", title: "System Design (Draft)",     chapters: 3,  students: 0,   passRate: 0,  published: false },
];

function AdminPanel() {
  const { user, authFetch } = useAuth();
  const [activeTab, setActiveTab] = useState("dashboard");
  const [analytics, setAnalytics]     = useState(null);
  const [students, setStudents]       = useState([]);
  const [teachers, setTeachers]       = useState([]);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // Load analytics when on dashboard tab
  useEffect(() => {
    if (activeTab === "dashboard") {
      setAnalyticsLoading(true);
      authFetch("/api/admin/analytics")
        .then((r) => r.json())
        .then((d) => { if (d.total_students !== undefined) setAnalytics(d); })
        .catch(() => {})
        .finally(() => setAnalyticsLoading(false));
    }
    if (activeTab === "students") {
      authFetch("/api/admin/students")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setStudents(d); })
        .catch(() => {});
    }
    if (activeTab === "teachers") {
      authFetch("/api/admin/teachers")
        .then((r) => r.json())
        .then((d) => { if (Array.isArray(d)) setTeachers(d); })
        .catch(() => {});
    }
  }, [activeTab, authFetch]);

  const STATS = analytics
    ? [
        { label: "Total Students",    value: analytics.total_students,    icon: "👥" },
        { label: "Active Enrollments",value: analytics.active_students,   icon: "📈" },
        { label: "Published Courses", value: analytics.published_courses, icon: "📚" },
        { label: "Certificates",      value: analytics.certificates_issued, icon: "🎓" },
      ]
    : [
        { label: "Total Students",    value: "—", icon: "👥" },
        { label: "Active Enrollments",value: "—", icon: "📈" },
        { label: "Published Courses", value: "—", icon: "📚" },
        { label: "Certificates",      value: "—", icon: "🎓" },
      ];

  const TABS = [
    { key: "dashboard", label: "Analytics"  },
    { key: "courses",   label: "Courses"    },
    { key: "students",  label: "Students"   },
    { key: "teachers",  label: "Teachers"   },
  ];

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="container" style={{ padding: "48px 32px" }}>

          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em" }}>
                Operations Console
              </h1>
              <span style={{
                fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                borderRadius: "4px", background: "var(--bg-warning)", color: "var(--color-warning)",
                border: "1px solid rgba(245,158,11,0.2)", fontFamily: "JetBrains Mono",
              }}>
                ADMIN
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Logged in as <strong style={{ color: "var(--text-title)" }}>{user?.name}</strong> — full platform administration.
            </p>
          </div>

          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: "32px" }}>
            {TABS.map((t) => (
              <div key={t.key} className={`tab ${activeTab === t.key ? "active" : ""}`} onClick={() => setActiveTab(t.key)}>
                {t.label}
              </div>
            ))}
          </div>

          {/* ── Analytics ── */}
          {activeTab === "dashboard" && (
            <div>
              {analyticsLoading && (
                <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "16px" }}>Loading live data…</p>
              )}
              <div className="grid-4" style={{ marginBottom: "32px" }}>
                {STATS.map((s, i) => (
                  <div className="card stat-card" key={i}>
                    <div style={{ fontSize: "11px", color: "var(--text-subtle)", fontFamily: "JetBrains Mono", textTransform: "uppercase", marginBottom: "8px" }}>{s.label}</div>
                    <div className="mono" style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)" }}>{s.value}</div>
                  </div>
                ))}
              </div>

              <div className="grid-2">
                <div className="card" style={{ padding: "24px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono" }}>
                    Evaluation Performance
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                    <div>
                      <div className="flex-between" style={{ marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Passing Ratio</span>
                        <span className="mono" style={{ fontWeight: "700", color: "var(--color-success)" }}>{analytics ? analytics.pass_rate + "%" : "—"}</span>
                      </div>
                      <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: analytics ? `${analytics.pass_rate}%` : "0%", backgroundColor: "var(--color-success)" }} />
                      </div>
                    </div>
                    <div>
                      <div className="flex-between" style={{ marginBottom: "6px" }}>
                        <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>Average Score</span>
                        <span className="mono" style={{ fontWeight: "700", color: "var(--brand)" }}>{analytics ? analytics.average_score + "%" : "—"}</span>
                      </div>
                      <div className="progress-bar-container">
                        <div className="progress-bar-fill" style={{ width: analytics ? `${analytics.average_score}%` : "0%" }} />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="card" style={{ padding: "24px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono" }}>
                    Platform Summary
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", fontSize: "13px" }}>
                    <div className="flex-between"><span style={{ color: "var(--text-muted)" }}>Total Courses</span><span className="mono" style={{ fontWeight: "600" }}>{analytics?.total_courses ?? "—"}</span></div>
                    <div className="flex-between"><span style={{ color: "var(--text-muted)" }}>Total Enrollments</span><span className="mono" style={{ fontWeight: "600" }}>{analytics?.total_enrollments ?? "—"}</span></div>
                    <div className="flex-between"><span style={{ color: "var(--text-muted)" }}>Completed Courses</span><span className="mono" style={{ fontWeight: "600" }}>{analytics?.completed_courses ?? "—"}</span></div>
                    <div className="flex-between"><span style={{ color: "var(--text-muted)" }}>Certificates Issued</span><span className="mono" style={{ fontWeight: "600" }}>{analytics?.certificates_issued ?? "—"}</span></div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* ── Courses ── */}
          {activeTab === "courses" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Course</th><th>Chapters</th><th>Students</th><th>Pass Rate</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {COURSES_ADMIN.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: "600", color: "var(--text-title)" }}>{c.title}</td>
                      <td className="mono">{c.chapters}</td>
                      <td className="mono">{c.students}</td>
                      <td className="mono">{c.passRate}%</td>
                      <td>
                        <span className={`badge ${c.published ? "badge-success" : "badge-warning"}`}>
                          {c.published ? "PUBLISHED" : "DRAFT"}
                        </span>
                      </td>
                      <td><button className="btn btn-secondary btn-sm">Configure</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Students ── */}
          {activeTab === "students" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Email</th><th>Enrollments</th><th>Avg Score</th><th>Joined</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {students.length === 0 ? (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>No students yet.</td></tr>
                  ) : students.map((s) => (
                    <tr key={s.id}>
                      <td style={{ fontWeight: "600", color: "var(--text-title)" }}>{s.name}</td>
                      <td style={{ color: "var(--text-muted)" }}>{s.email}</td>
                      <td className="mono">{s.enrollments}</td>
                      <td className="mono" style={{ fontWeight: "600" }}>{s.average_score}%</td>
                      <td style={{ color: "var(--text-subtle)", fontSize: "12px" }}>{new Date(s.joined).toLocaleDateString()}</td>
                      <td><button className="btn btn-secondary btn-sm">View</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* ── Teachers ── */}
          {activeTab === "teachers" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Name</th><th>Email</th><th>Joined</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {teachers.length === 0 ? (
                    <tr><td colSpan={4} style={{ textAlign: "center", color: "var(--text-muted)", padding: "32px" }}>No teachers registered yet.</td></tr>
                  ) : teachers.map((t) => (
                    <tr key={t.id}>
                      <td style={{ fontWeight: "600", color: "var(--text-title)" }}>{t.name}</td>
                      <td style={{ color: "var(--text-muted)" }}>{t.email}</td>
                      <td style={{ color: "var(--text-subtle)", fontSize: "12px" }}>{new Date(t.joined).toLocaleDateString()}</td>
                      <td>
                        <button className="btn btn-secondary btn-sm">Edit Role</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

        </div>
      </div>
    </>
  );
}

export default withAuth(AdminPanel, ["admin"]);
