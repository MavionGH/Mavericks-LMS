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
  const [chapterDetail, setChapterDetail] = useState(null);
  const [quizStatus, setQuizStatus] = useState({ attempted: false, passed: false, score: null });
  const [activeTab, setActiveTab] = useState("video");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

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
        // The course, the student's enrollment, the chapter detail and the quiz
        // status are independent reads — the chapter id is already in the URL —
        // so fire them together instead of in a serial waterfall. (Enrollment
        // may need a follow-up POST to auto-enroll; that is the only dependency.)
        const [courseRes, enrollGetRes, chRes, qRes] = await Promise.all([
          authFetch(`/api/courses/${params.courseId}`),
          authFetch(`/api/enrollment/course/${params.courseId}`),
          params.chapterId
            ? authFetch(`/api/courses/chapters/${params.chapterId}`)
            : Promise.resolve(null),
          params.chapterId
            ? authFetch(`/api/quiz/${params.chapterId}/my-status`)
            : Promise.resolve(null),
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

        const sorted = [...(courseData.chapters || [])].sort((a, b) => a.order_index - b.order_index);
        const active = sorted[enrollData.current_chapter_index];
        if (active && params.chapterId !== active.id) {
          router.replace(`/learn/${params.courseId}/${active.id}`);
          return;
        }

        if (chRes && chRes.ok) {
          setChapterDetail(await chRes.json());
        }
        if (qRes && qRes.ok) {
          setQuizStatus(await qRes.json());
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
          <p style={{ color: "var(--text-muted)" }}>Loading module...</p>
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
  const isDirectVideo = viewingChapter.youtube_url?.match(/\.(mp4|mov|webm|mkv)/i);
  const unlockedCount = currentIndex + 1;
  const progressPct = chapters.length ? Math.round((unlockedCount / chapters.length) * 100) : 0;

  const TAB_LABELS = {
    video: "Video Lecture",
    article: "Documentation",
    quiz: "Concept Check",
  };

  const allModulesComplete = chapters.length > 0 && enrollment?.status === "completed";

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

            {/* Course-wide final interview — optional, available any time, draws on
                the knowledge of every module in the course. */}
            <div style={{ padding: "16px", borderTop: "1px solid var(--border-muted)" }}>
              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px", fontFamily: "JetBrains Mono", fontWeight: "600" }}>FINAL AI INTERVIEW</div>
              <p style={{ fontSize: "12px", color: "var(--text-muted)", lineHeight: "1.5", marginBottom: "12px" }}>
                Optional. Mav, your AI interviewer, asks questions spanning all modules of this course. Take it whenever you&apos;re ready.
              </p>
              <Link href={`/interview/${params.courseId}`} className="btn btn-primary btn-sm" style={{ width: "100%", justifyContent: "center" }}>
                {allModulesComplete ? "Start Final Interview" : "Start AI Interview"}
              </Link>
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
              {["video", "article", "quiz"].map((tab) => (
                <div key={tab} className={`tab ${activeTab === tab ? "active" : ""}`} onClick={() => setActiveTab(tab)}>
                  {TAB_LABELS[tab]}
                  {tab === "quiz" && quizStatus.passed && (
                    <span style={{ marginLeft: "6px", color: "var(--color-success)", fontSize: "11px" }}>✓</span>
                  )}
                </div>
              ))}
            </div>

            {/* VIDEO TAB */}
            {activeTab === "video" && (
              <div>
                <div className="video-container" style={{ position: "relative", width: "100%", aspectRatio: "16/9", backgroundColor: "#000", borderRadius: "var(--radius-md)", overflow: "hidden" }}>
                  {isDirectVideo ? (
                    <video
                      src={viewingChapter.youtube_url}
                      controls
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : embedUrl ? (
                    <iframe
                      src={embedUrl}
                      title={viewingChapter.title}
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                      allowFullScreen
                      style={{ width: "100%", height: "100%", border: "none" }}
                    />
                  ) : (
                    <div className="video-placeholder" style={{ display: "grid", placeItems: "center", height: "100%", color: "var(--text-muted)" }}>
                      <span>No video file or YouTube URL configured for this module</span>
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

            {/* ARTICLE TAB */}
            {activeTab === "article" && (
              <div>
                <div className="article-content" dangerouslySetInnerHTML={{ __html: renderArticleHtml(chapterDetail?.article_content || "*Loading documentation...*") }} />
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

            {/* QUIZ TAB */}
            {activeTab === "quiz" && (
              <div>
                <div className="card" style={{ padding: "32px", backgroundColor: "#ffffff" }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", marginBottom: "8px" }}>Concept Check</h3>
                  <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "13.5px" }}>
                    Complete the quiz to verify your understanding of this module.
                    {isCurrentChapter && " Passing it unlocks the next module."}
                  </p>
                  {quizStatus.passed ? (
                    <div>
                      <div className="badge badge-success" style={{ marginBottom: "16px" }}>
                        ✓ Passed ({quizStatus.score}%){isCurrentChapter ? " — Module complete" : ""}
                      </div>
                      <br />
                      {isCurrentChapter && (
                        allModulesComplete ? (
                          <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>
                            You&apos;ve completed every module in this course. 🎉
                          </span>
                        ) : (
                          <Link href={`/learn/${params.courseId}`}>
                            <button className="btn btn-primary" style={{ marginTop: "12px" }}>Continue to next module</button>
                          </Link>
                        )
                      )}
                    </div>
                  ) : quizStatus.attempted ? (
                    <div>
                      <div className="badge badge-danger" style={{ marginBottom: "16px" }}>
                        Score: {quizStatus.score}% — Retake to advance
                      </div>
                      <br />
                      {isCurrentChapter && (
                        <Link href={`/quiz/${params.courseId}/${viewingChapter.id}`}>
                          <button className="btn btn-primary" style={{ marginTop: "12px" }}>Retake Quiz</button>
                        </Link>
                      )}
                    </div>
                  ) : isCurrentChapter ? (
                    videoWatched && articleRead ? (
                      <Link href={`/quiz/${params.courseId}/${viewingChapter.id}`}>
                        <button className="btn btn-primary">Start Concept Check</button>
                      </Link>
                    ) : (
                      <button className="btn btn-primary" disabled>
                        Complete video and article first
                      </button>
                    )
                  ) : (
                    <button className="btn btn-secondary" disabled>Not your current module</button>
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