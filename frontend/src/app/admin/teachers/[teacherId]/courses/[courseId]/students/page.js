"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useParams, useRouter } from "next/navigation";

function CourseStudentsPage() {
  const { authFetch } = useAuth();
  const { teacherId, courseId } = useParams();
  const router = useRouter();

  const [teacherData, setTeacherData] = useState(null);
  const [courseInfo, setCourseInfo] = useState(null);
  const [students, setStudents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);
  // tracks which row's View Stats button is active
  const [viewingStudentId, setViewingStudentId] = useState(null);
  // tracks if "View Full Profile" is navigating
  const [navigatingProfile, setNavigatingProfile] = useState(false);

  useEffect(() => {
    if (!teacherId || !courseId) return;
    setLoading(true);
    Promise.all([
      authFetch(`/api/admin/teachers/${teacherId}`).then((r) => r.json()),
      authFetch(`/api/admin/teachers/${teacherId}/courses/${courseId}/students`).then((r) => r.json()),
    ])
      .then(([teacherRes, studentsRes]) => {
        setTeacherData(teacherRes.teacher);
        const course = (teacherRes.courses || []).find((c) => c.id === courseId);
        setCourseInfo(course || null);
        setStudents(Array.isArray(studentsRes) ? studentsRes : []);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [teacherId, courseId, authFetch]);

  const statusBadge = (s) => {
    if (s === "completed") return "badge-success";
    if (s === "in_progress") return "badge";
    return "badge-warning";
  };

  const handleViewStats = (student) => {
    setViewingStudentId(student.id);
    // Brief delay gives spinner feedback before modal opens
    setTimeout(() => {
      setSelectedStudent(student);
      setViewingStudentId(null);
    }, 300);
  };

  const handleViewProfile = (studentId) => {
    setNavigatingProfile(true);
    router.push(`/admin/students/${studentId}`);
  };

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>

          {/* Breadcrumb */}
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "28px", fontSize: "13px", color: "var(--text-muted)" }}>
            <button onClick={() => router.push("/admin?tab=teachers")} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--brand)", padding: 0, fontWeight: "500" }}>
              ← Teachers
            </button>
            <span>›</span>
            <button onClick={() => router.push(`/admin/teachers/${teacherId}`)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 0 }}>
              {teacherData?.name ?? "Teacher"}
            </button>
            <span>›</span>
            <span style={{ color: "var(--text-title)", fontWeight: "600" }}>{courseInfo?.title ?? "Course"}</span>
          </div>

          {loading ? (
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "300px", gap: "16px" }}>
              <span style={{ width: 36, height: 36, border: "3px solid var(--border-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
              <span style={{ color: "var(--text-muted)", fontSize: "14px" }}>Loading enrolled students…</span>
            </div>
          ) : error ? (
            <div style={{ padding: "20px", background: "var(--bg-danger)", border: "1px solid var(--border-danger)", borderRadius: "var(--radius-sm)", color: "var(--color-danger)", fontSize: "13px" }}>❌ {error}</div>
          ) : (
            <>
              {/* Course header */}
              <div className="card" style={{ padding: "24px 32px", marginBottom: "28px" }}>
                <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", flexWrap: "wrap", gap: "16px" }}>
                  <div>
                    <div style={{ display: "flex", alignItems: "center", gap: "10px", marginBottom: "6px" }}>
                      <h1 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>{courseInfo?.title ?? "Course"}</h1>
                      {courseInfo && (
                        <span className={`badge ${courseInfo.is_published ? "badge-success" : "badge-warning"}`}>
                          {courseInfo.is_published ? "Published" : "Draft"}
                        </span>
                      )}
                    </div>
                    <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>
                      By <strong style={{ color: "var(--text-title)" }}>{teacherData?.name}</strong>
                      <span style={{ marginLeft: "8px", color: "var(--text-subtle)" }}>({teacherData?.email})</span>
                    </p>
                  </div>
                  <div style={{ display: "flex", gap: "24px", textAlign: "center" }}>
                    {[
                      { label: "Enrolled", value: students.length, color: "var(--brand)" },
                      { label: "Completed", value: students.filter((s) => s.status === "completed").length, color: "var(--color-success)" },
                      { label: "Modules", value: courseInfo?.chapter_count ?? "—", color: "var(--color-warning)" },
                    ].map((stat) => (
                      <div key={stat.label}>
                        <div style={{ fontSize: "24px", fontWeight: "700", color: stat.color, fontFamily: "JetBrains Mono" }}>{stat.value}</div>
                        <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.06em" }}>{stat.label}</div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Students table */}
              <div className="card" style={{ padding: 0, overflow: "hidden" }}>
                <div style={{ padding: "18px 24px", borderBottom: "1px solid var(--border-muted)" }}>
                  <h2 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", margin: 0, textTransform: "uppercase", letterSpacing: "0.06em", fontFamily: "JetBrains Mono" }}>Enrolled Students</h2>
                </div>
                {students.length === 0 ? (
                  <div style={{ padding: "48px", textAlign: "center", color: "var(--text-muted)", fontSize: "14px" }}>No students enrolled yet.</div>
                ) : (
                  <div className="table-container" style={{ margin: 0 }}>
                    <table>
                      <thead>
                        <tr>
                          <th>Student</th><th>Email</th><th>Enrolled</th>
                          <th>Status</th><th>Evals Passed</th><th>Avg Score</th><th>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {students.map((s) => {
                          const isViewing = viewingStudentId === s.id;
                          return (
                            <tr key={s.id}>
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                                  <div style={{ width: 32, height: 32, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand), #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "13px", fontWeight: "700", color: "#fff", flexShrink: 0 }}>
                                    {s.name?.[0]?.toUpperCase()}
                                  </div>
                                  <span style={{ fontWeight: "600", color: "var(--text-title)" }}>{s.name}</span>
                                </div>
                              </td>
                              <td style={{ color: "var(--text-muted)", fontSize: "12.5px" }}>{s.email}</td>
                              <td style={{ color: "var(--text-subtle)", fontSize: "12px" }}>{s.enrolled_at ? new Date(s.enrolled_at).toLocaleDateString() : "—"}</td>
                              <td><span className={`badge ${statusBadge(s.status)}`} style={{ textTransform: "capitalize" }}>{s.status?.replace("_", " ") ?? "—"}</span></td>
                              <td className="mono" style={{ color: s.evaluations_passed > 0 ? "var(--color-success)" : "var(--text-muted)" }}>{s.evaluations_passed}/{s.evaluations_total}</td>
                              <td className="mono" style={{ fontWeight: "700", color: s.average_score >= 70 ? "var(--color-success)" : s.average_score > 0 ? "var(--color-warning)" : "var(--text-muted)" }}>
                                {s.average_score > 0 ? `${s.average_score}%` : "—"}
                              </td>
                              <td>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={() => handleViewStats(s)}
                                  disabled={viewingStudentId !== null}
                                  style={{ display: "inline-flex", alignItems: "center", gap: "5px", minWidth: "92px", justifyContent: "center", opacity: viewingStudentId !== null && !isViewing ? 0.5 : 1 }}
                                >
                                  {isViewing ? (
                                    <>
                                      <span style={{ width: 12, height: 12, border: "2px solid var(--text-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                                      Loading…
                                    </>
                                  ) : (
                                    <>
                                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                                      View Stats
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

      {/* Student stats modal */}
      {selectedStudent && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: "20px" }} onClick={() => setSelectedStudent(null)}>
          <div className="card" style={{ maxWidth: 460, width: "100%", padding: "32px", position: "relative" }} onClick={(e) => e.stopPropagation()}>
            <button onClick={() => setSelectedStudent(null)} style={{ position: "absolute", top: 14, right: 16, background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", fontSize: "22px", lineHeight: 1 }}>×</button>
            <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "24px" }}>
              <div style={{ width: 48, height: 48, borderRadius: "50%", background: "linear-gradient(135deg, var(--brand), #8b5cf6)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "18px", fontWeight: "700", color: "#fff" }}>
                {selectedStudent.name?.[0]?.toUpperCase()}
              </div>
              <div>
                <div style={{ fontWeight: "700", fontSize: "16px", color: "var(--text-title)" }}>{selectedStudent.name}</div>
                <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>{selectedStudent.email}</div>
              </div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "10px", marginBottom: "20px" }}>
              {[
                { label: "Status", value: selectedStudent.status?.replace("_", " ") ?? "—" },
                { label: "Enrolled On", value: selectedStudent.enrolled_at ? new Date(selectedStudent.enrolled_at).toLocaleDateString() : "—" },
                { label: "Evals Completed", value: String(selectedStudent.evaluations_total) },
                { label: "Evals Passed", value: String(selectedStudent.evaluations_passed), color: "var(--color-success)" },
                { label: "Avg Score", value: selectedStudent.average_score > 0 ? `${selectedStudent.average_score}%` : "N/A", color: selectedStudent.average_score >= 70 ? "var(--color-success)" : "var(--color-warning)" },
                { label: "Chapter", value: `#${selectedStudent.current_chapter + 1}` },
              ].map((item) => (
                <div key={item.label} style={{ padding: "12px 14px", background: "var(--bg-canvas)", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-muted)" }}>
                  <div style={{ fontSize: "10px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: "4px", fontFamily: "JetBrains Mono" }}>{item.label}</div>
                  <div style={{ fontSize: "15px", fontWeight: "700", color: item.color ?? "var(--text-title)", textTransform: "capitalize" }}>{item.value}</div>
                </div>
              ))}
            </div>
            <button
              className="btn btn-secondary"
              style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "8px" }}
              disabled={navigatingProfile}
              onClick={() => handleViewProfile(selectedStudent.id)}
            >
              {navigatingProfile ? (
                <>
                  <span style={{ width: 14, height: 14, border: "2px solid var(--text-muted)", borderTopColor: "var(--brand)", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  Opening Profile…
                </>
              ) : (
                "View Full Profile →"
              )}
            </button>
          </div>
        </div>
      )}
    </>
  );
}

export default withAuth(CourseStudentsPage, ["admin"]);
