"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useParams, useRouter } from "next/navigation";

function TeacherCoursesPage() {
  const { authFetch } = useAuth();
  const { teacherId } = useParams();
  const router = useRouter();

  const [teacher, setTeacher] = useState(null);
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  // tracks which course row's button is navigating
  const [navigatingCourseId, setNavigatingCourseId] = useState(null);

  useEffect(() => {
    if (!teacherId) return;
    setLoading(true);
    authFetch(`/api/admin/teachers/${teacherId}`)
      .then((r) => {
        if (!r.ok) throw new Error("Failed to load teacher data");
        return r.json();
      })
      .then((d) => {
        setTeacher(d.teacher);
        setCourses(d.courses || []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [teacherId, authFetch]);

  const published = courses.filter((c) => c.is_published);
  const drafts = courses.filter((c) => !c.is_published);

  const handleSeeStudents = (courseId) => {
    setNavigatingCourseId(courseId);
    router.push(`/admin/teachers/${teacherId}/courses/${courseId}/students`);
  };

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>

          {/* Back button — lands on Teachers tab */}
          <button
            onClick={() => router.push("/admin?tab=teachers")}
            style={{
              display: "inline-flex", alignItems: "center", gap: "6px",
              background: "none", border: "none", cursor: "pointer",
              color: "var(--text-muted)", fontSize: "13px", marginBottom: "28px",
              padding: 0, transition: "color 0.15s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.color = "var(--text-title)")}
            onMouseLeave={(e) => (e.currentTarget.style.color = "var(--text-muted)")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6" />
            </svg>
            Back to Teachers
          </button>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "16px" }}>
              <span style={{ width: 36, height: 36, border: "3px solid var(--border-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading teacher data…</span>
            </div>
          ) : error ? (
            <div style={{ padding: "20px", background: "var(--bg-danger)", border: "1px solid var(--border-danger)", borderRadius: "var(--radius-sm)", color: "var(--color-danger)", fontSize: "13px" }}>
              ❌ {error}
            </div>
          ) : (
            <>
              {/* Teacher header card */}
              <div className="card" style={{ padding: "28px 32px", marginBottom: "32px", display: "flex", alignItems: "center", gap: "20px" }}>
                <div style={{ width: 56, height: 56, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand), #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "22px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
                  {teacher?.name?.[0]?.toUpperCase() ?? "T"}
                </div>
                <div style={{ flex: 1 }}>
                  <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", margin: 0, marginBottom: "4px" }}>{teacher?.name}</h1>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>{teacher?.email}</p>
                </div>
                <div style={{ display: "flex", gap: "24px", textAlign: "center" }}>
                  {[
                    { label: "Total", value: courses.length, color: "var(--brand)" },
                    { label: "Published", value: published.length, color: "var(--color-success)" },
                    { label: "Drafts", value: drafts.length, color: "var(--color-warning)" },
                  ].map((s) => (
                    <div key={s.label}>
                      <div style={{ fontSize: "24px", fontWeight: "700", color: s.color, fontFamily: "JetBrains Mono" }}>{s.value}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{s.label}</div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Courses table */}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "20px 24px", borderBottom: "1px solid var(--border-muted)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                  <h2 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono" }}>All Courses</h2>
                  <span style={{ fontSize: "12px", color: "var(--text-muted)" }}>{courses.length} total</span>
                </div>

                {courses.length === 0 ? (
                  <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>This teacher has no courses yet.</div>
                ) : (
                  <div className="table-container" style={{ margin: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Course Name</th><th>Modules</th><th>Status</th><th>Created</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {courses.map((c) => {
                          const isNavigating = navigatingCourseId === c.id;
                          return (
                            <tr key={c.id}>
                              <td style={{ fontWeight: "600", color: "var(--text-title)" }}>{c.title}</td>
                              <td className="mono">{c.chapter_count}</td>
                              <td>
                                <span className={`badge ${c.is_published ? "badge-success" : "badge-warning"}`}>
                                  {c.is_published ? "Published" : "Draft"}
                                </span>
                              </td>
                              <td style={{ color: "var(--text-subtle)", fontSize: "12px" }}>{new Date(c.created_at).toLocaleDateString()}</td>
                              <td>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleSeeStudents(c.id)}
                                  disabled={navigatingCourseId !== null}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: "112px", justifyContent: "center", opacity: navigatingCourseId !== null && !isNavigating ? 0.5 : 1 }}
                                >
                                  {isNavigating ? (
                                    <>
                                      <span style={{ width: 12, height: 12, border: "2px solid var(--text-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                                      Loading…
                                    </>
                                  ) : (
                                    <>
                                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" />
                                        <path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                                      </svg>
                                      See Students
                                    </>
                                  )}
                                </button>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
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

export default withAuth(TeacherCoursesPage, ["admin"]);
