"use client";
import Navbar from "@/components/Navbar";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";

// Player for interview recordings. Files produced by the browser's MediaRecorder
// are streamed without a duration in their header, so a plain <video> reports
// duration = Infinity and its scrub bar can't seek. On metadata load we force the
// browser to read to the end (seek to a huge time), which makes it compute the real
// duration; after that the timeline is fully seekable. Runs once per recording.
function RecordingPlayer({ src }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);

  const handleLoadedMetadata = () => {
    const v = ref.current;
    if (!v || fixedRef.current) return;
    if (v.duration === Infinity || Number.isNaN(v.duration)) {
      fixedRef.current = true;
      const onUpdate = () => {
        v.removeEventListener("timeupdate", onUpdate);
        v.currentTime = 0; // snap back to the start now that duration is known
      };
      v.addEventListener("timeupdate", onUpdate);
      v.currentTime = 1e101; // jump past the end → browser resolves the duration
    }
  };

  return (
    <video
      ref={ref}
      src={src}
      controls
      preload="metadata"
      onLoadedMetadata={handleLoadedMetadata}
      style={{ width: "100%", borderRadius: "var(--radius-sm)", backgroundColor: "#000", maxHeight: 240 }}
    />
  );
}

// Small inline spinner shown next to the per-stage transcription status text.
function StageSpinner() {
  return (
    <span
      style={{
        width: 11,
        height: 11,
        border: "2px solid currentColor",
        borderTopColor: "transparent",
        borderRadius: "50%",
        display: "inline-block",
        marginRight: 6,
        verticalAlign: "-1px",
        animation: "spin 0.7s linear infinite",
      }}
    />
  );
}

function TeacherPanel() {
  const { user, token, authFetch, refreshUser } = useAuth();
  const [checkingApproval, setCheckingApproval] = useState(false);
  const [approvalMsg, setApprovalMsg] = useState("");
  const [activeTab, setActiveTab] = useState("overview");
  const [form, setForm] = useState({ title: "", description: "", pass_threshold: 70, thumbnail: "" });
  const [formStatus, setFormStatus] = useState("");
  const [courses, setCourses] = useState([]);
  const [selectedCourseId, setSelectedCourseId] = useState("");
  const [chapterForm, setChapterForm] = useState({
    title: "",
    article_content: "",
    youtube_url: "",
    video_transcript: "",
  });
  const [chapterStatus, setChapterStatus] = useState("");

  // Video upload state
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadError, setUploadError] = useState("");

  // Article document import state (txt / md / pdf / docx → article text)
  const [articleUploading, setArticleUploading] = useState(false);
  const [articleFileName, setArticleFileName] = useState("");
  const [articleError, setArticleError] = useState("");

  // Student interview recordings (screen + voice, stored in R2)
  const [recordings, setRecordings] = useState([]);
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");

  // Student enrollment/recordings list
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Transcript generation state
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState(""); // "uploading" | "extracting" | "transcribing" | "done"
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeError, setTranscribeError] = useState("");
  const videoFileRef = useRef(null); // holds the raw File object for transcription

  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Store for later transcription
    videoFileRef.current = file;
    // Reset transcription state when a new file is picked
    setTranscribeStage("");
    setTranscribeError("");
    setTranscribeProgress(0);
    setTranscribing(false);
    const allowedExtensions = ["mp4", "mov", "webm", "mkv"];
    const fileExtension = file.name.split(".").pop().toLowerCase();
    if (!allowedExtensions.includes(fileExtension)) {
      setUploadError("Invalid file format. Allowed formats: mp4, mov, webm, mkv.");
      return;
    }

    if (file.size > 100 * 1024 * 1024) {
      setUploadError("File is too large. Maximum size allowed is 100MB.");
      return;
    }

    setUploadError("");
    setUploading(true);
    setUploadProgress(0);
    setUploadedFileName(file.name);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "http://localhost:8000/api/courses/upload-video", true);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
        // Bytes are uploaded — the server is now transcribing before it responds.
        if (percentComplete >= 100) {
          setTranscribing(true);
        }
      }
    };

    xhr.onload = () => {
      setUploading(false);
      setTranscribing(false);
      if (xhr.status === 200) {
        try {
          const res = JSON.parse(xhr.responseText);
          setChapterForm((prev) => ({
            ...prev,
            youtube_url: res.video_url,
            // Auto-fill the transcript box from the video's audio. Keep any
            // text the teacher already typed if transcription returned nothing.
            video_transcript: res.transcript ? res.transcript : prev.video_transcript,
          }));
          setUploadProgress(100);
        } catch (e) {
          setUploadError("Failed to parse upload response.");
        }
      } else {
        try {
          const res = JSON.parse(xhr.responseText);
          setUploadError(res.detail || "Upload failed.");
        } catch (e) {
          setUploadError(`Upload failed with status code ${xhr.status}`);
        }
      }
    };

    xhr.onerror = () => {
      setUploading(false);
      setTranscribing(false);
      setUploadError("Network error during file upload.");
    };

    xhr.send(formData);
  };

  // Manually (re)generate the transcript for the already-selected video file.
  // Drives the staged "Auto-generate transcript" panel: uploads the stored file
  // to the same /upload-video endpoint (which extracts audio + runs Whisper
  // server-side) and fills the transcript box from the response. Safe to run
  // multiple times; degrades gracefully when no speech is detected or on error.
  const handleGenerateTranscript = () => {
    const file = videoFileRef.current;
    if (!file) {
      setTranscribeError("Please choose a video file first.");
      return;
    }

    setTranscribeError("");
    setTranscribeProgress(0);
    setTranscribeStage("uploading");
    setTranscribing(true);

    const formData = new FormData();
    formData.append("file", file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${API_BASE}/api/courses/upload-video`, true);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setTranscribeProgress(pct);
        // Once bytes are uploaded the server extracts audio + runs Whisper
        // before it responds — reflect that in the stage indicator.
        if (pct >= 100) {
          setTranscribeStage("transcribing");
        }
      }
    };

    xhr.onload = () => {
      setTranscribing(false);
      if (xhr.status === 200) {
        try {
          const res = JSON.parse(xhr.responseText);
          setChapterForm((prev) => ({
            ...prev,
            youtube_url: res.video_url || prev.youtube_url,
            // Keep any text the teacher already typed if Whisper returned nothing.
            video_transcript: res.transcript ? res.transcript : prev.video_transcript,
          }));
          setUploadedFileName(file.name);
          if (res.transcript) {
            setTranscribeStage("done");
          } else {
            setTranscribeStage("");
            setTranscribeError("No speech detected in the video — add a transcript manually below if needed.");
          }
        } catch {
          setTranscribeStage("");
          setTranscribeError("Failed to parse the transcription response.");
        }
      } else {
        let detail = `Transcription failed with status code ${xhr.status}.`;
        try {
          detail = JSON.parse(xhr.responseText).detail || detail;
        } catch { /* keep default */ }
        setTranscribeStage("");
        setTranscribeError(detail);
      }
    };

    xhr.onerror = () => {
      setTranscribing(false);
      setTranscribeStage("");
      setTranscribeError("Network error during transcription.");
    };

    xhr.send(formData);
  };

  // Upload a text/PDF/DOCX file → backend extracts plain text → fills the
  // article box. The extracted text is saved to article_content like typed text.
  const handleArticleUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const allowed = ["txt", "md", "pdf", "docx"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
      setArticleError("Invalid file format. Allowed: txt, md, pdf, docx.");
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setArticleError("File is too large. Maximum size allowed is 15MB.");
      return;
    }

    setArticleError("");
    setArticleUploading(true);
    setArticleFileName(file.name);
    try {
      const fd = new FormData();
      fd.append("file", file);
      // Note: don't use authFetch here — it forces a JSON Content-Type which
      // would break the multipart upload. Send the bearer token manually and
      // let the browser set the multipart boundary.
      const res = await fetch(`${API_BASE}/api/courses/extract-article`, {
        method: "POST",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.detail || "Could not extract text from the file.");
      }
      const data = await res.json();
      setChapterForm((prev) => ({ ...prev, article_content: data.article_content }));
    } catch (err) {
      setArticleError(err.message);
      setArticleFileName("");
    } finally {
      setArticleUploading(false);
    }
    // Allow re-selecting the same file again later
    e.target.value = "";
  };

  const loadCourses = useCallback(async () => {
    try {
      const res = await authFetch("/api/courses/manage/all");
      if (res.ok) {
        const data = await res.json();
        setCourses(data);
        // functional update → no dependency on selectedCourseId
        setSelectedCourseId((cur) => (data.length && !cur ? data[0].id : cur));
      }
    } catch { /* ignore */ }
  }, [authFetch]);

  useEffect(() => {
    // Mount-time data load (loadCourses setStates after its await) — intentional.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadCourses();
  }, [loadCourses]);

  const loadRecordings = useCallback(async (studentId = null) => {
    setRecordingsLoading(true);
    setRecordingsError("");
    try {
      const url = studentId ? `/api/teacher/recordings?student_id=${studentId}` : "/api/teacher/recordings";
      const res = await authFetch(url);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load recordings");
      setRecordings(await res.json());
    } catch (err) {
      setRecordingsError(err.message);
    } finally {
      setRecordingsLoading(false);
    }
  }, [authFetch]);

  const loadStudents = useCallback(async () => {
    setStudentsLoading(true);
    setStudentsError("");
    try {
      const res = await authFetch("/api/teacher/students");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load students");
      setStudents(await res.json());
    } catch (err) {
      setStudentsError(err.message);
    } finally {
      setStudentsLoading(false);
    }
  }, [authFetch]);

  // Load enrolled students the first time the teacher opens that tab.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (activeTab === "recordings") {
      setSelectedStudent(null);
      loadStudents();
    }
  }, [activeTab, loadStudents]);

  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setFormStatus("saving");
    try {
      const res = await authFetch("/api/courses/", {
        method: "POST",
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          pass_threshold: Number(form.pass_threshold),
          thumbnail: form.thumbnail || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      setFormStatus("success");
      setForm({ title: "", description: "", pass_threshold: 70, thumbnail: "" });
      loadCourses();
      setTimeout(() => setFormStatus(""), 3000);
    } catch (err) {
      setFormStatus("error:" + err.message);
    }
  };

  const handleAddChapter = async (e) => {
    e.preventDefault();
    if (!selectedCourseId) return;
    setChapterStatus("saving");
    try {
      const order = (selectedCourse?.chapters?.length || 0);
      const res = await authFetch(`/api/courses/${selectedCourseId}/chapters`, {
        method: "POST",
        body: JSON.stringify({
          title: chapterForm.title,
          order_index: order,
          article_content: chapterForm.article_content,
          youtube_url: chapterForm.youtube_url,
          video_transcript: chapterForm.video_transcript || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      setChapterStatus("success");
      setChapterForm({ title: "", article_content: "", youtube_url: "", video_transcript: "" });
      setUploadedFileName("");
      setUploadProgress(0);
      setTranscribing(false);
      setArticleFileName("");
      setArticleError("");
      loadCourses();
      setTimeout(() => setChapterStatus(""), 3000);
    } catch (err) {
      setChapterStatus("error:" + err.message);
    }
  };

  const handlePublish = async (courseId, isPublished) => {
    await authFetch(`/api/courses/${courseId}/publish`, { method: "PUT" });
    loadCourses();
  };

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "courses", label: "My Courses" },
    { key: "modules", label: "Add Modules" },
    { key: "create", label: "Add Course" },
    { key: "recordings", label: "Student Recordings" },
  ];

  const handleCheckApproval = async () => {
    setCheckingApproval(true);
    setApprovalMsg("");
    const fresh = await refreshUser();
    setCheckingApproval(false);
    if (fresh && fresh.is_approved) {
      // React will re-render with updated user — pending screen disappears automatically
    } else {
      setApprovalMsg("Still pending. Check back after the admin has approved your account.");
    }
  };

  if (user && !user.is_approved) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ display: "grid", placeItems: "center", minHeight: "100vh", backgroundColor: "var(--bg-canvas)" }}>
          <div className="card" style={{ maxWidth: 480, padding: "40px", textAlign: "center", backgroundColor: "#ffffff" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "20px" }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-title)", marginBottom: "12px" }}>Awaiting Admin Approval</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px", lineHeight: "1.6" }}>
              Your teacher account is pending approval. Once an admin approves your account, you will have full access to the Teacher Studio.
            </p>
            {approvalMsg && (
              <p style={{ color: "var(--color-warning)", fontSize: "12px", marginTop: "12px" }}>{approvalMsg}</p>
            )}
            <button
              className="btn btn-primary"
              style={{ marginTop: "24px", width: "100%" }}
              onClick={handleCheckApproval}
              disabled={checkingApproval}
            >
              {checkingApproval ? "Checking…" : "Check Approval Status"}
            </button>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>

          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em" }}>
                Teacher Studio
              </h1>
              <span style={{
                fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                borderRadius: "4px", background: "var(--bg-success)", color: "var(--color-success)",
                border: "1px solid rgba(16,185,129,0.2)", fontFamily: "JetBrains Mono",
              }}>
                TEACHER
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
              Welcome, <strong style={{ color: "var(--text-title)" }}>{user?.name}</strong>. Manage your courses and track student progress.
            </p>
          </div>

          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: "32px" }}>
            {TABS.map((t) => (
              <div
                key={t.key}
                className={`tab ${activeTab === t.key ? "active" : ""}`}
                onClick={() => setActiveTab(t.key)}
              >
                {t.label}
              </div>
            ))}
          </div>

          {/* Overview */}
          {activeTab === "overview" && (
            <div>
              <div className="grid-4" style={{ marginBottom: "32px" }}>
                {[
                  {
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }}>
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                    ),
                    value: courses.length,
                    label: "Total Courses"
                  },
                  {
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-success)' }}>
                        <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
                        <polyline points="22 4 12 14.01 9 11.01" />
                      </svg>
                    ),
                    value: courses.filter(c => c.is_published).length,
                    label: "Published"
                  },
                  {
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--brand)' }}>
                        <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                        <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                      </svg>
                    ),
                    value: courses.reduce((s, c) => s + (c.chapters?.length || 0), 0),
                    label: "Total Modules"
                  },
                  {
                    icon: (
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ color: 'var(--color-warning)' }}>
                        <polyline points="23 6 13.5 15.5 8.5 10.5 1 18" />
                        <polyline points="17 6 23 6 23 12" />
                      </svg>
                    ),
                    value: courses.filter(c => !c.is_published).length,
                    label: "Drafts"
                  },
                ].map((s, i) => (
                  <div className="card stat-card" key={i} style={{ backgroundColor: "#ffffff" }}>
                    <div className="stat-icon" style={{ display: 'flex', alignItems: 'center' }}>{s.icon}</div>
                    <div>
                      <div className="stat-value">{s.value}</div>
                      <div className="stat-label">{s.label}</div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Quick Stats */}
              <div className="grid-2">
                <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                    Your Courses
                  </h3>
                  {courses.length === 0 ? (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Create a course to get started.</p>
                  ) : courses.map((c) => (
                    <div key={c.id} style={{ marginBottom: "16px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                        <span style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>{c.title}</span>
                        <span className={`badge ${c.is_published ? "badge-success" : "badge-warning"}`} style={{ fontSize: "10px" }}>
                          {c.is_published ? "Live" : "Draft"}
                        </span>
                      </div>
                      <div style={{ fontSize: "11px", color: "var(--text-subtle)" }}>{c.chapters?.length || 0} modules</div>
                    </div>
                  ))}
                </div>
                <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                    AI Interview Flow
                  </h3>
                  <ol style={{ fontSize: "13px", color: "var(--text-main)", paddingLeft: "18px", lineHeight: "1.8" }}>
                    <li>Student watches your YouTube video</li>
                    <li>Student reads the module article</li>
                    <li>AI oral interview (Google Meet style)</li>
                    <li>Pass → next module unlocked · Fail → must re-study</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* My Courses */}
          {activeTab === "courses" && (
            <div className="table-container">
              <table>
                <thead>
                  <tr>
                    <th>Course Title</th><th>Chapters</th><th>Students</th><th>Pass Rate</th><th>Status</th><th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {courses.map((c) => (
                    <tr key={c.id}>
                      <td style={{ fontWeight: "700", color: "var(--text-title)" }}>{c.title}</td>
                      <td className="mono">{c.chapters?.length || 0}</td>
                      <td className="mono">{c.student_count ?? 0}</td>
                      <td className="mono">{c.pass_rate !== undefined && c.pass_rate !== null ? `${c.pass_rate}%` : "0%"}</td>
                      <td>
                        <span className={`badge ${c.is_published ? "badge-success" : "badge-warning"}`}>
                          {c.is_published ? "Live" : "Draft"}
                        </span>
                      </td>
                      <td style={{ display: "flex", gap: "8px" }}>
                        <button className="btn btn-secondary btn-sm" onClick={() => { setSelectedCourseId(c.id); setActiveTab("modules"); }}>Add Modules</button>
                        <button className="btn btn-secondary btn-sm" onClick={() => handlePublish(c.id, c.is_published)}>
                          {c.is_published ? "Unpublish" : "Publish"}
                        </button>
                      </td>
                    </tr>
                  ))}
                  {courses.length === 0 && (
                    <tr><td colSpan={6} style={{ textAlign: "center", color: "var(--text-muted)" }}>No courses yet</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Add Modules */}
          {activeTab === "modules" && (
            <div className="grid-2" style={{ alignItems: "start" }}>
              <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono" }}>
                  Add Module (Chapter)
                </h3>
                <div className="form-group">
                  <label className="form-label">Select Course</label>
                  <select
                    className="form-input"
                    value={selectedCourseId}
                    onChange={(e) => setSelectedCourseId(e.target.value)}
                  >
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>{c.title}</option>
                    ))}
                  </select>
                </div>
                {chapterStatus === "success" && (
                  <div className="badge badge-success" style={{ marginBottom: "16px" }}>Module added! Transcript is being fetched in the background — refresh in a moment to see status.</div>
                )}
                {chapterStatus.startsWith("error:") && (
                  <div style={{ color: "var(--color-danger)", marginBottom: "16px", fontSize: "13px" }}>{chapterStatus.slice(6)}</div>
                )}
                <form onSubmit={handleAddChapter}>
                  <div className="form-group">
                    <label className="form-label">Module Title</label>
                    <input className="form-input" placeholder="e.g. Variables & Data Types" value={chapterForm.title} onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })} required />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Video File (mp4, mov, webm, mkv)</label>
                    <input
                      type="file"
                      accept=".mp4,.mov,.webm,.mkv"
                      onChange={handleVideoUpload}
                      disabled={uploading}
                      className="form-input"
                      style={{ padding: "8px" }}
                      required={!chapterForm.youtube_url}
                    />

                    {uploading && (
                      <div style={{ marginTop: "12px" }}>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                          Uploading video ({uploadProgress}%)
                        </div>
                        <div style={{
                          width: "100%",
                          height: "6px",
                          backgroundColor: "var(--border-muted, #e5e7eb)",
                          borderRadius: "3px",
                          overflow: "hidden",
                        }}>
                          <div style={{
                            height: "100%",
                            width: `${uploadProgress}%`,
                            backgroundColor: "var(--brand, #0070f3)",
                            transition: "width 0.1s ease",
                          }} />
                        </div>
                      </div>
                    )}

                    {transcribing && (
                      <div style={{ marginTop: "12px", fontSize: "12px", color: "var(--brand)", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className="spinner" style={{ width: 12, height: 12, border: "2px solid var(--brand)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                        Transcribing video audio… the transcript box will fill in automatically.
                      </div>
                    )}

                    {uploadedFileName && !uploading && (
                      <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "#f9fafb", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm)" }}>
                        <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-main)" }}>
                          ✓ File: {uploadedFileName}
                        </div>
                        {chapterForm.youtube_url && (
                          <div style={{ fontSize: "11px", color: "var(--color-success)", marginTop: "4px" }}>
                            Successfully uploaded!
                            {chapterForm.video_transcript ? " Transcript auto-generated below." : " No speech detected — add a transcript manually below if needed."}
                          </div>
                        )}
                      </div>
                    )}

                    {uploadError && (
                      <p style={{ fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>
                        ❌ {uploadError}
                      </p>
                    )}

                    {/* ── Auto-Transcript Generation ─────────────────────── */}
                    {/* Gate on state (not the ref) so the panel re-renders
                        reliably; the raw File is still read from videoFileRef
                        inside the click handler, which is allowed. */}
                    {uploadedFileName && !uploading && (
                      <div style={{ marginTop: "16px", padding: "14px 16px", borderRadius: "10px", border: "1px solid rgba(99,102,241,0.25)", background: "linear-gradient(135deg, rgba(99,102,241,0.04) 0%, rgba(139,92,246,0.04) 100%)" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "10px" }}>
                          <div style={{ fontSize: "12px", color: "var(--text-main)", fontWeight: "500" }}>
                            <span style={{ marginRight: "6px" }}>✨</span>
                            Auto-generate transcript from this video
                          </div>
                          {!transcribing && transcribeStage !== "done" && (
                            <button
                              type="button"
                              onClick={handleGenerateTranscript}
                              disabled={transcribing}
                              style={{
                                padding: "6px 16px",
                                fontSize: "12px",
                                fontWeight: "600",
                                borderRadius: "20px",
                                border: "none",
                                cursor: "pointer",
                                background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
                                color: "#fff",
                                letterSpacing: "0.02em",
                                boxShadow: "0 2px 8px rgba(99,102,241,0.35)",
                                transition: "opacity 0.2s",
                              }}
                            >
                              Generate Transcript
                            </button>
                          )}
                        </div>

                        {/* Stage indicator */}
                        {transcribing && (
                          <div style={{ marginTop: "12px" }}>
                            {/* Upload progress bar */}
                            {transcribeStage === "uploading" && (
                              <>
                                <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "6px" }}>
                                  ⬆️ Uploading video… {transcribeProgress}%
                                </div>
                                <div style={{ width: "100%", height: "5px", backgroundColor: "#e5e7eb", borderRadius: "3px", overflow: "hidden" }}>
                                  <div style={{ height: "100%", width: `${transcribeProgress}%`, background: "linear-gradient(90deg, #6366f1, #8b5cf6)", transition: "width 0.15s ease", borderRadius: "3px" }} />
                                </div>
                              </>
                            )}
                            {transcribeStage === "extracting" && (
                              <div style={{ fontSize: "11px", color: "#6366f1", fontWeight: "500" }}>
                                <StageSpinner /> Extracting audio with FFmpeg…
                              </div>
                            )}
                            {transcribeStage === "transcribing" && (
                              <div style={{ fontSize: "11px", color: "#8b5cf6", fontWeight: "500" }}>
                                <StageSpinner /> Transcribing with Whisper AI…
                              </div>
                            )}
                          </div>
                        )}

                        {/* Done */}
                        {transcribeStage === "done" && !transcribing && (
                          <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--color-success)", fontWeight: "600" }}>
                            ✓ Transcript generated and filled below — review and edit if needed.
                          </div>
                        )}

                        {/* Error */}
                        {transcribeError && (
                          <div style={{ marginTop: "10px", fontSize: "11px", color: "var(--color-danger)", fontWeight: "500" }}>
                            ❌ {transcribeError}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  <div className="form-group">
                    <label className="form-label">Article Content (markdown)</label>
                    <div style={{ marginBottom: "10px" }}>
                      <input
                        type="file"
                        accept=".txt,.md,.pdf,.docx"
                        onChange={handleArticleUpload}
                        disabled={articleUploading}
                        className="form-input"
                        style={{ padding: "8px" }}
                      />
                      {articleUploading && (
                        <div style={{ marginTop: "8px", fontSize: "12px", color: "var(--brand)", display: "flex", alignItems: "center", gap: "8px" }}>
                          <span className="spinner" style={{ width: 12, height: 12, border: "2px solid var(--brand)", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                          Extracting text from {articleFileName}…
                        </div>
                      )}
                      {articleFileName && !articleUploading && !articleError && (
                        <div style={{ marginTop: "8px", fontSize: "11px", color: "var(--color-success)" }}>
                          ✓ Imported text from {articleFileName}. Review/edit below before saving.
                        </div>
                      )}
                      {articleError && (
                        <p style={{ fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>❌ {articleError}</p>
                      )}
                      <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "6px" }}>
                        Optional — upload a .txt, .md, .pdf, or .docx file to auto-fill the article from a document. You can still edit the text below.
                      </p>
                    </div>
                    <textarea className="form-input form-textarea" placeholder="## Topic&#10;Explain key concepts..." value={chapterForm.article_content} onChange={(e) => setChapterForm({ ...chapterForm, article_content: e.target.value })} required rows={8} />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Video Transcript (auto-generated — editable)</label>
                    <textarea className="form-input form-textarea" placeholder="Auto-filled from the uploaded video. You can edit or paste your own transcript here..." value={chapterForm.video_transcript} onChange={(e) => setChapterForm({ ...chapterForm, video_transcript: e.target.value })} rows={6} />
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>
                      Generated automatically from the video&apos;s audio when you upload it. Review/edit before saving — this text is embedded and used by the AI to formulate questions and assess student comprehension.
                    </p>
                  </div>
                  <button type="submit" className="btn btn-primary" disabled={!selectedCourseId || chapterStatus === "saving" || uploading || !chapterForm.youtube_url}>
                    {chapterStatus === "saving" ? "Adding…" : "Add Module"}
                  </button>
                </form>
              </div>
              <div className="card" style={{ padding: "24px", backgroundColor: "#ffffff" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "16px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", flex: 1, margin: 0 }}>
                    Modules in {selectedCourse?.title || "—"}
                  </h3>
                  <button
                    className="btn btn-secondary"
                    onClick={loadCourses}
                    style={{ fontSize: "11px", padding: "4px 10px" }}
                  >
                    Refresh
                  </button>
                </div>
                {(selectedCourse?.chapters || []).sort((a, b) => a.order_index - b.order_index).map((ch, i) => {
                  const hasTranscript = !!ch.video_transcript;
                  const wordCount = hasTranscript ? ch.video_transcript.split(" ").length : 0;
                  return (
                    <div key={ch.id} style={{ padding: "12px 0", borderBottom: "1px solid var(--border-muted)" }}>
                      <div style={{ fontWeight: "700", fontSize: "14px" }}>{String(i + 1).padStart(2, "0")} — {ch.title}</div>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px", wordBreak: "break-all" }}>{ch.youtube_url}</div>
                      <div style={{ fontSize: "11px", marginTop: "4px" }}>
                        {hasTranscript ? (
                          <span style={{ color: "var(--color-success)" }}>
                            ✓ Transcript ready ({wordCount.toLocaleString()} words)
                          </span>
                        ) : (
                          <span style={{ color: "#f59e0b" }}>
                            ⏳ Transcript pending — click Refresh after a moment
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
                {(!selectedCourse?.chapters || selectedCourse.chapters.length === 0) && (
                  <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No modules yet. Add your first module with a YouTube link.</p>
                )}
              </div>
            </div>
          )}

          {/* Create Course */}
          {activeTab === "create" && (
            <div className="card" style={{ maxWidth: 680, margin: "0 auto", backgroundColor: "#ffffff" }}>
              <h3 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                Create New Course
              </h3>

              {formStatus === "success" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--bg-success)", border: "1px solid var(--border-success)", color: "var(--color-success)", fontSize: "13.5px", fontWeight: "600" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  Course created successfully!
                </div>
              )}
              {formStatus.startsWith("error:") && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--bg-danger)", border: "1px solid var(--border-danger)", color: "var(--color-danger)", fontSize: "13.5px", fontWeight: "600" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="15" y1="9" x2="9" y2="15" />
                    <line x1="9" y1="9" x2="15" y2="15" />
                  </svg>
                  {formStatus.slice(6)}
                </div>
              )}

              <form onSubmit={handleCreateCourse}>
                <div className="form-group">
                  <label className="form-label">Course Title</label>
                  <input
                    className="form-input"
                    placeholder="e.g. JavaScript Fundamentals"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    required
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    className="form-input form-textarea"
                    placeholder="Describe what students will learn..."
                    value={form.description}
                    onChange={(e) => setForm({ ...form, description: e.target.value })}
                    required
                  />
                </div>
                <div className="grid-2">
                  <div className="form-group">
                    <label className="form-label">Pass Threshold (%)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0} max={100}
                      value={form.pass_threshold}
                      onChange={(e) => setForm({ ...form, pass_threshold: e.target.value })}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Thumbnail URL (optional)</label>
                    <input
                      className="form-input"
                      placeholder="https://..."
                      value={form.thumbnail}
                      onChange={(e) => setForm({ ...form, thumbnail: e.target.value })}
                    />
                  </div>
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px" }}>
                  <button type="button" className="btn btn-secondary" onClick={() => setForm({ title: "", description: "", pass_threshold: 70, thumbnail: "" })}>
                    Clear
                  </button>
                  <button type="submit" className="btn btn-primary" disabled={formStatus === "saving"}>
                    {formStatus === "saving" ? "Creating…" : "Create Course"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Student Recordings */}
          {activeTab === "recordings" && (
            <div>
              {!selectedStudent ? (
                <div>
                  <div style={{ display: "flex", alignItems: "center", marginBottom: "20px" }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", margin: 0 }}>
                        Enrolled Students
                      </h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
                        Select a student to view their oral interview recordings.
                      </p>
                    </div>
                    <button className="btn btn-secondary" onClick={loadStudents} style={{ fontSize: "11px", padding: "4px 10px" }}>
                      Refresh
                    </button>
                  </div>

                  {studentsLoading && (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading students…</p>
                  )}
                  {studentsError && (
                    <p style={{ color: "var(--color-danger)", fontSize: "13px" }}>❌ {studentsError}</p>
                  )}
                  {!studentsLoading && !studentsError && students.length === 0 && (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                      No students enrolled in your published courses yet.
                    </p>
                  )}

                  {!studentsLoading && !studentsError && students.length > 0 && (
                    <div className="table-container">
                      <table>
                        <thead>
                          <tr>
                            <th>Student Name</th>
                            <th>Email Address</th>
                            <th>Enrolled Courses</th>
                            <th>Actions</th>
                          </tr>
                        </thead>
                        <tbody>
                          {students.map((student) => (
                            <tr
                              key={student.id}
                              style={{ cursor: "pointer" }}
                              onClick={() => {
                                setSelectedStudent(student);
                                loadRecordings(student.id);
                              }}
                            >
                              <td>
                                <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                  <div style={{
                                    width: 32, height: 32, borderRadius: "50%",
                                    background: "linear-gradient(135deg, var(--brand) 0%, #8b5cf6 100%)",
                                    color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                                    fontWeight: "600", fontSize: "13px"
                                  }}>
                                    {student.name.charAt(0).toUpperCase()}
                                  </div>
                                  <div style={{ fontWeight: "700", color: "var(--text-title)" }}>
                                    {student.name}
                                  </div>
                                </div>
                              </td>
                              <td className="mono" style={{ color: "var(--text-muted)" }}>{student.email}</td>
                              <td>
                                <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }}>
                                  {student.courses.map((course) => (
                                    <span key={course.id} className="badge badge-secondary" style={{ fontSize: "11px" }}>
                                      {course.title}
                                    </span>
                                  ))}
                                </div>
                              </td>
                              <td>
                                <button
                                  className="btn btn-secondary btn-sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setSelectedStudent(student);
                                    loadRecordings(student.id);
                                  }}
                                >
                                  View Recordings
                                </button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
              ) : (
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => setSelectedStudent(null)}
                      style={{ padding: "6px 12px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      ← Back to Students
                    </button>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", margin: 0 }}>
                        Recordings for {selectedStudent.name}
                      </h3>
                      <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
                        {selectedStudent.email}
                      </p>
                    </div>
                    <button
                      className="btn btn-secondary"
                      onClick={() => loadRecordings(selectedStudent.id)}
                      style={{ fontSize: "11px", padding: "4px 10px" }}
                    >
                      Refresh
                    </button>
                  </div>

                  {recordingsLoading && (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>Loading recordings…</p>
                  )}
                  {recordingsError && (
                    <p style={{ color: "var(--color-danger)", fontSize: "13px" }}>❌ {recordingsError}</p>
                  )}
                  {!recordingsLoading && !recordingsError && recordings.length === 0 && (
                    <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                      No interview recordings found for this student.
                    </p>
                  )}

                  <div className="grid-2" style={{ alignItems: "start" }}>
                    {recordings.map((r) => (
                      <div key={r.session_id} className="card" style={{ padding: "16px", backgroundColor: "#ffffff" }}>
                        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "10px" }}>
                          <div>
                            <div style={{ fontWeight: "700", fontSize: "14px", color: "var(--text-title)" }}>{r.student?.name}</div>
                            <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>{r.student?.email}</div>
                          </div>
                          {r.overall_score !== null && r.overall_score !== undefined && (
                            <span className={`badge ${r.passed ? "badge-success" : "badge-warning"}`} style={{ fontSize: "10px" }}>
                              {r.passed ? "PASSED" : "NEEDS REVIEW"} · {r.overall_score}%
                            </span>
                          )}
                        </div>
                        <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "10px" }}>
                          <strong style={{ color: "var(--text-main)" }}>{r.course?.title}</strong>
                          {r.module ? ` · ${r.module}` : " · Course-wide interview"}
                          {r.created_at ? ` · ${new Date(r.created_at).toLocaleDateString()}` : ""}
                        </div>
                        <RecordingPlayer src={r.recording_url} />
                        <a
                          href={r.recording_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          style={{ display: "inline-block", marginTop: "8px", fontSize: "12px", color: "var(--brand)" }}
                        >
                          Open in new tab ↗
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(TeacherPanel, ["teacher", "admin"]);
