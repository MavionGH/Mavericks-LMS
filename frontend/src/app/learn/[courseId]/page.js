"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

function LearnRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const { authFetch } = useAuth();

  useEffect(() => {
    async function redirect() {
      try {
        // Course and enrollment are independent reads — fetch them together.
        const [courseRes, enrollGetRes] = await Promise.all([
          authFetch(`/api/courses/${params.courseId}`),
          authFetch(`/api/enrollment/course/${params.courseId}`),
        ]);
        if (!courseRes.ok) throw new Error("Course not found");
        const course = await courseRes.json();

        let enrollRes = enrollGetRes;
        if (enrollRes.status === 404) {
          enrollRes = await authFetch("/api/enrollment/enroll", {
            method: "POST",
            body: JSON.stringify({ course_id: params.courseId }),
          });
        }
        const enrollment = await enrollRes.json();
        const chapters = [...(course.chapters || [])].sort((a, b) => a.order_index - b.order_index);
        const ch = chapters[enrollment.current_chapter_index] || chapters[0];
        if (ch) router.replace(`/learn/${params.courseId}/${ch.id}`);
        else router.replace("/courses");
      } catch {
        router.replace("/courses");
      }
    }
    redirect();
  }, [params.courseId, authFetch, router]);

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
        <p style={{ color: "var(--text-muted)" }}>Loading your course…</p>
      </div>
    </>
  );
}

export default withAuth(LearnRedirectPage);
