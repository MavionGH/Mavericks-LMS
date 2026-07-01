"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

export default function CoursesPage() {
  const { authFetch } = useAuth();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch("/api/courses/")
      .then((r) => r.json())
      .then((data) => setCourses(Array.isArray(data) ? data : []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, [authFetch]);

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="container" style={{ padding: "48px 32px" }}>
          <div className="section-header">
            <h2>Course Catalog</h2>
            <p>Access our technical learning curriculum with AI oral assessments after each module.</p>
          </div>
          {loading ? (
            <p style={{ color: "var(--text-muted)" }}>Loading courses…</p>
          ) : courses.length === 0 ? (
            <div className="card" style={{ padding: "32px", textAlign: "center" }}>
              <p style={{ color: "var(--text-muted)", marginBottom: "16px" }}>No published courses yet. Teachers can create courses in Teacher Studio.</p>
              <Link href="/teacher" className="btn btn-secondary">Teacher Studio</Link>
            </div>
          ) : (
            <div className="grid-3">
              {courses.map((c) => (
                <div className="card course-card" key={c.id}>
                  <div className="course-card-thumb">{c.title?.slice(0, 2).toUpperCase()}</div>
                  <div className="course-card-body">
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "8px" }}>
                      <h3 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "var(--text-title)" }}>{c.title}</h3>
                      {c.enrollment_status === "completed" ? (
                        <span style={{
                          fontSize: "9px", fontWeight: "700", padding: "2px 6px",
                          borderRadius: "4px", backgroundColor: "#d1fae5", color: "#065f46",
                          textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", flexShrink: 0
                        }}>
                          Passed
                        </span>
                      ) : c.enrollment_status ? (
                        <span style={{
                          fontSize: "9px", fontWeight: "700", padding: "2px 6px",
                          borderRadius: "4px", backgroundColor: "#eff6ff", color: "#1e40af",
                          textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", flexShrink: 0
                        }}>
                          In Progress
                        </span>
                      ) : null}
                    </div>
                    <p style={{ margin: "0 0 16px 0", fontSize: "13px", color: "var(--text-muted)", lineHeight: 1.5 }}>{c.description}</p>
                    <div className="course-card-meta">
                      <span className="course-card-chapters">{c.chapter_count || 0} modules</span>
                      <Link href={`/courses/${c.id}`} className="btn btn-secondary btn-sm">Learn Track</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
