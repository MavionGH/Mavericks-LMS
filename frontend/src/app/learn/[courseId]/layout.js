"use client";
import React, { createContext, useContext, useState, useEffect, useRef } from "react";
import { useParams } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import Navbar from "@/components/Navbar";
import { SkeletonClassroom } from "@/components/Skeleton";

const LearnContext = createContext(null);

export function useLearn() {
  return useContext(LearnContext);
}

export default function LearnLayout({ children }) {
  const params = useParams();
  const { authFetch } = useAuth();

  const [course, setCourse] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const chapterCache = useRef({});

  const getCachedChapter = (chapterId) => chapterCache.current[chapterId];
  const setCachedChapter = (chapterId, detail, quiz) => {
    chapterCache.current[chapterId] = { detail, quiz };
  };

  useEffect(() => {
    async function loadCourse() {
      setLoading(true);
      setError("");
      chapterCache.current = {};
      try {
        const [courseRes, enrollGetRes] = await Promise.all([
          authFetch(`/api/courses/${params.courseId}`),
          authFetch(`/api/enrollment/course/${params.courseId}`),
        ]);

        if (!courseRes.ok) throw new Error("Course not found");
        const courseData = await courseRes.json();
        setCourse(courseData);

        let enrollRes = enrollGetRes;
        if (enrollRes.status === 404) {
          enrollRes = await authFetch("/api/enrollment/enroll", {
            method: "POST",
            body: JSON.stringify({ course_id: params.courseId }),
          });
        }
        if (!enrollRes.ok) {
          const detail = await enrollRes
            .json()
            .then((d) => d?.detail)
            .catch(() => null);
          throw new Error(detail || "Could not enroll in this course");
        }
        const enrollData = await enrollRes.json();
        setEnrollment(enrollData);
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    if (params.courseId) {
      loadCourse();
    }
  }, [params.courseId, authFetch]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ paddingTop: "40px", paddingBottom: "40px" }}>
            <SkeletonClassroom />
          </div>
        </div>
      </>
    );
  }

  if (error) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)" }}>{error}</p>
        </div>
      </>
    );
  }

  return (
    <LearnContext.Provider
      value={{
        course,
        setCourse,
        enrollment,
        setEnrollment,
        getCachedChapter,
        setCachedChapter,
      }}
    >
      {children}
    </LearnContext.Provider>
  );
}
