"use client";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import InterviewRoom from "@/components/InterviewRoom";

// Course-wide final AI interview. Optional and available at any time. Mav (the
// AI interviewer) draws on the knowledge of EVERY module in the course — all the
// embedded video transcripts and articles — to ask fresh, unscripted questions.
function CourseInterviewPage() {
  const params = useParams();
  const { authFetch } = useAuth();

  const doStart = useCallback(async () => {
    // `/course/start` already enforces eligibility (enrollment) server-side and
    // returns a descriptive error, so we skip the separate eligibility round-trip.
    const res = await authFetch("/api/interview/course/start", {
      method: "POST",
      body: JSON.stringify({ course_id: params.courseId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to start interview");
    }
    return res.json();
  }, [authFetch, params.courseId]);

  return (
    <InterviewRoom
      doStart={doStart}
      heading="Course Final Interview"
      panelLabel="Course Host"
      backHref={`/learn/${params.courseId}`}
      reviewHref={`/learn/${params.courseId}`}
      continueHref={`/learn/${params.courseId}`}
      continueLabel="Back to course"
      isCourse={true}
    />
  );
}

export default withAuth(CourseInterviewPage);
