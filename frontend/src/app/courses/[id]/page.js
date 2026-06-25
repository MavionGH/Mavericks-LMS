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

  // ── Enrollment state ──
  const [enrollment, setEnrollment] = useState(null);
  const [enrollLoading, setEnrollLoading] = useState(true);
  const [enrolling, setEnrolling] = useState(false);
  const [enrollError, setEnrollError] = useState("");

  // ── Load course (public, no auth required) ──
  useEffect(() => {
    fetch(`http://localhost:8000/api/courses/${params.id}`)
      .then((r) => (r.ok ? r.json() : null))
      .then(setCourse)
      .finally(() => setLoading(false));
  }, [params.id]);

  // ── Check whether the signed-in student is already enrolled ──
  useEffect(() => {
    let active = true;
    async function checkEnrollment() {
      if (!user) {
        setEnrollLoading(false);
        return;
      }
      setEnrollLoading(true);
      try {
        const res = await authFetch(`/api/enrollment/course/${params.id}`);
        if (active && res.ok) setEnrollment(await res.json());
      } catch {
        /* not enrolled / network issue — treated as not enrolled */
      } finally {
        if (active) setEnrollLoading(false);
      }
    }
    checkEnrollment();
    return () => {
      active = false;
    };
  }, [params.id, user, authFetch]);

  const handleEnroll = async () => {
    if (!user) return;
    setEnrolling(true);
    setEnrollError("");
    try {
      const res = await authFetch("/api/enrollment/enroll", {
        method: "POST",
        body: JSON.stringify({ course_id: params.id }),
      });
      if (!res.ok) {
        const detail = await res
          .json()
          .then((d) => d?.detail)
          .catch(() => null);
        throw new Error(detail || "Could not enroll in this course");
      }
      setEnrollment(await res.json());
    } catch (err) {
      setEnrollError(err.message);
    } finally {
      setEnrolling(false);
    }
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
  const isEnrolled = !!enrollment;
  const currentIndex = enrollment?.current_chapter_index ?? 0;

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
                {chapters.length} Modules · {course.pass_threshold}% pass threshold · Optional course-wide AI interview
              </div>
              <div style={{ marginTop: "28px" }}>
                {!user ? (
                  <Link href="/login" className="btn btn-primary">Sign in to enroll</Link>
                ) : chapters.length === 0 ? (
                  <span className="badge badge-warning">No modules added yet</span>
                ) : enrollLoading ? (
                  <span style={{ color: "var(--text-muted)", fontSize: "13px" }}>Checking enrollment…</span>
                ) : isEnrolled ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "16px", flexWrap: "wrap" }}>
                    <span className="badge badge-success">✓ You are enrolled</span>
                    <Link href={`/learn/${params.id}`} className="btn btn-primary">Continue learning</Link>
                  </div>
                ) : (
                  <div>
                    <button className="btn btn-primary" onClick={handleEnroll} disabled={enrolling}>
                      {enrolling ? "Enrolling…" : "Enroll in this course"}
                    </button>
                    {enrollError && (
                      <p style={{ color: "var(--color-danger)", fontSize: "13px", marginTop: "8px" }}>{enrollError}</p>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>

          <h2 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono" }}>Syllabus Structure</h2>
          <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
            {chapters.map((ch, i) => {
              const unlocked = isEnrolled && i <= currentIndex;
              return (
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
                    {!user ? null : unlocked ? (
                      <Link href={`/learn/${params.id}/${ch.id}`} className="btn btn-secondary btn-sm">Enter Module</Link>
                    ) : !isEnrolled ? (
                      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>🔒 Enroll to unlock</span>
                    ) : (
                      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>🔒 Locked</span>
                    )}
                  </div>
                </div>
              );
            })}
            {chapters.length === 0 && (
              <p style={{ color: "var(--text-muted)" }}>Teacher has not added modules yet.</p>
            )}

            {/* Course-wide final AI interview — optional, drawn from every module */}
            {isEnrolled && chapters.length > 0 && (
              <div className="card" style={{ padding: "20px 24px", display: "flex", alignItems: "center", gap: "24px", backgroundColor: "#ffffff", border: "1px dashed var(--brand)" }}>
                <div className="mono" style={{ width: "36px", height: "36px", borderRadius: "var(--radius-sm)", border: "1px solid var(--brand)", display: "grid", placeItems: "center", fontSize: "16px", color: "var(--brand)" }}>
                  🎙
                </div>
                <div style={{ flex: 1 }}>
                  <span style={{ fontWeight: "700", fontSize: "15px" }}>Final AI Interview</span>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "4px" }}>
                    Optional · Mav asks questions spanning every module · take it any time
                  </p>
                </div>
                <Link href={`/interview/${params.id}`} className="btn btn-primary btn-sm">Start Interview</Link>
              </div>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
