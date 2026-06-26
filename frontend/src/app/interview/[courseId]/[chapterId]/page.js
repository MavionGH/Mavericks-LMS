"use client";
import { useParams } from "next/navigation";
import { useCallback } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import InterviewRoom from "@/components/InterviewRoom";

// Per-module oral assessment (legacy path). Module progression is now driven by
// the quiz, so this is retained for backward compatibility / direct links only.
function ChapterInterviewPage() {
  const params = useParams();
  const { authFetch } = useAuth();

  const doStart = useCallback(async () => {
    // `/start` already enforces eligibility (enrollment) server-side and returns
    // a descriptive error, so we skip the separate eligibility round-trip.
    const res = await authFetch("/api/interview/start", {
      method: "POST",
      body: JSON.stringify({ chapter_id: params.chapterId }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Failed to start interview");
    }
    return res.json();
  }, [authFetch, params.chapterId]);

  return (
    <InterviewRoom
      doStart={doStart}
      heading="Module Oral Assessment"
      panelLabel="Module Host"
      backHref={`/learn/${params.courseId}/${params.chapterId}`}
      reviewHref={`/learn/${params.courseId}/${params.chapterId}`}
      continueHref={`/learn/${params.courseId}`}
      continueLabel="Continue to next module"
      isCourse={false}
    />
  );
}

export default withAuth(ChapterInterviewPage);
