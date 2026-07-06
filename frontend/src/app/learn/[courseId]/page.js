"use client";
import { useParams, useRouter } from "next/navigation";
import { useEffect } from "react";
import { useLearn } from "./layout";

function LearnRedirectPage() {
  const params = useParams();
  const router = useRouter();
  const { course, enrollment } = useLearn();

  useEffect(() => {
    if (!course || !enrollment) return;
    const chapters = [...(course.chapters || [])].sort((a, b) => a.order_index - b.order_index);
    const ch = chapters[enrollment.current_chapter_index] || chapters[0];
    if (ch) {
      router.replace(`/learn/${params.courseId}/${ch.id}`);
    } else {
      router.replace("/courses");
    }
  }, [course, enrollment, params.courseId, router]);

  return null;
}

export default LearnRedirectPage;
