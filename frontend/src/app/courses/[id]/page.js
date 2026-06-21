"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";

export default function CourseDetailPage() {
  const params = useParams();
  const { user, authFetch } = useAuth();
  const [course, setCourse] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`http://localhost:8000/api/courses/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCourse)
      .finally(() => setLoading(false));
  }, [params.id]);

  const handleEnroll = async () => {
    if (!user) return;
    const chapters = [...(course.chapters || [])].sort((a, b) => a.order_index - b.order_index);
    const first = chapters[0];
    if (first) window.location.href = `/learn/${params.id}/${first.id}`;
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>Loading course…</p>
        </div>
      </>
    );
  }

  if (!course) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)" }}>Course not found</p>
          <Link href="/courses" className="btn btn-primary" style={{ marginTop: "16px" }}>Back to catalog</Link>
        </div>
      </>
    );
  }

  const chapters = [...(course.chapters || [])].sort((a, b) => a.order_index - b.order_index);

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          <div className="card" style={{ padding: "40px", marginBottom: "32px", display: "flex", gap: "32px", backgroundColor: "#ffffff" }}>
            <div className="mono" style={{ fontSize: "28px", fontWeight: "700", width: "80px", height: "80px", borderRadius: "var(--radius-md)", backgroundColor: "var(--brand-muted)", display: "grid", placeItems: "center", color: "var(--brand)" }}>
              {course.title?.slice(0, 2).toUpperCase()}
            </div>
            <div style={{ flex: 1 }}>
              <h1 style={{ fontSize: "32px", fontWeight: "700", marginBottom: "12px" }}>{course.title}</h1>
              <p style={{ color: "var(--text-main)", marginBottom: "24px", lineHeight: "1.6" }}>{course.description}</p>
              <div style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                {chapters.length} Modules · {course.pass_threshold}% pass threshold · AI oral assessment per module
              </div>
              <div style={{ marginTop: "28px" }}>
                {user ? (
                  chapters.length > 0 ? (
                    <button className="btn btn-primary" onClick={handleEnroll}>Start course</button>
                  ) : (
                    <span className="badge badge-warning">No modules added yet</span>
                  )
                ) : (
                  <Link href="/login" className="btn btn-primary">Sign in to start learning</Link>
                )}
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono" }}>Syllabus Structure</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {chapters.map((ch, i) => (
              <div className="card" key={ch.id} style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "24px", backgroundColor: "#ffffff" }}>
                <div className="mono" style={{ width: "36px", height: "36px", borderRadius: "var(--radius-sm)", border: "1px solid var(--border-muted)", display: "grid", placeItems: "center", fontSize: "12px" }}>
                  {String(i + 1).padStart(2, "0")}
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: "700", fontSize: "15px" }}>{ch.title}</span>
                  {ch.youtube_url && user && (
                    <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>Includes video lecture</p>
                  )}
                </div>
                <div>
                  {user && i === 0 ? (
                    <Link href={`/learn/${params.id}/${ch.id}`} className="btn btn-secondary btn-sm">Enter Module</Link>
                  ) : user ? (
                    <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>🔒 Locked</span>
                  ) : null}
                </div>
              </div>
            ))}
            {chapters.length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>Teacher has not added modules yet.</p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
