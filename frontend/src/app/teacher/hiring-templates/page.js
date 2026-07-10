"use client";
import Navbar from "@/components/Navbar";
import Skeleton from "@/components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useEffect, useState } from "react";

export function TeacherHiringTemplates({ hideNavbar = false }) {
  const { authFetch } = useAuth();
  
  // Navigation states: 'list' | 'detail' | 'student-detail'
  const [view, setView] = useState("list");
  
  // Data lists
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);

  // Selection states
  const [selectedTemplate, setSelectedTemplate] = useState(null);
  const [studentsAtStage, setStudentsAtStage] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(false);
  const [selectedStudentId, setSelectedStudentId] = useState(null);
  const [studentDetail, setStudentDetail] = useState(null);
  const [studentDetailLoading, setStudentDetailLoading] = useState(false);

  // Template creation state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newJobTitle, setNewJobTitle] = useState("");
  const [creating, setCreating] = useState(false);

  // Load templates
  const loadTemplates = async () => {
    try {
      const res = await authFetch("/api/hiring/templates");
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
      }
    } catch (err) {
      console.error("Failed to fetch templates", err);
    } finally {
      setLoading(false);
    }
  };

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadTemplates();
  }, [authFetch]);

  // Load all students for template
  const loadAllStudentsForTemplate = async (templateId) => {
    setStudentsLoading(true);
    try {
      const res = await authFetch(`/api/hiring/templates/${templateId}/students`);
      if (res.ok) {
        const data = await res.json();
        setStudentsAtStage(data);
      }
    } catch (err) {
      console.error("Failed to load students for template", err);
    } finally {
      setStudentsLoading(false);
    }
  };

  // Load detailed student progress and submissions
  const loadStudentDetail = async (templateId, studentId) => {
    setStudentDetailLoading(true);
    try {
      const res = await authFetch(`/api/hiring/templates/${templateId}/students/${studentId}`);
      if (res.ok) {
        const data = await res.json();
        setStudentDetail(data);
      }
    } catch (err) {
      console.error("Failed to load student details", err);
    } finally {
      setStudentDetailLoading(false);
    }
  };

  // Select a template
  const handleSelectTemplate = (template) => {
    setSelectedTemplate(template);
    setView("detail");
    loadAllStudentsForTemplate(template.id);
  };

  // Select student to view details
  const handleSelectStudent = (studentId) => {
    setSelectedStudentId(studentId);
    setView("student-detail");
    if (selectedTemplate) {
      loadStudentDetail(selectedTemplate.id, studentId);
    }
  };

  // Create new template
  const handleCreateTemplate = async (e) => {
    e.preventDefault();
    if (!newJobTitle.trim()) return;
    setCreating(true);
    try {
      const res = await authFetch("/api/hiring/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ job_title: newJobTitle.trim() }),
      });
      if (res.ok) {
        setNewJobTitle("");
        setShowCreateModal(false);
        await loadTemplates();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to create template");
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return (
      <>
        {!hideNavbar && <Navbar />}
        <div className={hideNavbar ? "" : "page-container"} style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className={hideNavbar ? "" : "container"} style={{ padding: hideNavbar ? "0" : "40px" }}>
            <Skeleton variant="text" width="200px" height={24} />
            <Skeleton variant="rectangular" width="100%" height={250} style={{ marginTop: "24px" }} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      {!hideNavbar && <Navbar />}
      <div className={hideNavbar ? "" : "page-container"} style={{ backgroundColor: "var(--bg-canvas)", minHeight: hideNavbar ? "auto" : "100vh" }}>
        <div className={hideNavbar ? "" : "container"} style={{ padding: hideNavbar ? "0" : "48px 32px" }}>
          
          {/* VIEW 1: TEMPLATE LISTINGS */}
          {view === "list" && (
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "32px" }}>
                <div>
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "4px" }}>
                    <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em" }}>
                      Hiring Templates
                    </h1>
                    <span style={{
                      fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                      borderRadius: "4px", background: "var(--bg-success)", color: "var(--color-success)",
                      border: "1px solid var(--border-success)", fontFamily: "JetBrains Mono",
                    }}>
                      TEACHER PANEL
                    </span>
                  </div>
                  <p style={{ color: "var(--text-muted)", fontSize: "14px" }}>
                    Create and manage hiring stages, view applicant records, and review coding and problem-solving solutions.
                  </p>
                </div>
                <button 
                  className="btn btn-primary" 
                  onClick={() => setShowCreateModal(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  Create Template
                </button>
              </div>

              {templates.length === 0 ? (
                <div className="empty-state" style={{ padding: "48px", textAlign: "center", backgroundColor: "var(--bg-surface)", border: "1px dashed var(--border-muted)", borderRadius: "12px" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: "14px", margin: 0 }}>No hiring templates exist. Click Create Template to add one.</p>
                </div>
              ) : (
                <div className="grid-3">
                  {templates.map((tpl) => (
                    <div className="card" key={tpl.id} style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", height: "100%", backgroundColor: "var(--bg-surface)" }}>
                      <div>
                        <div style={{ display: "flex", gap: "12px", alignItems: "center", marginBottom: "16px" }}>
                          <div style={{ fontSize: "20px", width: "40px", height: "40px", border: "1px solid var(--border-muted)", backgroundColor: "var(--bg-canvas)", display: "grid", placeItems: "center", borderRadius: "var(--radius-sm)" }}>
                            💼
                          </div>
                          <div>
                            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)" }}>{tpl.job_title}</h3>
                            <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>Owner: {tpl.teacher_name}</span>
                          </div>
                        </div>
                      </div>
                      <div style={{ borderTop: "1px solid var(--border-muted)", paddingTop: "16px", marginTop: "12px" }}>
                        <button className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "center" }} onClick={() => handleSelectTemplate(tpl)}>
                          Open Template Details
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* VIEW 2: TEMPLATE DETAILS & STAGES */}
          {view === "detail" && selectedTemplate && (
            <div>
              <button 
                onClick={() => setView("list")}
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "6px", 
                  color: "var(--text-muted)", 
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  marginBottom: "24px",
                  fontSize: "14px",
                  fontWeight: "500"
                }}
              >
                &larr; Back to Templates
              </button>

              <div style={{ marginBottom: "32px" }}>
                <h1 style={{ fontSize: "24px", fontWeight: "700", color: "var(--text-title)", marginBottom: "4px" }}>
                  {selectedTemplate.job_title}
                </h1>
                <p style={{ color: "var(--text-muted)", fontSize: "13.5px", margin: 0 }}>
                  View candidate applications, their current interview stage, and detailed submission history.
                </p>
              </div>

              {/* All candidates list */}
              <h2 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono" }}>
                All Candidates
              </h2>

              {studentsLoading ? (
                <Skeleton variant="rectangular" width="100%" height={150} />
              ) : studentsAtStage.length === 0 ? (
                <div className="empty-state" style={{ padding: "32px", textAlign: "center", backgroundColor: "var(--bg-surface)", border: "1px dashed var(--border-muted)", borderRadius: "8px" }}>
                  <p style={{ color: "var(--text-muted)", fontSize: "13.5px", margin: 0 }}>No students have reached or attempted this interview stage yet.</p>
                </div>
              ) : (
                <div className="card" style={{ padding: 0, overflow: "hidden", backgroundColor: "var(--bg-surface)" }}>
                  <table style={{ width: "100%", borderCollapse: "collapse", textAlign: "left", fontSize: "14px" }}>
                    <thead>
                      <tr style={{ borderBottom: "1px solid var(--border-muted)", backgroundColor: "var(--bg-surface-hover)" }}>
                        <th style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>Student Name</th>
                        <th style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>Email Address</th>
                        <th style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>Current Stage</th>
                        <th style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>Overall Status</th>
                        <th style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {studentsAtStage.map((p) => (
                        <tr key={p.id} style={{ borderBottom: "1px solid var(--border-muted)" }}>
                          <td style={{ padding: "16px 20px", fontWeight: "600", color: "var(--text-title)" }}>{p.student_name}</td>
                          <td style={{ padding: "16px 20px", color: "var(--text-muted)" }}>{p.student_email}</td>
                          <td style={{ padding: "16px 20px", textTransform: "capitalize" }}>
                            {p.current_stage === "hr" ? "HR Interview" : 
                             p.current_stage === "coding" ? "Coding Test" : 
                             p.current_stage === "problem_solving" ? "Problem Solving" : 
                             p.current_stage === "completed" ? "Job Selection / Completed" : p.current_stage.replace("_", " ")}
                          </td>
                          <td style={{ padding: "16px 20px" }}>
                            <span style={{
                              fontSize: "11px", fontWeight: "700", padding: "2px 8px", borderRadius: "4px",
                              color: p.status === "passed" ? "var(--color-success)" : 
                                     p.status === "failed" ? "var(--color-danger)" : "var(--brand)",
                              backgroundColor: p.status === "passed" ? "var(--bg-success)" : 
                                              p.status === "failed" ? "var(--bg-danger)" : "var(--brand-muted)"
                            }}>
                              {p.status.toUpperCase()}
                            </span>
                          </td>
                          <td style={{ padding: "16px 20px" }}>
                            <button className="btn btn-secondary btn-sm" onClick={() => handleSelectStudent(p.user_id)}>
                              View Submissions & Details
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

          {/* VIEW 3: STUDENT INTERVIEW SUBMISSIONS DETAILS */}
          {view === "student-detail" && selectedTemplate && (
            <div>
              <button 
                onClick={() => setView("detail")}
                style={{ 
                  display: "inline-flex", 
                  alignItems: "center", 
                  gap: "6px", 
                  color: "var(--text-muted)", 
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  marginBottom: "24px",
                  fontSize: "14px",
                  fontWeight: "500"
                }}
              >
                &larr; Back to Candidate List
              </button>

              {studentDetailLoading ? (
                <Skeleton variant="rectangular" width="100%" height={300} />
              ) : !studentDetail ? (
                <div>Failed to load candidate details.</div>
              ) : (
                <div style={{ display: "grid", gridTemplateColumns: "1fr 2fr", gap: "32px", alignItems: "start" }}>
                  
                  {/* Student Info Card */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    
                    {/* Information */}
                    <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px" }}>
                      <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
                        Candidate Profile
                      </h3>
                      <div style={{ display: "flex", flexDirection: "column", gap: "12px", fontSize: "13.5px" }}>
                        <div>
                          <span style={{ color: "var(--text-muted)", display: "block" }}>Full Name</span>
                          <strong style={{ color: "var(--text-title)" }}>{studentDetail.student_name}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)", display: "block" }}>Email</span>
                          <strong style={{ color: "var(--text-title)" }}>{studentDetail.student_email}</strong>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)", display: "block" }}>Current Stage reached</span>
                          <span style={{ textTransform: "capitalize", fontWeight: "600" }}>
                            {studentDetail.current_stage.replace("_", " ")}
                          </span>
                        </div>
                        <div>
                          <span style={{ color: "var(--text-muted)", display: "block" }}>Status</span>
                          <span style={{
                            fontSize: "10px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px",
                            color: studentDetail.progress_status === "passed" ? "var(--color-success)" : 
                                   studentDetail.progress_status === "failed" ? "var(--color-danger)" : "var(--brand)",
                            backgroundColor: studentDetail.progress_status === "passed" ? "var(--bg-success)" : 
                                            studentDetail.progress_status === "failed" ? "var(--bg-danger)" : "var(--brand-muted)"
                          }}>
                            {studentDetail.progress_status.toUpperCase()}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* All attempts history list */}
                    <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px" }}>
                      <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
                        Attempt History
                      </h3>
                      {studentDetail.attempts.length === 0 ? (
                        <p style={{ color: "var(--text-muted)", fontSize: "13px" }}>No attempts found.</p>
                      ) : (
                        <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                          {studentDetail.attempts.map((att, idx) => (
                            <div key={att.id} style={{
                              padding: "12px", border: "1px solid var(--border-muted)", borderRadius: "6px",
                              backgroundColor: "var(--bg-canvas)"
                            }}>
                              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                                <strong style={{ fontSize: "13px", color: "var(--text-title)" }}>
                                  Attempt #{studentDetail.attempts.length - idx}
                                </strong>
                                <span style={{ 
                                  fontSize: "11px", fontWeight: "700",
                                  color: att.status === "passed" ? "var(--color-success)" : 
                                         att.status === "failed" ? "var(--color-danger)" : "var(--brand)"
                                }}>
                                  {att.status.toUpperCase()}
                                </span>
                              </div>
                              <div style={{ fontSize: "11px", color: "var(--text-muted)", marginBottom: "8px" }}>
                                {new Date(att.created_at).toLocaleDateString()}
                              </div>
                              
                              {/* CV link if exists */}
                              {att.cv_url && (
                                <a href={att.cv_url} target="_blank" rel="noreferrer" style={{ fontSize: "12px", color: "var(--brand)", textDecoration: "none", fontWeight: "600", display: "block" }}>
                                  📄 Download CV: {att.cv_name || "View File"}
                                </a>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Submission Details */}
                  <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
                    
                    {/* Latest attempt data */}
                    {studentDetail.attempts.length > 0 ? (
                      (() => {
                        const latestAttempt = studentDetail.attempts[0];
                        return (
                          <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "28px" }}>
                            <h2 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "20px" }}>
                              Latest Interview Details (Attempt #{studentDetail.attempts.length})
                            </h2>

                            <div style={{ marginBottom: "20px" }}>
                              <h4 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: "6px" }}>
                                Target Job Description
                              </h4>
                              <div style={{
                                padding: "14px", backgroundColor: "var(--bg-canvas)", border: "1px solid var(--border-muted)",
                                borderRadius: "6px", fontSize: "13px", color: "var(--text-main)", whiteSpace: "pre-wrap",
                                maxHeight: "150px", overflowY: "auto"
                              }}>
                                {latestAttempt.job_description || "No description provided."}
                              </div>
                            </div>

                            {/* Display each of the 3 stages */}
                            <div style={{ display: "flex", flexDirection: "column", gap: "24px", marginTop: "28px" }}>
                              {latestAttempt.stages.map((stg) => {
                                return (
                                  <div key={stg.id} style={{
                                    padding: "20px", border: "1px solid var(--border-muted)", borderRadius: "8px"
                                  }}>
                                    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                                      <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", textTransform: "capitalize", margin: 0 }}>
                                        {stg.stage_type.replace("_", " ")} Stage
                                      </h3>
                                      <span style={{
                                        fontSize: "11px", fontWeight: "700", padding: "2px 6px", borderRadius: "4px",
                                        color: stg.status === "passed" ? "var(--color-success)" : 
                                               stg.status === "failed" ? "var(--color-danger)" : 
                                               stg.status === "in_progress" ? "var(--brand)" : "var(--text-subtle)",
                                        backgroundColor: stg.status === "passed" ? "var(--bg-success)" : 
                                                        stg.status === "failed" ? "var(--bg-danger)" : 
                                                        stg.status === "in_progress" ? "var(--brand-muted)" : "var(--bg-canvas)",
                                        border: `1px solid var(--border-muted)`
                                      }}>
                                        {stg.status.toUpperCase()}
                                      </span>
                                    </div>

                                    {/* Score & Feedback if graded */}
                                    {stg.status !== "locked" && stg.status !== "in_progress" && (
                                      <div style={{ marginBottom: "12px", display: "flex", gap: "20px", fontSize: "13px" }}>
                                        <div>
                                          <span style={{ color: "var(--text-muted)" }}>Score: </span>
                                          <strong style={{ color: "var(--text-title)" }}>{stg.score}%</strong>
                                        </div>
                                        <div>
                                          <span style={{ color: "var(--text-muted)" }}>Feedback: </span>
                                          <span style={{ color: "var(--text-main)" }}>{stg.feedback}</span>
                                        </div>
                                      </div>
                                    )}

                                    {/* Placeholder UI showing student entries */}
                                    {stg.status === "locked" ? (
                                      <div style={{ fontSize: "12.5px", color: "var(--text-subtle)", fontStyle: "italic" }}>
                                        Locked. Candidates cannot access this stage.
                                      </div>
                                    ) : stg.status === "in_progress" ? (
                                      <div style={{ fontSize: "12.5px", color: "var(--brand)", fontStyle: "italic" }}>
                                        In progress. Candidate is currently active at this stage.
                                      </div>
                                    ) : (
                                      // Render their submissions
                                      <div style={{ marginTop: "12px" }}>
                                        
                                        {/* HR CHAT PLACEHOLDER */}
                                        {stg.stage_type === "hr" && (
                                          <div>
                                            <span style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", marginBottom: "4px" }}>
                                              Interview Transcript
                                            </span>
                                            <div style={{
                                              padding: "10px 14px", backgroundColor: "var(--bg-canvas)", borderRadius: "6px",
                                              border: "1px solid var(--border-muted)", fontSize: "12.5px", fontStyle: "italic"
                                            }}>
                                              * Mock Conversation Completed *
                                              <p style={{ margin: "4px 0 0 0", color: "var(--text-main)" }}>
                                                Student completed the behavioral interview successfully.
                                              </p>
                                            </div>
                                          </div>
                                        )}

                                        {/* CODING SUBMISSION DISPLAY */}
                                        {stg.stage_type === "coding" && (
                                          <div>
                                            <span style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", marginBottom: "4px" }}>
                                              Coding Submission
                                            </span>
                                            {stg.submissions && stg.submissions.length > 0 ? (
                                              <div>
                                                <div style={{ fontSize: "12px", color: "var(--text-muted)", marginBottom: "4px" }}>
                                                  Language: <strong style={{ textTransform: "capitalize" }}>{stg.submissions[0].language}</strong>
                                                </div>
                                                <pre style={{
                                                  padding: "14px", backgroundColor: "#1e293b", color: "#f8fafc",
                                                  borderRadius: "6px", overflowX: "auto", fontSize: "12px",
                                                  fontFamily: "JetBrains Mono, monospace"
                                                }}>
                                                  {stg.submissions[0].code}
                                                </pre>
                                              </div>
                                            ) : (
                                              <div style={{ fontSize: "12.5px", color: "var(--text-muted)" }}>
                                                No specific code submission saved. (Simulation passed).
                                              </div>
                                            )}
                                          </div>
                                        )}

                                        {/* PROBLEM SOLVING SOLUTION DISPLAY */}
                                        {stg.stage_type === "problem_solving" && (
                                          <div>
                                            <span style={{ display: "block", fontSize: "12px", fontWeight: "700", color: "var(--text-muted)", marginBottom: "4px" }}>
                                              Architecture Response
                                            </span>
                                            <div style={{
                                              padding: "14px", backgroundColor: "var(--bg-canvas)", border: "1px solid var(--border-muted)",
                                              borderRadius: "6px", fontSize: "13px", color: "var(--text-main)", whiteSpace: "pre-wrap"
                                            }}>
                                              {stg.feedback ? `Candidate solution matches required standards.` : "No response logged."}
                                            </div>
                                          </div>
                                        )}

                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        );
                      })()
                    ) : (
                      <div className="card">No attempts to display.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

        </div>
      </div>

      {/* Create Template Modal */}
      {showCreateModal && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.75)",
          backdropFilter: "blur(4px)",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          zIndex: 10000,
          padding: "20px"
        }} onClick={() => setShowCreateModal(false)}>
          <div style={{
            backgroundColor: "var(--bg-surface)",
            borderRadius: "12px",
            border: "1px solid var(--border-muted)",
            width: "100%",
            maxWidth: "400px",
            padding: "32px",
            boxShadow: "var(--shadow-lg)",
            position: "relative"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                Create Hiring Template
              </h3>
              <button 
                onClick={() => setShowCreateModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "24px", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateTemplate} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", marginBottom: "6px" }}>
                  Job Title
                </label>
                <input
                  type="text"
                  value={newJobTitle}
                  onChange={(e) => setNewJobTitle(e.target.value)}
                  placeholder="e.g. Senior Frontend Engineer"
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-canvas)",
                    color: "var(--text-main)",
                    fontSize: "14px",
                    outline: "none"
                  }}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowCreateModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={creating}>
                  {creating ? "Creating..." : "Create"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default withAuth(TeacherHiringTemplates, ["teacher", "admin"]);
