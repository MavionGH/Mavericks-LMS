"use client";
import Navbar from "@/components/Navbar";
import Skeleton, { SkeletonTable } from "@/components/Skeleton";
import { useState, useEffect, useCallback, useRef } from "react";
import { API_BASE, useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import CustomSelect from "@/components/CustomSelect";
import ImageCropperModal from "@/components/ImageCropperModal";
import { TeacherHiringTemplates } from "./hiring-templates/page";

// Player for interview recordings.
// MediaRecorder (WebM) files lack a duration header, so the browser reports
// duration = Infinity (or a bogus small value) and the seek bar is non-functional.
// Fix: on metadata load, if duration is missing/broken, seek to a huge timestamp so
// the browser scans to the end and learns the real duration, then seek back to 0.
// We use the `seeked` event (fires once when the seek actually lands) NOT `timeupdate`
// (which fires continuously during normal playback and would snap the bar back on
// every tick). A guard ref prevents re-running once already fixed.
function RecordingPlayer({ src }) {
  const ref = useRef(null);
  const fixedRef = useRef(false);

  const handleLoadedMetadata = () => {
    const v = ref.current;
    if (!v || fixedRef.current) return;
    // Infinity = no duration header; NaN = file unreadable.
    // A suspiciously-short duration (< 1 s) can happen when only the first
    // WebM cluster header was parsed — treat that as broken too.
    const dur = v.duration;
    if (dur === Infinity || Number.isNaN(dur)) {
      fixedRef.current = true;

      // `seeked` fires exactly once when the browser finishes the seek operation,
      // meaning the full file has been parsed and the real duration is now known.
      const onSeeked = () => {
        v.removeEventListener("seeked", onSeeked);
        v.currentTime = 0; // snap back to the start
      };
      v.addEventListener("seeked", onSeeked);
      // Seeking past the end forces the browser to read the entire file.
      v.currentTime = 1e101;
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
  const [form, setForm] = useState({ title: "", description: "", pass_threshold: 70, quiz_threshold: 70, thumbnail: "" });
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
  const [editingChapterId, setEditingChapterId] = useState(null);
  const [editingCourseId, setEditingCourseId] = useState(null);
  const [thumbnailSource, setThumbnailSource] = useState("url"); // "url" | "upload"
  const [cropperImageSrc, setCropperImageSrc] = useState(null);
  const [thumbnailUploading, setThumbnailUploading] = useState(false);

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
  const [publishingCourses, setPublishingCourses] = useState({});
  const [publishSuccessMsg, setPublishSuccessMsg] = useState({});
  const [recordingsLoading, setRecordingsLoading] = useState(false);
  const [recordingsError, setRecordingsError] = useState("");

  // Student enrollment/recordings list
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [studentsError, setStudentsError] = useState("");
  const [selectedStudent, setSelectedStudent] = useState(null);

  // Nested views for My Courses click flow
  const [selectedCourseForStudents, setSelectedCourseForStudents] = useState(null);
  const [selectedStudentForInterviews, setSelectedStudentForInterviews] = useState(null);
  const [courseStudents, setCourseStudents] = useState([]);
  const [courseStudentsLoading, setCourseStudentsLoading] = useState(false);
  const [courseStudentsError, setCourseStudentsError] = useState("");
  const [courseRecordings, setCourseRecordings] = useState([]);
  const [courseRecordingsLoading, setCourseRecordingsLoading] = useState(false);
  const [courseRecordingsError, setCourseRecordingsError] = useState("");



  const loadCourseStudents = useCallback(async (courseId) => {
    setCourseStudentsLoading(true);
    setCourseStudentsError("");
    try {
      const res = await authFetch(`/api/teacher/students?course_id=${courseId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load students");
      setCourseStudents(await res.json());
    } catch (err) {
      setCourseStudentsError(err.message);
    } finally {
      setCourseStudentsLoading(false);
    }
  }, [authFetch]);

  const loadCourseRecordings = useCallback(async (studentId, courseId) => {
    setCourseRecordings([]);
    setCourseRecordingsLoading(true);
    setCourseRecordingsError("");
    try {
      const res = await authFetch(`/api/teacher/recordings?student_id=${studentId}&course_id=${courseId}`);
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).detail || "Failed to load recordings");
      setCourseRecordings(await res.json());
    } catch (err) {
      setCourseRecordingsError(err.message);
    } finally {
      setCourseRecordingsLoading(false);
    }
  }, [authFetch]);





  // Transcript generation state
  const [transcribing, setTranscribing] = useState(false);
  const [transcribeStage, setTranscribeStage] = useState(""); // "uploading" | "extracting" | "transcribing" | "done"
  const [transcribeProgress, setTranscribeProgress] = useState(0);
  const [transcribeError, setTranscribeError] = useState("");
  const videoFileRef = useRef(null); // holds the raw File object for transcription
  const transcriptPollRef = useRef(null); // setTimeout handle for async transcript polling

  // Poll the async transcription job started by /upload-video?async_transcript=1
  // until it is done/errored, then invoke the matching callback. Any in-flight
  // poll is cancelled first so a new upload never races an old one.
  const pollTranscript = (jobId, { onDone, onError }) => {
    if (transcriptPollRef.current) clearTimeout(transcriptPollRef.current);
    let attempts = 0;
    const maxAttempts = 150; // ~5 min at a 2s cadence, then give up gracefully
    const tick = async () => {
      attempts += 1;
      try {
        const res = await authFetch(`/api/courses/transcript-status/${jobId}`);
        if (res.status === 404) {
          onError("Transcription expired — add a transcript manually below if needed.");
          return;
        }
        if (!res.ok) throw new Error("status check failed");
        const data = await res.json();
        if (data.status === "done") { onDone(data.transcript || ""); return; }
        if (data.status === "error") {
          onError(data.error || "Transcription failed — add a transcript manually below if needed.");
          return;
        }
        // still pending
        if (attempts >= maxAttempts) {
          onError("Transcription is taking too long — add a transcript manually below if needed.");
          return;
        }
        transcriptPollRef.current = setTimeout(tick, 2000);
      } catch {
        if (attempts >= maxAttempts) { onError("Network error while checking transcription."); return; }
        transcriptPollRef.current = setTimeout(tick, 2000);
      }
    };
    transcriptPollRef.current = setTimeout(tick, 1500);
  };

  // Stop any pending transcript poll if the page unmounts mid-transcription.
  useEffect(() => () => {
    if (transcriptPollRef.current) clearTimeout(transcriptPollRef.current);
  }, []);

  const handleVideoUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    // Store for later transcription
    videoFileRef.current = file;
    // Reset transcription state when a new file is picked
    if (transcriptPollRef.current) clearTimeout(transcriptPollRef.current);
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
    // async_transcript=1: the server returns the video URL immediately and
    // transcribes in the background; we poll for the transcript afterwards.
    xhr.open("POST", "http://localhost:8000/api/courses/upload-video?async_transcript=1", true);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const percentComplete = Math.round((event.loaded / event.total) * 100);
        setUploadProgress(percentComplete);
        // Bytes are uploaded — the server is now storing + transcribing.
        if (percentComplete >= 100) {
          setTranscribing(true);
        }
      }
    };

    xhr.onload = () => {
      setUploading(false);
      if (xhr.status === 200) {
        try {
          const res = JSON.parse(xhr.responseText);
          // The video URL is ready right away — fill it and finish the upload UI.
          setChapterForm((prev) => ({ ...prev, youtube_url: res.video_url }));
          setUploadProgress(100);

          if (res.transcript_job_id) {
            // Async transcription in progress — keep the indicator up and poll.
            setTranscribing(true);
            setTranscribeStage("transcribing");
            pollTranscript(res.transcript_job_id, {
              onDone: (t) => {
                setTranscribing(false);
                setTranscribeStage(t ? "done" : "");
                if (t) {
                  setChapterForm((prev) => ({ ...prev, video_transcript: t }));
                } else {
                  setTranscribeError("No speech detected in the video — add a transcript manually below if needed.");
                }
              },
              onError: (msg) => {
                setTranscribing(false);
                setTranscribeStage("");
                setTranscribeError(msg);
              },
            });
          } else {
            // Synchronous fallback (server returned the transcript inline).
            setTranscribing(false);
            if (res.transcript) {
              setChapterForm((prev) => ({ ...prev, video_transcript: res.transcript }));
            }
          }
        } catch (e) {
          setTranscribing(false);
          setUploadError("Failed to parse upload response.");
        }
      } else {
        setTranscribing(false);
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
    // async_transcript=1: server stores the video and returns immediately; the
    // transcript is produced in the background and fetched by polling.
    xhr.open("POST", `${API_BASE}/api/courses/upload-video?async_transcript=1`, true);
    if (token) {
      xhr.setRequestHeader("Authorization", `Bearer ${token}`);
    }

    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        const pct = Math.round((event.loaded / event.total) * 100);
        setTranscribeProgress(pct);
        // Once bytes are uploaded the server extracts audio + runs Whisper in
        // the background — reflect that in the stage indicator.
        if (pct >= 100) {
          setTranscribeStage("transcribing");
        }
      }
    };

    xhr.onload = () => {
      if (xhr.status === 200) {
        try {
          const res = JSON.parse(xhr.responseText);
          setChapterForm((prev) => ({
            ...prev,
            youtube_url: res.video_url || prev.youtube_url,
          }));
          setUploadedFileName(file.name);

          if (res.transcript_job_id) {
            // Keep the "transcribing" stage up and poll until the job finishes.
            setTranscribing(true);
            setTranscribeStage("transcribing");
            pollTranscript(res.transcript_job_id, {
              onDone: (t) => {
                setTranscribing(false);
                if (t) {
                  setChapterForm((prev) => ({ ...prev, video_transcript: t }));
                  setTranscribeStage("done");
                } else {
                  setTranscribeStage("");
                  setTranscribeError("No speech detected in the video — add a transcript manually below if needed.");
                }
              },
              onError: (msg) => {
                setTranscribing(false);
                setTranscribeStage("");
                setTranscribeError(msg);
              },
            });
          } else {
            // Synchronous fallback (server returned the transcript inline).
            setTranscribing(false);
            if (res.transcript) {
              setChapterForm((prev) => ({ ...prev, video_transcript: res.transcript }));
              setTranscribeStage("done");
            } else {
              setTranscribeStage("");
              setTranscribeError("No speech detected in the video — add a transcript manually below if needed.");
            }
          }
        } catch {
          setTranscribing(false);
          setTranscribeStage("");
          setTranscribeError("Failed to parse the transcription response.");
        }
      } else {
        setTranscribing(false);
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

  const handleThumbnailFileChange = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const allowed = ["png", "jpg", "jpeg", "webp", "gif"];
    const ext = file.name.split(".").pop().toLowerCase();
    if (!allowed.includes(ext)) {
      setFormStatus("error:Invalid image format. Allowed: png, jpg, jpeg, webp, gif.");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      setCropperImageSrc(reader.result);
    };
    reader.readAsDataURL(file);
    // Allow re-selecting the same file again later
    e.target.value = "";
  };

  const handleCropComplete = async (croppedBlob) => {
    setCropperImageSrc(null);
    setThumbnailUploading(true);

    const formData = new FormData();
    formData.append("file", croppedBlob, "thumbnail.jpg");

    try {
      const res = await authFetch("/api/courses/upload-thumbnail", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        throw new Error("Failed to upload thumbnail image");
      }

      const data = await res.json();
      setForm((prev) => ({ ...prev, thumbnail: data.thumbnail_url }));
      setFormStatus("");
    } catch (err) {
      console.error(err);
      setFormStatus("error:Failed to upload cropped thumbnail image.");
    } finally {
      setThumbnailUploading(false);
    }
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

  useEffect(() => {
    if (typeof window !== "undefined") {
      const params = new URLSearchParams(window.location.search);
      const tab = params.get("tab");
      if (tab && ["overview", "courses", "modules", "create", "hiring"].includes(tab)) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setActiveTab(tab);
      }
    }
  }, []);

  const loadRecordings = useCallback(async (studentId = null) => {
    setRecordings([]);
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



  const selectedCourse = courses.find((c) => c.id === selectedCourseId);

  const handleCreateCourse = async (e) => {
    e.preventDefault();
    setFormStatus("saving");
    try {
      const url = editingCourseId ? `/api/courses/${editingCourseId}` : "/api/courses/";
      const method = editingCourseId ? "PUT" : "POST";
      const res = await authFetch(url, {
        method: method,
        body: JSON.stringify({
          title: form.title,
          description: form.description,
          pass_threshold: Number(form.pass_threshold),
          quiz_threshold: Number(form.quiz_threshold),
          thumbnail: form.thumbnail || null,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      setFormStatus("success");
      setForm({ title: "", description: "", pass_threshold: 70, quiz_threshold: 70, thumbnail: "" });
      setEditingCourseId(null);
      loadCourses();
      setActiveTab("courses");
      setTimeout(() => setFormStatus(""), 3000);
    } catch (err) {
      setFormStatus("error:" + err.message);
    }
  };

  const handleEditCourse = (course) => {
    setEditingCourseId(course.id);
    setForm({
      title: course.title || "",
      description: course.description || "",
      pass_threshold: course.pass_threshold !== undefined ? course.pass_threshold : 70,
      quiz_threshold: course.quiz_threshold !== undefined ? course.quiz_threshold : 70,
      thumbnail: course.thumbnail || "",
    });
    setActiveTab("create");
  };

  const handleCancelEditCourse = () => {
    setEditingCourseId(null);
    setForm({ title: "", description: "", pass_threshold: 70, quiz_threshold: 70, thumbnail: "" });
    setActiveTab("courses");
  };

  const handleAddChapter = async (e) => {
    e.preventDefault();
    if (!selectedCourseId) return;
    setChapterStatus("saving");
    try {
      let res;
      if (editingChapterId) {
        const existingChapter = selectedCourse?.chapters?.find((ch) => ch.id === editingChapterId);
        const order = existingChapter ? existingChapter.order_index : 0;
        res = await authFetch(`/api/courses/chapters/${editingChapterId}`, {
          method: "PUT",
          body: JSON.stringify({
            title: chapterForm.title,
            order_index: order,
            article_content: chapterForm.article_content,
            youtube_url: chapterForm.youtube_url,
            video_transcript: chapterForm.video_transcript || null,
          }),
        });
      } else {
        const order = (selectedCourse?.chapters?.length || 0);
        res = await authFetch(`/api/courses/${selectedCourseId}/chapters`, {
          method: "POST",
          body: JSON.stringify({
            title: chapterForm.title,
            order_index: order,
            article_content: chapterForm.article_content,
            youtube_url: chapterForm.youtube_url,
            video_transcript: chapterForm.video_transcript || null,
          }),
        });
      }
      if (!res.ok) throw new Error((await res.json()).detail || "Failed");
      setChapterStatus(editingChapterId ? "success-edit" : "success-add");
      setChapterForm({ title: "", article_content: "", youtube_url: "", video_transcript: "" });
      setEditingChapterId(null);
      setUploadedFileName("");
      setUploadProgress(0);
      setTranscribing(false);
      setArticleFileName("");
      setArticleError("");
      loadCourses();
      setActiveTab("modules");
      setTimeout(() => setChapterStatus(""), 3000);
    } catch (err) {
      setChapterStatus("error:" + err.message);
    }
  };

  const handleEditChapter = async (chapter) => {
    setEditingChapterId(chapter.id);
    setActiveTab("edit-chapter");
    setChapterForm({
      title: chapter.title,
      article_content: "Loading documentation...",
      youtube_url: chapter.youtube_url || "",
      video_transcript: "Loading transcript...",
    });
    if (chapter.youtube_url) {
      const parts = chapter.youtube_url.split("/");
      const fileName = parts[parts.length - 1];
      setUploadedFileName(fileName.includes(".") ? fileName : "Existing Video File");
    } else {
      setUploadedFileName("");
    }
    setArticleFileName("");

    try {
      const res = await authFetch(`/api/courses/manage/chapters/${chapter.id}`);
      if (res.ok) {
        const fullChapter = await res.json();
        setChapterForm({
          title: fullChapter.title,
          article_content: fullChapter.article_content || "",
          youtube_url: fullChapter.youtube_url || "",
          video_transcript: fullChapter.video_transcript || "",
        });
      }
    } catch {
      setChapterForm((prev) => ({
        ...prev,
        article_content: "",
        video_transcript: "",
      }));
    }
  };

  const handleCancelEditChapter = () => {
    setEditingChapterId(null);
    setChapterForm({ title: "", article_content: "", youtube_url: "", video_transcript: "" });
    setUploadedFileName("");
    setArticleFileName("");
    setActiveTab("modules");
  };

  const handlePublish = async (courseId, isPublished) => {
    setPublishingCourses((prev) => ({ ...prev, [courseId]: true }));
    setPublishSuccessMsg((prev) => ({ ...prev, [courseId]: "" }));
    try {
      const res = await authFetch(`/api/courses/${courseId}/publish`, { method: "PUT" });
      if (res.ok) {
        setPublishSuccessMsg((prev) => ({ ...prev, [courseId]: isPublished ? "Unpublished successfully!" : "Published successfully!" }));
        setTimeout(() => {
          setPublishSuccessMsg((prev) => ({ ...prev, [courseId]: "" }));
        }, 3000);
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Action failed.");
      }
    } catch (e) {
      alert("Error: " + e.message);
    } finally {
      setPublishingCourses((prev) => ({ ...prev, [courseId]: false }));
      loadCourses();
    }
  };

  const handleDeleteCourse = async (courseId) => {
    if (!window.confirm("Are you sure you want to delete this course? This will remove all modules and enrollments.")) return;
    try {
      const res = await authFetch(`/api/courses/${courseId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadCourses();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete course.");
      }
    } catch (e) {
      alert("Error deleting course: " + e.message);
    }
  };

  const handleDeleteChapter = async (chapterId) => {
    if (!window.confirm("Are you sure you want to delete this module?")) return;
    try {
      const res = await authFetch(`/api/courses/chapters/${chapterId}`, {
        method: "DELETE",
      });
      if (res.ok) {
        loadCourses();
      } else {
        const err = await res.json().catch(() => ({}));
        alert(err.detail || "Failed to delete module.");
      }
    } catch (e) {
      alert("Error deleting module: " + e.message);
    }
  };

  const TABS = [
    { key: "overview", label: "Overview" },
    { key: "courses", label: "My Courses" },
    { key: "modules", label: "Add Modules" },
    { key: "create", label: editingCourseId ? "Edit Course" : "Add Course" },
    { key: "hiring", label: "Hiring Templates" },
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
          <div className="card" style={{ maxWidth: 480, padding: "40px", textAlign: "center", backgroundColor: "var(--bg-surface)" }}>
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

  if (activeTab === "edit-chapter") {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", paddingTop: "80px" }}>
          <div className="container" style={{ maxWidth: "800px", padding: "0 24px 48px" }}>
            
            {/* Back button and title */}
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "28px" }}>
              <button 
                type="button" 
                onClick={handleCancelEditChapter}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  border: "1px solid var(--border-muted)",
                  background: "var(--bg-surface)",
                  cursor: "pointer",
                  color: "var(--text-main)",
                  transition: "background-color 0.2s"
                }}
                onMouseEnter={(e) => e.currentTarget.style.backgroundColor = "var(--bg-surface-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.backgroundColor = "var(--bg-surface)"}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="19" y1="12" x2="5" y2="12"/><polyline points="12 19 5 12 12 5"/></svg>
              </button>
              <div>
                <div style={{ fontSize: "12px", color: "var(--text-muted)", textTransform: "uppercase", fontWeight: "600", letterSpacing: "0.05em" }}>Course Module Editor</div>
                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                  Edit Module: {chapterForm.title || "Untitled"}
                </h1>
              </div>
            </div>

            {/* The Editor Card */}
            <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "32px", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-lg)" }}>
              {chapterStatus.startsWith("error:") && (
                <div style={{ color: "var(--color-danger)", marginBottom: "16px", fontSize: "13px" }}>{chapterStatus.slice(6)}</div>
              )}
              
              <form onSubmit={handleAddChapter}>
                <div className="form-group" style={{ marginBottom: "24px" }}>
                  <label className="form-label" style={{ fontWeight: "600", fontSize: "13px", marginBottom: "8px" }}>Module Title</label>
                  <input 
                    className="form-input" 
                    placeholder="e.g. Variables & Data Types" 
                    value={chapterForm.title} 
                    onChange={(e) => setChapterForm({ ...chapterForm, title: e.target.value })} 
                    required 
                    style={{ padding: "12px" }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: "24px" }}>
                  <label className="form-label" style={{ fontWeight: "600", fontSize: "13px", marginBottom: "8px" }}>Video File (Replace current video)</label>
                  <input
                    type="file"
                    accept=".mp4,.mov,.webm,.mkv"
                    onChange={handleVideoUpload}
                    disabled={uploading}
                    className="form-input"
                    style={{ padding: "10px" }}
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
                      Transcribing video audio…
                    </div>
                  )}

                  {uploadedFileName && !uploading && (
                    <div style={{ marginTop: "12px", padding: "12px", backgroundColor: "var(--bg-canvas)", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm)" }}>
                      <div style={{ fontSize: "12px", fontWeight: "600", color: "var(--text-main)" }}>
                        ✓ File: {uploadedFileName}
                      </div>
                    </div>
                  )}

                  {uploadError && (
                    <p style={{ fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>
                      ❌ {uploadError}
                    </p>
                  )}

                  {/* ── Auto-Transcript Generation ─────────────────────── */}
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
                              <div style={{ width: "100%", height: "5px", backgroundColor: "var(--border-muted)", borderRadius: "3px", overflow: "hidden" }}>
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

                <div className="form-group" style={{ marginBottom: "24px" }}>
                  <label className="form-label" style={{ fontWeight: "600", fontSize: "13px", marginBottom: "8px" }}>Article Content (markdown)</label>
                  <div style={{ marginBottom: "12px" }}>
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
                        ✓ Imported text from {articleFileName}. Review/edit below.
                      </div>
                    )}
                    {articleError && (
                      <p style={{ fontSize: "12px", color: "var(--color-danger)", marginTop: "8px" }}>❌ {articleError}</p>
                    )}
                  </div>
                  <textarea 
                    className="form-input form-textarea" 
                    placeholder="## Topic&#10;Explain key concepts..." 
                    value={chapterForm.article_content} 
                    onChange={(e) => setChapterForm({ ...chapterForm, article_content: e.target.value })} 
                    required 
                    rows={12} 
                    style={{ padding: "12px", lineHeight: "1.6", fontFamily: "inherit" }}
                  />
                </div>

                <div className="form-group" style={{ marginBottom: "32px" }}>
                  <label className="form-label" style={{ fontWeight: "600", fontSize: "13px", marginBottom: "8px" }}>Video Transcript (auto-generated — editable)</label>
                  <textarea 
                    className="form-input form-textarea" 
                    placeholder="Transcript will be generated automatically if a new video is uploaded..." 
                    value={chapterForm.video_transcript} 
                    onChange={(e) => setChapterForm({ ...chapterForm, video_transcript: e.target.value })} 
                    rows={8} 
                    style={{ padding: "12px", lineHeight: "1.6" }}
                  />
                </div>

                <div style={{ display: "flex", gap: "12px" }}>
                  <button type="submit" className="btn btn-primary" disabled={chapterStatus === "saving" || uploading || !chapterForm.youtube_url}>
                    {chapterStatus === "saving" ? "Saving Changes…" : "Save Changes"}
                  </button>
                  <button
                    type="button"
                    className="btn btn-secondary"
                    onClick={handleCancelEditChapter}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>

          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container admin-container">

          {/* Header */}
          <div style={{ marginBottom: "32px" }}>
            <div className="admin-header-flex">
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em", margin: 0 }}>
                Teacher Studio
              </h1>
              <span style={{
                fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                borderRadius: "4px", background: "var(--bg-success)", color: "var(--color-success)",
                border: "1px solid var(--border-success)", fontFamily: "JetBrains Mono",
                display: "inline-block", width: "fit-content",
              }}>
                TEACHER
              </span>
            </div>

          </div>

          {/* Tabs */}
          <div className="tabs" style={{ marginBottom: "32px" }}>
            {TABS.map((t) => (
              <div
                key={t.key}
                className={`tab ${activeTab === t.key ? "active" : ""}`}
                onClick={() => {
                  setActiveTab(t.key);
                  setSelectedCourseForStudents(null);
                  setSelectedStudentForInterviews(null);
                  if (t.key !== "create") {
                    setEditingCourseId(null);
                    setForm({ title: "", description: "", pass_threshold: 70, quiz_threshold: 70, thumbnail: "" });
                  }
                }}
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
                  <div className="card stat-card" key={i} style={{ backgroundColor: "var(--bg-surface)" }}>
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
                <div className="card" style={{ backgroundColor: "var(--bg-surface)" }}>
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
                <div className="card" style={{ backgroundColor: "var(--bg-surface)", alignSelf: "flex-start" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                    Course Progression Flow
                  </h3>
                  <ol style={{ fontSize: "13px", color: "var(--text-main)", paddingLeft: "18px", lineHeight: "1.8" }}>
                    <li>Watch video lectures</li>
                    <li>Read module documentation</li>
                    <li>Complete concept quizzes to unlock the next module</li>
                    <li>Complete the final course-wide AI interview</li>
                  </ol>
                </div>
              </div>
            </div>
          )}

          {/* Hiring Templates */}
          {activeTab === "hiring" && (
            <TeacherHiringTemplates hideNavbar={true} />
          )}

          {/* My Courses - Level 1 (Courses List) */}
          {activeTab === "courses" && !selectedCourseForStudents && (
            <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
              {courses.map((c) => (
                <div
                  key={c.id}
                  className="teacher-course-card"
                  onClick={() => {
                    setSelectedCourseForStudents(c);
                    loadCourseStudents(c.id);
                  }}
                >
                  {/* Left: Thumbnail & Title */}
                  <div className="teacher-course-card-left">
                    <div className="mono" style={{
                      width: "48px",
                      height: "48px",
                      borderRadius: "var(--radius-sm)",
                      backgroundColor: "var(--brand-muted)",
                      color: "var(--brand)",
                      display: "grid",
                      placeItems: "center",
                      fontSize: "16px",
                      fontWeight: "700",
                      flexShrink: 0
                    }}>
                      {c.title?.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <h4 style={{ margin: 0, fontSize: "16px", fontWeight: "700", color: "var(--text-title)" }}>
                        {c.title}
                      </h4>
                      <div style={{ marginTop: "6px", display: "flex", alignItems: "center", gap: "8px" }}>
                        <span className={`badge ${c.is_published ? "badge-success" : "badge-warning"}`} style={{ fontSize: "10px", padding: "2px 6px" }}>
                          {c.is_published ? "Live" : "Draft"}
                        </span>
                        {publishSuccessMsg[c.id] && (
                          <span style={{ color: "var(--color-success)", fontSize: "11px", fontWeight: "600" }}>
                            ✓ {publishSuccessMsg[c.id]}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Middle: Stats */}
                  <div className="teacher-course-card-middle">
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.05em" }}>Modules</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginTop: "2px" }} className="mono">
                        {c.chapters?.length || 0}
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.05em" }}>Students</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginTop: "2px" }} className="mono">
                        {c.student_count ?? 0}
                      </div>
                    </div>
                    <div style={{ textAlign: "center" }}>
                      <div style={{ fontSize: "11px", color: "var(--text-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", letterSpacing: "0.05em" }}>Pass Rate</div>
                      <div style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginTop: "2px" }} className="mono">
                        {c.pass_rate !== undefined && c.pass_rate !== null ? `${c.pass_rate}%` : "0%"}
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div
                    className="teacher-course-card-right"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => {
                        setSelectedCourseForStudents(c);
                        loadCourseStudents(c.id);
                      }}
                      style={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
                      Students
                    </button>
                     <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => { setSelectedCourseId(c.id); setActiveTab("modules"); }}
                      style={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="12 2 2 7 12 12 22 7 12 2" /><polyline points="2 17 12 22 22 17" /><polyline points="2 12 12 17 22 12" /></svg>
                      Modules
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handleEditCourse(c)}
                      style={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" /></svg>
                      Edit
                    </button>
                    <button
                      className="btn btn-secondary btn-sm"
                      onClick={() => handlePublish(c.id, c.is_published)}
                      disabled={publishingCourses[c.id]}
                      style={{ display: "flex", alignItems: "center", gap: "6px" }}
                    >
                      {publishingCourses[c.id] ? (
                        c.is_published ? "Drafting..." : "Publishing..."
                      ) : c.is_published ? (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 9.9-1" /></svg>
                          Draft
                        </>
                      ) : (
                        <>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.73 21a2 2 0 0 1-3.46 0" /></svg>
                          Publish
                        </>
                      )}
                    </button>
                    <button
                      className="btn btn-danger btn-sm"
                      onClick={() => handleDeleteCourse(c.id)}
                      style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "6px 8px" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /><line x1="10" y1="11" x2="10" y2="17" /><line x1="14" y1="11" x2="14" y2="17" /></svg>
                    </button>
                  </div>
                </div>
              ))}
              {courses.length === 0 && (
                <div style={{ textAlign: "center", padding: "48px", color: "var(--text-muted)", border: "1px dashed var(--border-muted)", borderRadius: "var(--radius-md)" }}>
                  No courses yet.
                </div>
              )}
            </div>
          )}

          {/* My Courses - Level 2 (Enrolled Students List) */}
          {activeTab === "courses" && selectedCourseForStudents && !selectedStudentForInterviews && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setSelectedCourseForStudents(null)}
                  style={{ padding: "6px 12px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
                >
                  ← Back to Courses
                </button>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", margin: 0 }}>
                    Students Enrolled in {selectedCourseForStudents.title}
                  </h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", marginTop: "4px" }}>
                    Select a student to view their interviews for this course.
                  </p>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => loadCourseStudents(selectedCourseForStudents.id)}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Refresh
                </button>
              </div>
              {courseStudentsLoading && (
                <SkeletonTable rows={3} cols={3} />
              )}
              {courseStudentsError && (
                <p style={{ color: "var(--color-danger)", fontSize: "13px" }}>❌ {courseStudentsError}</p>
              )}
              {!courseStudentsLoading && !courseStudentsError && courseStudents.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                  No students enrolled in this course yet.
                </p>
              )}
              {!courseStudentsLoading && !courseStudentsError && courseStudents.length > 0 && (
                <div className="table-container">
                  <table>
                    <thead>
                      <tr>
                        <th>Student Name</th>
                        <th>Email Address</th>
                        <th>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {courseStudents.map((student) => (
                        <tr
                          key={student.id}
                          style={{ cursor: "pointer" }}
                          onClick={() => {
                            setSelectedStudentForInterviews(student);
                            loadCourseRecordings(student.id, selectedCourseForStudents.id);
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
                            <button
                              className="btn btn-secondary btn-sm"
                              onClick={(e) => {
                                e.stopPropagation();
                                setSelectedStudentForInterviews(student);
                                loadCourseRecordings(student.id, selectedCourseForStudents.id);
                              }}
                            >
                              View Interviews
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
          {/* My Courses - Level 3 (Student Interviews List) */}
          {activeTab === "courses" && selectedCourseForStudents && selectedStudentForInterviews && (
            <div>
              <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px", flexWrap: "wrap" }}>
                <button
                  className="btn btn-secondary"
                  onClick={() => setSelectedStudentForInterviews(null)}
                  style={{ padding: "6px 12px", fontSize: "13px", display: "flex", alignItems: "center", gap: "6px" }}
                >
                  ← Back to Students
                </button>
                <div style={{ flex: 1, minWidth: "200px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", margin: 0 }}>
                    Interviews for {selectedStudentForInterviews.name}
                  </h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "13.5px", marginTop: "4px" }}>
                    Course: <strong style={{ color: "var(--text-title)" }}>{selectedCourseForStudents.title}</strong> · {selectedStudentForInterviews.email}
                  </p>
                </div>
                <button
                  className="btn btn-secondary"
                  onClick={() => loadCourseRecordings(selectedStudentForInterviews.id, selectedCourseForStudents.id)}
                  style={{ fontSize: "11px", padding: "4px 10px" }}
                >
                  Refresh
                </button>
              </div>
              {courseRecordingsLoading && (
                <div className="grid-2" style={{ alignItems: "start" }}>
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div key={i} className="card" style={{ padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                          <Skeleton variant="text" width="120px" height={14} />
                          <Skeleton variant="text" width="160px" height={11} />
                        </div>
                        <Skeleton variant="rectangular" width="50px" height={22} borderRadius="12px" />
                      </div>
                      <Skeleton variant="rectangular" height={160} />
                    </div>
                  ))}
                </div>
              )}
              {courseRecordingsError && (
                <p style={{ color: "var(--color-danger)", fontSize: "13px" }}>❌ {courseRecordingsError}</p>
              )}
              {!courseRecordingsLoading && !courseRecordingsError && courseRecordings.length === 0 && (
                <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>
                  No interview recordings found for this student in this course.
                </p>
              )}
              <div className="grid-2" style={{ alignItems: "start" }}>
                {courseRecordings.map((r) => (
                  <div key={r.session_id} className="card" style={{ padding: "16px", backgroundColor: "var(--bg-surface)" }}>
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
                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "8px" }}>
                      <a
                        href={r.recording_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        style={{ fontSize: "12px", color: "var(--brand)" }}
                      >
                        Open in new tab ↗
                      </a>
                    </div>

                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Add Modules */}
          {activeTab === "modules" && (
            <div className="grid-2" style={{ alignItems: "start" }}>
              <div className="card" style={{ backgroundColor: "var(--bg-surface)" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", marginBottom: "20px", textTransform: "uppercase", fontFamily: "JetBrains Mono" }}>
                  {editingChapterId ? "Edit Module" : "Add Module (Chapter)"}
                </h3>
                <div className="form-group">
                  <label className="form-label">Select Course</label>
                  <CustomSelect
                    options={courses.map((c) => ({ value: c.id, label: c.title }))}
                    value={selectedCourseId}
                    onChange={(val) => setSelectedCourseId(val)}
                    disabled={!!editingChapterId}
                    placeholder="Choose a Course..."
                  />
                </div>
                {chapterStatus === "success-add" && (
                  <div className="badge badge-success" style={{ marginBottom: "16px" }}>
                    Module added! Transcript is being fetched in the background — refresh in a moment to see status.
                  </div>
                )}
                {chapterStatus === "success-edit" && (
                  <div className="badge badge-success" style={{ marginBottom: "16px" }}>
                    Module updated successfully!
                  </div>
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
                      <div style={{ marginTop: "12px", padding: "10px", backgroundColor: "var(--bg-canvas)", border: "1px solid var(--border-muted)", borderRadius: "var(--radius-sm)" }}>
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
                  <div style={{ display: "flex", gap: "10px", flexWrap: "wrap" }}>
                    <button type="submit" className="btn btn-primary" disabled={!selectedCourseId || chapterStatus === "saving" || uploading || !chapterForm.youtube_url}>
                      {chapterStatus === "saving" ? (editingChapterId ? "Saving…" : "Adding…") : (editingChapterId ? "Save Changes" : "Add Module")}
                    </button>
                    {editingChapterId && (
                      <button
                        type="button"
                        className="btn btn-secondary"
                        onClick={handleCancelEditChapter}
                      >
                        Cancel
                      </button>
                    )}
                  </div>
                </form>
              </div>
              <div className="card" style={{ backgroundColor: "var(--bg-surface)" }}>
                <div style={{ display: "flex", alignItems: "center", marginBottom: "16px", flexWrap: "wrap", gap: "10px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", flex: 1, margin: 0, minWidth: "150px" }}>
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
                      <div style={{ display: "flex", gap: "8px", alignItems: "center", marginTop: "8px" }}>
                        <button
                          type="button"
                          className="btn btn-secondary btn-sm"
                          style={{ padding: "2px 8px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                          onClick={() => handleEditChapter(ch)}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4z" /></svg>
                          Edit
                        </button>
                        <button
                          type="button"
                          className="btn btn-danger btn-sm"
                          style={{ padding: "2px 8px", fontSize: "11px", display: "flex", alignItems: "center", gap: "4px" }}
                          onClick={() => handleDeleteChapter(ch.id)}
                        >
                          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>
                          Delete
                        </button>
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
            <div className="card" style={{ maxWidth: 680, margin: "0 auto", backgroundColor: "var(--bg-surface)" }}>
              <h3 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "20px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                {editingCourseId ? `Edit Course: ${form.title}` : "Create New Course"}
              </h3>

              {formStatus === "success" && (
                <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px", padding: "12px 16px", borderRadius: "var(--radius-sm)", background: "var(--bg-success)", border: "1px solid var(--border-success)", color: "var(--color-success)", fontSize: "13.5px", fontWeight: "600" }}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                  {editingCourseId ? "Course updated successfully!" : "Course created successfully!"}
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
                    <label className="form-label">Interview Pass Threshold (%)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0} max={100}
                      value={form.pass_threshold}
                      onChange={(e) => setForm({ ...form, pass_threshold: e.target.value })}
                    />
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Minimum score to pass the AI oral interview</p>
                  </div>
                  <div className="form-group">
                    <label className="form-label">Quiz Pass Threshold (%)</label>
                    <input
                      className="form-input"
                      type="number"
                      min={0} max={100}
                      value={form.quiz_threshold}
                      onChange={(e) => setForm({ ...form, quiz_threshold: e.target.value })}
                    />
                    <p style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "4px" }}>Minimum score to pass each module quiz</p>
                  </div>
                </div>
                 <div className="form-group">
                  <label className="form-label">Course Thumbnail</label>
                  <div style={{ display: "flex", gap: "10px", marginBottom: "12px" }}>
                    <button
                      type="button"
                      className={`btn ${thumbnailSource === "url" ? "btn-primary" : "btn-secondary"}`}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => setThumbnailSource("url")}
                    >
                      YouTube / Image URL
                    </button>
                    <button
                      type="button"
                      className={`btn ${thumbnailSource === "upload" ? "btn-primary" : "btn-secondary"}`}
                      style={{ padding: "6px 12px", fontSize: "12px" }}
                      onClick={() => setThumbnailSource("upload")}
                    >
                      Upload & Crop Image
                    </button>
                  </div>

                  {thumbnailSource === "url" ? (
                    <input
                      className="form-input"
                      placeholder="https://youtube.com/... or https://..."
                      value={form.thumbnail}
                      onChange={(e) => setForm({ ...form, thumbnail: e.target.value })}
                    />
                  ) : (
                    <div>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleThumbnailFileChange}
                        className="form-input"
                        style={{ padding: "8px 10px" }}
                        disabled={thumbnailUploading}
                      />
                      {thumbnailUploading && (
                        <p style={{ fontSize: "12px", color: "var(--brand)", marginTop: "4px" }}>
                          Uploading cropped image...
                        </p>
                      )}
                    </div>
                  )}

                  {form.thumbnail && (
                    <div style={{ marginTop: "12px" }}>
                      <label className="form-label" style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>Active Thumbnail Preview</label>
                      <div style={{ position: "relative", width: "160px", aspectRatio: "16/9", borderRadius: "var(--radius-sm)", overflow: "hidden", border: "1px solid var(--border-subtle)" }}>
                        <img
                          src={form.thumbnail}
                          alt="Course Thumbnail Preview"
                          style={{ width: "100%", height: "100%", objectFit: "cover" }}
                        />
                        <button
                          type="button"
                          style={{
                            position: "absolute",
                            top: "4px",
                            right: "4px",
                            background: "rgba(15, 23, 42, 0.8)",
                            border: "none",
                            color: "#fff",
                            borderRadius: "50%",
                            width: "20px",
                            height: "20px",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            cursor: "pointer",
                            fontSize: "12px",
                            lineHeight: 1
                          }}
                          onClick={() => setForm({ ...form, thumbnail: "" })}
                          title="Remove image"
                        >
                          &times;
                        </button>
                      </div>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", justifyContent: "flex-end", gap: "12px", marginTop: "12px" }}>
                  {editingCourseId ? (
                    <button type="button" className="btn btn-secondary" onClick={handleCancelEditCourse}>
                      Cancel
                    </button>
                  ) : (
                    <button type="button" className="btn btn-secondary" onClick={() => setForm({ title: "", description: "", pass_threshold: 70, quiz_threshold: 70, thumbnail: "" })}>
                      Clear
                    </button>
                  )}
                  <button type="submit" className="btn btn-primary" disabled={formStatus === "saving"}>
                    {formStatus === "saving" ? (editingCourseId ? "Saving…" : "Creating…") : (editingCourseId ? "Save Changes" : "Create Course")}
                  </button>
                </div>
              </form>
            </div>
          )}


        </div>
      </div>

      {cropperImageSrc && (
        <ImageCropperModal
          imageSrc={cropperImageSrc}
          onCrop={handleCropComplete}
          onClose={() => setCropperImageSrc(null)}
          aspectRatio={16 / 9}
        />
      )}
    </>
  );
}

export default withAuth(TeacherPanel, ["teacher", "admin"]);
