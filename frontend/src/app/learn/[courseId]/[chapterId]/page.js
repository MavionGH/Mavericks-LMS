"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { getYouTubeEmbedUrl, renderArticleHtml } from "@/lib/courseUtils";

function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const { authFetch } = useAuth();

  const [course, setCourse] = useState(null);
  const [enrollment, setEnrollment] = useState(null);
  const [activeTab, setActiveTab] = useState("video");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quizPassed, setQuizPassed] = useState(false);
  const [quizScore, setQuizScore] = useState(null);

  const chapters = course?.chapters?.sort((a, b) => a.order_index - b.order_index) || [];
  const currentIndex = enrollment?.current_chapter_index ?? 0;
  const currentChapter = chapters[currentIndex];
  const viewingChapter = chapters.find((c) => c.id === params.chapterId) || currentChapter;

  const isCurrentChapter = viewingChapter?.id === currentChapter?.id;
  const videoWatched = isCurrentChapter && enrollment?.video_watched;
  const articleRead = isCurrentChapter && enrollment?.article_read;

  useEffect(() => {
    async function load() {
      setLoading(true);
      try {
        const courseRes = await authFetch(`/api/courses/${params.courseId}`);
        if (!courseRes.ok) throw new Error("Course not found");
        const courseData = await courseRes.json();
        setCourse(courseData);

        let enrollRes = await authFetch(`/api/enrollment/course/${params.courseId}`);
        if (enrollRes.status === 404) {
          enrollRes = await authFetch("/api/enrollment/enroll", {
            method: "POST",
            body: JSON.stringify({ course_id: params.courseId }),
          });
        }
        if (!enrollRes.ok) throw new Error("Could not enroll");
        const enrollData = await enrollRes.json();
        setEnrollment(enrollData);

        const sorted = [...(courseData.chapters || [])].sort((a, b) => a.order_index - b.order_index);
        const active = sorted[enrollData.current_chapter_index];
        if (active && params.chapterId !== active.id) {
          router.replace(`/learn/${params.courseId}/${active.id}`);
        }

        // Check quiz status for the active chapter
        const chapterToCheck = params.chapterId || (active && active.id);
        if (chapterToCheck) {
          try {
            const quizRes = await authFetch(`/api/quiz/${chapterToCheck}/status`);
            if (quizRes.ok) {
              const quizData = await quizRes.json();
              setQuizPassed(quizData.passed);
              setQuizScore(quizData.best_score);
            }
          } catch {
            // Quiz status check failed — not critical
          }
        }
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [params.courseId, params.chapterId, authFetch, router]);

  const markVideoWatched = async () => {
    if (!enrollment) return;
    const res = await authFetch(`/api/enrollment/progress/${enrollment.id}/video-watched`, { method: "PUT" });
    if (res.ok) setEnrollment((e) => ({ ...e, video_watched: true }));
  };

  const markArticleRead = async () => {
    if (!enrollment) return;
    const res = await authFetch(`/api/enrollment/progress/${enrollment.id}/article-read`, { method: "PUT" });
    if (res.ok) setEnrollment((e) => ({ ...e, article_read: true }));
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--text-muted)" }}>Loading module…</p>
        </div>
      </>
    );
  }

  if (error || !viewingChapter) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)" }}>{error || "Module not found"}</p>
          <Link href="/courses" className="btn btn-primary" style={{ marginTop: "16px" }}>Browse courses</Link>
        </div>
      </>
    );
  }

  const embedUrl = getYouTubeEmbedUrl(viewingChapter.youtube_url);
  const unlockedCount = currentIndex + 1;
  const progressPct = chapters.length ? Math.round((unlockedCount / chapters.length) * 100) : 0;

  const tabConfig = [
    { key: "video", label: "Video Lecture" },
    { key: "article", label: "Documentation" },
    { key: "quiz", label: "Concept Check" },
    { key: "interview", label: "AI Oral Assessment" },
  ];

  return (
    <>
      <Navbar />
      <div className="page-container">
        <div className="layout-with-sidebar">
          <aside className="sidebar">
            <div className="sidebar-title">{course?.title || "Course"}</div>
            {chapters.map((ch, i) => {
              const unlocked = i <= currentIndex;
              const completed = i < currentIndex;
              const active = ch.id === viewingChapter.id;
              return (
                <Link
                  key={ch.id}
                  href={unlocked ? `/learn/${params.courseId}/${ch.id}` : "#"}
                  className={`sidebar-item ${active ? "active" : ""} ${!unlocked ? "locked" : ""}`}
                  style={{ textDecoration: "none", cursor: unlocked ? "pointer" : "not-allowed" }}
                  onClick={(e) => !unlocked && e.preventDefault()}
                >
                  <span className="mono" style={{ fontSize: "11px" }}>{String(i + 1).padStart(2, "0")}</span>
                  <span style={{ flex: 1 }}>{ch.title}</span>
                  <div className={`status-dot ${completed ? "completed" : active ? "current" : "locked"}`} />
                </Link>
              );
            })}
            <div style={{ padding: "16px", marginTop: "16px", borderTop: "1px solid var(--border-muted)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "JetBrains Mono", fontWeight: "600" }}>MODULE COMPLETION</div>
              <div className="progress-bar-container">
                <div className="progress-bar-fill" style={{ width: `${progressPct}%` }} />
              </div>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px", fontFamily: "JetBrains Mono" }}>
                {unlockedCount} / {chapters.length} UNLOCKED
              </div>
            </div>
          </aside>

          <main className="content-area" style={{ padding: "40px 48px", maxWidth: "900px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>
              MODULE {String((viewingChapter.order_index ?? 0) + 1).padStart(2, "0")}
            </span>
            <h1 style={{ fontSize: "32px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
              {viewingChapter.title}
            </h1>

            {!isCurrentChapter && (
              <div className="card" style={{ padding: "16px", marginBottom: "24px", backgroundColor: "#fff8f0", border: "1px solid var(--color-warning)" }}>
                <p style={{ fontSize: "13px", color: "var(--text-main)" }}>
                  This is a previously completed module. Your active module is <strong>{currentChapter?.title}</strong>.
                </p>
              </div>
            )}

            <div className="tabs">
              {tabConfig.map(({ key, label }) => (
                <div key={key} className={`tab ${activeTab === key ? "active" : ""}`} onClick={() => setActiveTab(key)}>
                  {label}
                </div>
              ))}
            </div>

            {activeTab === "video" && (
              <div>
                <div className="video-container">
                  {embedUrl ? (
                    <iframe
                      src={embedUrl}
                      title={viewingChapter.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ width: "100%", height: "100%", border: "none", borderRadius: "var(--radius-md)" }}
                    />
                  ) : (
                    <div className="video-placeholder">
                      <span>No YouTube URL configured for this module</span>
                    </div>
                  )}
                </div>
                {isCurrentChapter && (
                  !videoWatched ? (
                    <button className="btn btn-secondary" onClick={markVideoWatched} style={{ marginTop: "16px" }}>
                      Mark video as watched
                    </button>
                  ) : (
                    <div className="badge badge-success" style={{ marginTop: "16px" }}>✓ Video completed</div>
                  )
                )}
              </div>
            )}

            {activeTab === "article" && (
              <div>
                <div className="article-content" dangerouslySetInnerHTML={{ __html: renderArticleHtml(viewingChapter.article_content) }} />
                {isCurrentChapter && (
                  <div style={{ marginTop: "24px" }}>
                    {!articleRead ? (
                      <button className="btn btn-secondary" onClick={markArticleRead}>Complete documentation</button>
                    ) : (
                      <div className="badge badge-success">✓ Documentation completed</div>
                    )}
                  </div>
                )}
              </div>
            )}

            {activeTab === "quiz" && (
              <div>
                <div className="card" style={{ padding: "32px", backgroundColor: "#ffffff" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>Concept Check Quiz</h3>
                  <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "13.5px" }}>
                    Test your understanding of this module with a 5-question multiple-choice quiz.
                    You need to pass the quiz before you can take the AI oral assessment.
                    You can retake the quiz as many times as needed.
                  </p>

                  {quizPassed && (
                    <div className="badge badge-success" style={{ marginBottom: "16px" }}>
                      ✓ Quiz passed{quizScore !== null ? ` (Best: ${quizScore}%)` : ""}
                    </div>
                  )}

                  {isCurrentChapter ? (
                    videoWatched && articleRead ? (
                      <Link href={`/quiz/${params.courseId}/${viewingChapter.id}`}>
                        <button className="btn btn-primary">
                          {quizPassed ? "Retake Quiz" : "Start Quiz"}
                        </button>
                      </Link>
                    ) : (
                      <button className="btn btn-primary" disabled>
                        Complete video and article first
                      </button>
                    )
                  ) : (
                    <button className="btn btn-secondary" disabled>Quiz already completed for this module</button>
                  )}
                </div>
              </div>
            )}

            {activeTab === "interview" && (
              <div>
                <div className="card" style={{ padding: "32px", backgroundColor: "#ffffff" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>AI Voice Assessment</h3>
                  <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "13.5px" }}>
                    After watching the video, reading the article, and passing the quiz, join a Google Meet-style oral interview.
                    The AI has full context of your module content and will ask follow-up questions,
                    score your technical knowledge, communication, and confidence (including pause patterns).
                    Pass to unlock the next module — fail and you must re-study this module.
                  </p>
                  {isCurrentChapter ? (
                    videoWatched && articleRead && quizPassed ? (
                      <Link href={`/interview/${params.courseId}/${viewingChapter.id}`}>
                        <button className="btn btn-primary">Start AI oral assessment</button>
                      </Link>
                    ) : (
                      <div>
                        <button className="btn btn-primary" disabled>
                          {!videoWatched || !articleRead
                            ? "Complete video and article first"
                            : "Pass the quiz first"}
                        </button>
                        {videoWatched && articleRead && !quizPassed && (
                          <p style={{ color: "var(--text-muted)", fontSize: "12px", marginTop: "8px" }}>
                            You must pass the concept check quiz before starting the oral assessment.
                          </p>
                        )}
                      </div>
                    )
                  ) : (
                    <button className="btn btn-secondary" disabled>Assessment already completed for this module</button>
                  )}
                </div>
              </div>
            )}
          </main>
        </div>
      </div>
    </>
  );
}

export default withAuth(LearnPage);
