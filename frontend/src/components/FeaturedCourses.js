"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { API_BASE } from "@/context/AuthContext";

// Featured learning tracks on the landing page. These are the REAL published
// courses pulled from the backend (no hardcoded placeholders) so every card links
// to a course that actually exists. We show the first few as a teaser.
const MAX_FEATURED = 3;

export default function FeaturedCourses() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/api/courses/`)
      .then((r) => r.json())
      .then((data) => setCourses(Array.isArray(data) ? data.slice(0, MAX_FEATURED) : []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <p style={{ color: "var(--text-muted)" }}>Loading courses…</p>;
  }

  if (courses.length === 0) {
    return (
      <div className="card" style={{ padding: "32px", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)", marginBottom: "16px" }}>
          No published courses yet. Browse the full catalog as tracks become available.
        </p>
        <Link href="/courses" className="btn btn-secondary">Explore Catalog</Link>
      </div>
    );
  }

  return (
    <div className="grid-3">
      {courses.map((c) => (
        <div className="card course-card" key={c.id}>
          <div className="course-card-thumb">{c.title?.slice(0, 2).toUpperCase()}</div>
          <div className="course-card-body">
            <h3>{c.title}</h3>
            <p>{c.description}</p>
            <div className="course-card-meta">
              <span className="course-card-chapters">{c.chapter_count || 0} chapters</span>
              <Link href={`/courses/${c.id}`} className="btn btn-secondary btn-sm">View details</Link>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
