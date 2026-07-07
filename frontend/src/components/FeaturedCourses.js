"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/context/AuthContext";
import Spinner from "@/components/Spinner";

const MAX_FEATURED = 3;

export default function FeaturedCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/courses/`)
      .then((r) => r.json())
      .then((data) => {
        setCourses(Array.isArray(data) ? data.slice(0, MAX_FEATURED) : []);
      })
      .catch(() => {
        setCourses([]);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <Spinner text="Loading active tracks..." />;
  }

  if (courses.length === 0) {
    return (
      <div style={{ border: "2px solid var(--text-title)", padding: "48px 32px", textAlign: "center", backgroundColor: "var(--bg-surface)" }}>
        <div style={{ fontFamily: "JetBrains Mono, monospace", fontSize: "12px", color: "var(--brand)", marginBottom: "16px" }}>
          [ DATABASE STATUS // NO_ACTIVE_TRACKS ]
        </div>
        <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "14px", maxWidth: "480px", margin: "0 auto 24px auto", lineHeight: "1.6" }}>
          There are currently no active learning tracks published in the Mavericks database. You can manage or publish courses by logging in as a teacher.
        </p>
        <div style={{ display: "flex", gap: "16px", justifyContent: "center", flexWrap: "wrap" }}>
          <Link href="/courses" className="btn btn-primary">
            Explore Catalog
          </Link>
          <Link href="/teacher" className="btn btn-secondary">
            Teacher Studio
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="grid-3">
      {courses.map((c) => (
        <Link 
          href={`/courses/${c.id}`} 
          className="card course-card" 
          key={c.id} 
          style={{ display: "flex", flexDirection: "column" }}
        >
          <div className="course-card-thumb">
            {c.title?.slice(0, 2).toUpperCase()}
          </div>
          <div className="course-card-body">
            <h3 style={{ fontSize: "16px", fontWeight: "800", textTransform: "uppercase", letterSpacing: "-0.02em" }}>
              {c.title}
            </h3>
            {c.teacher_name && (
              <div style={{ fontSize: "11px", color: "var(--brand)", fontWeight: "700", fontFamily: "JetBrains Mono, monospace", marginTop: "2px" }}>
                BY {c.teacher_name.toUpperCase()}
              </div>
            )}
            <p className="course-card-desc" style={{ fontSize: "13.5px", marginTop: "8px" }}>
              {c.description}
            </p>
            <div className="course-card-meta" style={{ marginTop: "auto", borderTop: "1px solid var(--border-muted)" }}>
              <span className="course-card-chapters" style={{ fontSize: "12px", fontFamily: "JetBrains Mono, monospace" }}>
                {c.chapter_count || 0} modules
              </span>
              <span className="btn btn-secondary btn-sm" style={{ pointerEvents: "none" }}>
                Learn Track
              </span>
            </div>
          </div>
        </Link>
      ))}
    </div>
  );
}
