"use client";
import Navbar from "@/components/Navbar";
import Skeleton, { SkeletonCardGrid } from "@/components/Skeleton";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { useEffect, useState } from "react";

function CourseCard({ c }) {

  return (
    <Link href={`/courses/${c.id}`} className="card course-card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="course-card-thumb" style={{ padding: 0, overflow: "hidden" }}>
        {c.thumbnail ? (
          <img
            src={c.thumbnail}
            alt={c.title}
            style={{ width: "100%", height: "100%", objectFit: "cover" }}
          />
        ) : (
          c.title?.slice(0, 2).toUpperCase()
        )}
      </div>
      <div className="course-card-body">
        {/* Title row + enrollment badge */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "10px", marginBottom: "6px" }}>
          <h3 style={{ margin: 0 }}>{c.title}</h3>
          {c.enrollment_status === "completed" ? (
            <span style={{
              fontSize: "9px", fontWeight: "700", padding: "2px 6px",
              borderRadius: "4px", backgroundColor: "var(--bg-success)", color: "var(--color-success)",
              textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", flexShrink: 0
            }}>Passed</span>
          ) : c.enrollment_status ? (
            <span style={{
              fontSize: "9px", fontWeight: "700", padding: "2px 6px",
              borderRadius: "4px", backgroundColor: "var(--brand-muted)", color: "var(--brand)",
              textTransform: "uppercase", letterSpacing: "0.05em", fontFamily: "JetBrains Mono", flexShrink: 0
            }}>In Progress</span>
          ) : null}
        </div>

        {/* Teacher name */}
        {c.teacher_name && (
          <div style={{ fontSize: "12px", color: "var(--brand)", fontWeight: "600", marginBottom: "10px" }}>
            by {c.teacher_name}
          </div>
        )}

        {/* Description — clamped to 3 lines, full text on course detail page */}
        <p className="course-card-desc">
          {c.description}
        </p>

        {/* Bottom meta row */}
        <div className="course-card-meta" style={{ marginTop: "auto" }}>
          <span className="course-card-chapters">{c.chapter_count || 0} modules</span>
          <span className="btn btn-secondary btn-sm" style={{ pointerEvents: "none" }}>Learn Track</span>
        </div>
      </div>
    </Link>
  );
}

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
            <p>Master core engineering concepts with structured tracks and instant AI oral feedback.</p>
          </div>
          {loading ? (
            <div style={{ paddingTop: "40px" }}>
              <SkeletonCardGrid count={6} />
            </div>
          ) : courses.length === 0 ? (
            <div className="card" style={{ padding: "32px", textAlign: "center" }}>
              <p style={{ color: "var(--text-muted)", marginBottom: "16px" }}>No published courses yet. Teachers can create courses in Teacher Studio.</p>
              <Link href="/teacher" className="btn btn-secondary">Teacher Studio</Link>
            </div>
          ) : (
            <div className="grid-3">
              {courses.map((c) => (
                <CourseCard key={c.id} c={c} />
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}
