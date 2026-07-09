"use client";
import Navbar from "@/components/Navbar";
import Skeleton, { SkeletonClassroom } from "@/components/Skeleton";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useState, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { getYouTubeEmbedUrl, renderArticleHtml } from "@/lib/courseUtils";
import { useLearn } from "../layout";

function LearnPage() {
  const params = useParams();
  const router = useRouter();
  const { authFetch } = useAuth();

  const { course, setCourse, enrollment, setEnrollment, getCachedChapter, setCachedChapter } = useLearn();

  const [chapterDetail, setChapterDetail] = useState(null);
  const [quizStatus, setQuizStatus] = useState({ attempted: false, passed: false, score: null });
  const [activeTab, setActiveTab] = useState("video");
  const [chapterLoading, setChapterLoading] = useState(false); // lightweight per-chapter inline loader

  const [syllabusExpanded, setSyllabusExpanded] = useState(false);

  const [hasPlayedVideo, setHasPlayedVideo] = useState(false);
  const [videoPlayError, setVideoPlayError] = useState("");
  const [videoSaving, setVideoSaving] = useState(false);
  const [videoSuccessMsg, setVideoSuccessMsg] = useState("");
  const [articleSaving, setArticleSaving] = useState(false);
  const [articleSuccessMsg, setArticleSuccessMsg] = useState("");

  const [isPlaying, setIsPlaying] = useState(false);
  const [ytCurrentTime, setYtCurrentTime] = useState(0);
  const [ytDuration, setYtDuration] = useState(0);
  const [ytVolume, setYtVolume] = useState(100);
  const [ytMuted, setYtMuted] = useState(false);
  const videoRef = useRef(null);
  const iframeRef = useRef(null);

  useEffect(() => {
    // Reset play detection state when the chapter changes
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setHasPlayedVideo(false);
    setVideoPlayError("");
  }, [params.chapterId]);

  useEffect(() => {
    const handleMessage = (event) => {
      if (!event.origin.includes("youtube.com")) return;
      
      try {
        const data = typeof event.data === "string" ? JSON.parse(event.data) : event.data;
        
        if (data.event === "onStateChange") {
          if (data.info === 1) {
            setHasPlayedVideo(true);
            setIsPlaying(true);
          } else if (data.info === 2 || data.info === 0 || data.info === -1) {
            setIsPlaying(false);
          }
        }
        
        if (data.event === "infoDelivery" && data.info) {
          if (data.info.currentTime !== undefined) {
            setYtCurrentTime(data.info.currentTime);
          }
          if (data.info.duration !== undefined) {
            setYtDuration(data.info.duration);
          }
          if (data.info.volume !== undefined) {
            setYtVolume(data.info.volume);
          }
          if (data.info.muted !== undefined) {
            setYtMuted(data.info.muted);
          }
        }
      } catch (e) { }
    };

    const handleBlur = () => {
      setTimeout(() => {
        if (document.activeElement && document.activeElement.tagName === "IFRAME") {
          setHasPlayedVideo(true);
        }
      }, 150);
    };

    window.addEventListener("message", handleMessage);
    window.addEventListener("blur", handleBlur);

    return () => {
      window.removeEventListener("message", handleMessage);
      window.removeEventListener("blur", handleBlur);
    };
  }, []);

  // Sync state with cached data asynchronously when chapterId changes
  useEffect(() => {
    const cached = getCachedChapter(params.chapterId);
    if (cached) {
      const timer = setTimeout(() => {
        setChapterDetail(cached.detail);
        setQuizStatus(cached.quiz);
      }, 0);
      return () => clearTimeout(timer);
    } else {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setChapterDetail(null);
      setQuizStatus({ attempted: false, passed: false, score: null });
    }
  }, [params.chapterId, getCachedChapter]);

  // ── Effect: Load chapter detail + quiz status (per chapterId) ───────────────
  // Uses a lightweight inline loader so the sidebar never flickers or disappears.
  // Results are cached — switching back to a visited module is instant.
  useEffect(() => {
    if (!params.chapterId) return;

    // If already cached, our sync effect handles it
    if (getCachedChapter(params.chapterId)) {
      return;
    }

    async function loadChapter() {
      setChapterLoading(true);
      try {
        const [chRes, qRes] = await Promise.all([
          authFetch(`/api/courses/chapters/${params.chapterId}`),
          authFetch(`/api/quiz/${params.chapterId}/my-status`),
        ]);

        const detail = chRes.ok ? await chRes.json() : null;
        const quiz = qRes.ok ? await qRes.json() : { attempted: false, passed: false, score: null };

        // Store in cache
        setCachedChapter(params.chapterId, detail, quiz);

        setChapterDetail(detail);
        setQuizStatus(quiz);
      } catch (err) {
        console.error("Chapter load error:", err);
      } finally {
        setChapterLoading(false);
      }
    }
    loadChapter();
  }, [params.chapterId, authFetch, getCachedChapter, setCachedChapter]);

  // Derived values (safe to compute here since course/enrollment are stable after layout load)
  const chapters = useMemo(() => {
    return course?.chapters?.sort((a, b) => a.order_index - b.order_index) || [];
  }, [course]);

  const currentIndex = enrollment?.current_chapter_index ?? 0;
  const currentChapter = chapters[currentIndex];
  const viewingChapter = chapters.find((c) => c.id === params.chapterId) || currentChapter;

  // Guard: Redirect to active chapter if attempting to view a locked chapter
  useEffect(() => {
    if (!course || !enrollment) return;
    const active = chapters[currentIndex];
    const requestedIndex = chapters.findIndex((c) => c.id === params.chapterId);
    if (active && (requestedIndex === -1 || requestedIndex > currentIndex)) {
      router.replace(`/learn/${params.courseId}/${active.id}`);
    }
  }, [course, enrollment, currentIndex, chapters, params.chapterId, params.courseId, router]);

  const isCurrentChapter = viewingChapter?.id === currentChapter?.id;
  const videoWatched = isCurrentChapter && enrollment?.video_watched;
  const articleRead = isCurrentChapter && enrollment?.article_read;

  const markVideoWatched = async () => {
    if (!enrollment) return;
    if (!hasPlayedVideo) {
      setVideoPlayError("Watch the video first");
      setTimeout(() => {
        setVideoPlayError("");
      }, 3000);
      return;
    }
    setVideoPlayError("");
    setVideoSaving(true);
    try {
      const res = await authFetch(`/api/enrollment/progress/${enrollment.id}/video-watched`, { method: "PUT" });
      if (res.ok) {
        setEnrollment((e) => ({ ...e, video_watched: true }));
        setVideoSuccessMsg("Saved successfully!");
        setTimeout(() => setVideoSuccessMsg(""), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setVideoSaving(false);
    }
  };

  const markArticleRead = async () => {
    if (!enrollment) return;
    setArticleSaving(true);
    try {
      const res = await authFetch(`/api/enrollment/progress/${enrollment.id}/article-read`, { method: "PUT" });
      if (res.ok) {
        setEnrollment((e) => ({ ...e, article_read: true }));
        setArticleSuccessMsg("Saved successfully!");
        setTimeout(() => setArticleSuccessMsg(""), 3000);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setArticleSaving(false);
    }
  };

  if (!viewingChapter) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ padding: "80px 32px", textAlign: "center" }}>
          <p style={{ color: "var(--color-danger)" }}>Module not found</p>
          <Link href="/courses" className="btn btn-primary" style={{ marginTop: "16px" }}>Browse courses</Link>
        </div>
      </>
    );
  }

  const embedUrl = getYouTubeEmbedUrl(viewingChapter.youtube_url);
  const isDirectVideo = viewingChapter.youtube_url?.match(/\.(mp4|mov|webm|mkv)/i);

  const handleTogglePlay = () => {
    if (isDirectVideo && videoRef.current) {
      if (videoRef.current.paused) {
        videoRef.current.play();
      } else {
        videoRef.current.pause();
      }
    } else if (iframeRef.current && iframeRef.current.contentWindow) {
      const command = isPlaying ? "pauseVideo" : "playVideo";
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: command, args: [] }),
        "*"
      );
      setIsPlaying(!isPlaying);
    }
  };

  const handleRewind10 = () => {
    if (isDirectVideo && videoRef.current) {
      videoRef.current.currentTime = Math.max(0, videoRef.current.currentTime - 10);
    } else if (iframeRef.current && iframeRef.current.contentWindow) {
      const targetTime = Math.max(0, ytCurrentTime - 10);
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [targetTime, true] }),
        "*"
      );
      setYtCurrentTime(targetTime);
    }
  };

  const handleForward10 = () => {
    if (isDirectVideo && videoRef.current) {
      videoRef.current.currentTime = Math.min(videoRef.current.duration || 0, videoRef.current.currentTime + 10);
    } else if (iframeRef.current && iframeRef.current.contentWindow) {
      const targetTime = Math.min(ytDuration || 9999, ytCurrentTime + 10);
      iframeRef.current.contentWindow.postMessage(
        JSON.stringify({ event: "command", func: "seekTo", args: [targetTime, true] }),
        "*"
      );
      setYtCurrentTime(targetTime);
    }
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (activeTab !== "video") return;

      // Ignore if user is typing in inputs or editing content
      if (
        document.activeElement &&
        (document.activeElement.tagName === "INPUT" ||
          document.activeElement.tagName === "TEXTAREA" ||
          document.activeElement.isContentEditable)
      ) {
        return;
      }

      if (e.key === " ") {
        e.preventDefault();
        handleTogglePlay();
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        handleForward10();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        handleRewind10();
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        if (isDirectVideo && videoRef.current) {
          videoRef.current.volume = Math.min(1, videoRef.current.volume + 0.1);
        } else if (iframeRef.current && iframeRef.current.contentWindow) {
          const targetVolume = Math.min(100, ytVolume + 10);
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({ event: "command", func: "setVolume", args: [targetVolume] }),
            "*"
          );
          setYtVolume(targetVolume);
        }
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        if (isDirectVideo && videoRef.current) {
          videoRef.current.volume = Math.max(0, videoRef.current.volume - 0.1);
        } else if (iframeRef.current && iframeRef.current.contentWindow) {
          const targetVolume = Math.max(0, ytVolume - 10);
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({ event: "command", func: "setVolume", args: [targetVolume] }),
            "*"
          );
          setYtVolume(targetVolume);
        }
      } else if (e.key.toLowerCase() === "m") {
        e.preventDefault();
        if (isDirectVideo && videoRef.current) {
          videoRef.current.muted = !videoRef.current.muted;
        } else if (iframeRef.current && iframeRef.current.contentWindow) {
          const command = ytMuted ? "unMute" : "mute";
          iframeRef.current.contentWindow.postMessage(
            JSON.stringify({ event: "command", func: command, args: [] }),
            "*"
          );
          setYtMuted(!ytMuted);
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [activeTab, isDirectVideo, isPlaying, ytCurrentTime, ytDuration, ytVolume, ytMuted]);
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
          {/* Mobile sub-header bar (sticky just below navbar) */}
          <div className="classroom-mobile-bar">
            <button
              type="button"
              className="classroom-syllabus-toggle"
              onClick={() => setSyllabusExpanded(true)}
              aria-label="Open Course Syllabus"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "6px" }}>
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
              Syllabus
            </button>
            <span className="classroom-mobile-progress">
              {currentIndex + 1} / {chapters.length} Modules
            </span>
          </div>

          {syllabusExpanded && (
            <div
              className="sidebar-backdrop"
              onClick={() => setSyllabusExpanded(false)}
            />
          )}

          <aside className={`sidebar ${syllabusExpanded ? "expanded" : ""}`}>
            {/* Sidebar Mobile Header */}
            <div className="sidebar-header-mobile">
              <span className="sidebar-title-mobile">Course Syllabus</span>

            </div>

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
                Mav, your AI interviewer, asks questions spanning all modules of this course. Take it whenever you&apos;re ready.
              </p>
              <Link href={`/interview/${params.courseId}`} className="btn btn-primary btn-sm" style={{ width: "100%", justifyContent: "center" }}>
                {allModulesComplete ? "Start Final Interview" : "Start AI Interview"}
              </Link>
            </div>
          </aside>

          <main className="content-area">
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>
              MODULE {String((viewingChapter.order_index ?? 0) + 1).padStart(2, "0")}
            </span>
            <h1 style={{ fontSize: "32px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
              {viewingChapter.title}
            </h1>

            {!isCurrentChapter && enrollment?.status === "enrolled" && (
              <div className="card" style={{ padding: "16px", marginBottom: "24px", backgroundColor: "var(--bg-warning)", border: "1px solid var(--color-warning)" }}>
                <p style={{ fontSize: "13px", color: "var(--text-main)" }}>
                  This is a previously completed module. Your active module is <strong>{currentChapter?.title}</strong>.
                </p>
              </div>
            )}

            {enrollment?.status === "completed" && (
              <div className="card" style={{ padding: "16px", marginBottom: "24px", backgroundColor: "var(--bg-success)", border: "1px solid var(--color-success)" }}>
                <p style={{ fontSize: "13px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                  <span style={{ fontSize: "16px" }}>🎉</span>
                  <span>You have completed this course! You can review any module at any time.</span>
                </p>
              </div>
            )}

            {enrollment?.status === "capstone_ready" && (
              <div className="card" style={{ padding: "16px", marginBottom: "24px", backgroundColor: "var(--brand-muted)", border: "1px solid var(--brand-border)" }}>
                <p style={{ fontSize: "13px", color: "var(--text-main)", display: "flex", alignItems: "center", gap: "8px", margin: 0 }}>
                  <span style={{ fontSize: "16px" }}>🏆</span>
                  <span>You have completed all modules! You are ready for the <strong>Final AI Interview</strong>. Go back to the Course page to start.</span>
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
                      ref={videoRef}
                      src={viewingChapter.youtube_url}
                      controls
                      onPlay={() => {
                        setHasPlayedVideo(true);
                        setIsPlaying(true);
                      }}
                      onPause={() => setIsPlaying(false)}
                      onEnded={() => setIsPlaying(false)}
                      style={{ width: "100%", height: "100%", objectFit: "contain" }}
                    />
                  ) : embedUrl ? (
                    <iframe
                      ref={iframeRef}
                      id="youtube-player"
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

                {(isDirectVideo || embedUrl) && (
                  <>
                    {/* Custom Video Controls Bar */}
                    <div style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: "16px",
                      marginTop: "12px",
                      padding: "10px 16px",
                      backgroundColor: "var(--bg-card, #1e1e24)",
                      border: "1px solid var(--border-muted, #2e2e38)",
                      borderRadius: "var(--radius-sm, 8px)",
                      color: "var(--text-main, #f5f5f7)"
                    }}>
                      <button
                        className="btn btn-secondary"
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px" }}
                        onClick={handleRewind10}
                        title="Rewind 10 seconds (Left Arrow)"
                      >
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M2.5 2v6h6M2.66 15.57a10 10 0 1 0-.57-8.38l.57 1.31" />
                        </svg>
                        <span>-10s</span>
                      </button>

                      <button
                        className="btn btn-primary"
                        style={{ display: "flex", alignItems: "center", justifyContent: "center", width: "40px", height: "40px", borderRadius: "50%", padding: 0 }}
                        onClick={handleTogglePlay}
                        title="Play/Pause (Space)"
                      >
                        {isPlaying ? (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                            <rect x="6" y="4" width="4" height="16" rx="1" />
                            <rect x="14" y="4" width="4" height="16" rx="1" />
                          </svg>
                        ) : (
                          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2" style={{ marginLeft: "2px" }}>
                            <polygon points="5 3 19 12 5 21 5 3" />
                          </svg>
                        )}
                      </button>

                      <button
                        className="btn btn-secondary"
                        style={{ display: "flex", alignItems: "center", gap: "6px", padding: "8px 12px" }}
                        onClick={handleForward10}
                        title="Forward 10 seconds (Right Arrow)"
                      >
                        <span>+10s</span>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <path d="M21.5 2v6h-6M21.34 15.57a10 10 0 1 1 .57-8.38l-.57 1.31" />
                        </svg>
                      </button>
                    </div>

                    {/* Keyboard shortcut helper */}
                    <div style={{
                      display: "flex",
                      justifyContent: "center",
                      gap: "12px",
                      marginTop: "8px",
                      fontSize: "11px",
                      color: "var(--text-muted, #86868b)",
                      fontFamily: "JetBrains Mono, monospace"
                    }}>
                      <span>Space: Play/Pause</span>
                      <span>•</span>
                      <span>← / →: Seek 10s</span>
                      <span>•</span>
                      <span>↑ / ↓: Volume</span>
                      <span>•</span>
                      <span>M: Mute</span>
                    </div>
                  </>
                )}
                {isCurrentChapter && (
                  !videoWatched ? (
                    <div style={{ marginTop: "16px" }}>
                      <button
                        className="btn btn-secondary"
                        onClick={markVideoWatched}
                        disabled={videoSaving}
                      >
                        {videoSaving ? "Saving..." : "Mark video as watched"}
                      </button>
                      {videoPlayError && (
                        <p style={{ color: "var(--color-danger)", fontSize: "13px", marginTop: "8px", fontWeight: "600" }}>
                          ⚠️ {videoPlayError}
                        </p>
                      )}
                      {videoSuccessMsg && (
                        <p style={{ color: "var(--color-success)", fontSize: "13px", marginTop: "8px", fontWeight: "600" }}>
                          ✓ {videoSuccessMsg}
                        </p>
                      )}
                    </div>
                  ) : (
                    <div className="badge badge-success" style={{ marginTop: "16px" }}>✓ Video completed</div>
                  )
                )}
              </div>
            )}

            {/* ARTICLE TAB */}
            {activeTab === "article" && (
              <div>
                {chapterLoading ? (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px", paddingTop: "8px" }}>
                    <Skeleton variant="text" width="40%" height={20} />
                    <Skeleton variant="text" width="100%" height={14} />
                    <Skeleton variant="text" width="95%" height={14} />
                    <Skeleton variant="text" width="88%" height={14} />
                    <Skeleton variant="text" width="70%" height={14} style={{ marginTop: "12px" }} />
                    <Skeleton variant="text" width="100%" height={14} />
                    <Skeleton variant="text" width="80%" height={14} />
                    <Skeleton variant="rectangular" height={120} style={{ marginTop: "16px" }} />
                  </div>
                ) : (
                  <div className="article-content" dangerouslySetInnerHTML={{ __html: renderArticleHtml(chapterDetail?.article_content || "") }} />
                )}
                {isCurrentChapter && (
                  <div style={{ marginTop: "24px" }}>
                    {!articleRead ? (
                      <div>
                        <button
                          className="btn btn-secondary"
                          onClick={markArticleRead}
                          disabled={articleSaving || chapterLoading}
                        >
                          {articleSaving ? "Saving..." : "Complete documentation"}
                        </button>
                        {articleSuccessMsg && (
                          <p style={{ color: "var(--color-success)", fontSize: "13px", marginTop: "8px", fontWeight: "600" }}>
                            ✓ {articleSuccessMsg}
                          </p>
                        )}
                      </div>
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
                {chapterLoading ? (
                  <div className="card" style={{ padding: "32px", display: "flex", flexDirection: "column", gap: "12px" }}>
                    <Skeleton variant="text" width="30%" height={18} />
                    <Skeleton variant="text" width="70%" height={14} />
                    <Skeleton variant="rectangular" width="160px" height={40} borderRadius="4px" style={{ marginTop: "8px" }} />
                  </div>
                ) : (
                  <div className="card" style={{ padding: "32px", backgroundColor: "var(--bg-surface)" }}>
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
                    )}</div>
                )}
              </div>
            )}

          </main>
        </div>
      </div>
    </>
  );
}

export default withAuth(LearnPage);