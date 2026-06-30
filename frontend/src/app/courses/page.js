"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useEffect, useState } from "react";

export default function CoursesPage() {
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("http://localhost:8000/api/courses/")
      .then((r) => r.json())
      .then((data) => setCourses(Array.isArray(data) ? data : []))
      .catch(() => setCourses([]))
      .finally(() => setLoading(false));
  }, []);

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
                    <h3>{c.title}</h3>
                    <p>{c.description}</p>
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
