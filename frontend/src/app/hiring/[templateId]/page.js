"use client";
import Navbar from "@/components/Navbar";
import Skeleton from "@/components/Skeleton";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Link from "next/link";

function JobInterviewWorkspace() {
  const { templateId } = useParams();
  const { authFetch } = useAuth();
  const router = useRouter();

  // Data states
  const [job, setJob] = useState(null);
  const [state, setState] = useState({ progress: null, attempts: [] });
  const [loading, setLoading] = useState(true);

  // Active attempt and stage selection
  const [activeAttempt, setActiveAttempt] = useState(null);
  const [selectedStageType, setSelectedStageType] = useState("hr"); // hr, coding, problem_solving

  // Form modal state
  const [showAddModal, setShowAddModal] = useState(false);
  const [cvFile, setCvFile] = useState(null);
  const [jobDescription, setJobDescription] = useState("");
  const [submittingAttempt, setSubmittingAttempt] = useState(false);

  // Coding test states
  const [selectedLanguage, setSelectedLanguage] = useState("python");
  const [editorCode, setEditorCode] = useState(
    `def two_sum(nums, target):\n    # Write your code here\n    pass`
  );
  const [consoleOutput, setConsoleOutput] = useState("");
  const [runningCode, setRunningCode] = useState(false);
  const [submittingCode, setSubmittingCode] = useState(false);
  const [testCases, setTestCases] = useState(`Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]`);

  // Problem solving explanation state
  const [psSolution, setPsSolution] = useState("");
  const [submittingPs, setSubmittingPs] = useState(false);

  // Mock HR chat messages
  const [hrChat, setHrChat] = useState([
    { speaker: "hr", text: "Hello! Thank you for applying. To start off, could you tell us a bit about yourself and why you're interested in this role?" }
  ]);
  const [hrInput, setHrInput] = useState("");

  const loadData = async () => {
    try {
      // Load template details
      const jobRes = await authFetch(`/api/hiring/templates/${templateId}`);
      if (jobRes.ok) {
        const jobData = await jobRes.json();
        setJob(jobData);
      }

      // Load student progress and attempts
      const stateRes = await authFetch(`/api/hiring/templates/${templateId}/student-state`);
      if (stateRes.ok) {
        const stateData = await stateRes.json();
        setState(stateData);

        // Find active attempt (in_progress) or fallback to latest attempt
        if (stateData.attempts && stateData.attempts.length > 0) {
          const active = stateData.attempts.find((a) => a.status === "in_progress") || stateData.attempts[0];
          setActiveAttempt(active);

          // Default selected stage to first unlocked/in-progress stage
          if (active) {
            const currentStage = active.stages.find(
              (s) => s.status === "in_progress"
            ) || active.stages.find((s) => s.status === "passed") || active.stages[0];
            setSelectedStageType(currentStage?.stage_type || "hr");
          }
        }
      }
    } catch (err) {
      console.error("Failed to load interview data", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [templateId, authFetch]);

  // Handle language change, preset boilerplate
  const handleLanguageChange = (lang) => {
    setSelectedLanguage(lang);
    if (lang === "python") {
      setEditorCode(`def two_sum(nums, target):\n    # Write your code here\n    pass`);
    } else if (lang === "javascript") {
      setEditorCode(`function twoSum(nums, target) {\n    // Write your code here\n}`);
    } else if (lang === "cpp") {
      setEditorCode(`#include <vector>\nusing namespace std;\n\nclass Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        \n    }\n};`);
    } else if (lang === "golang") {
      setEditorCode(`package main\n\nfunc twoSum(nums []int, target int) []int {\n    return nil\n}`);
    }
  };

  // Mock HR chat send
  const sendHrMessage = (e) => {
    e.preventDefault();
    if (!hrInput.trim()) return;
    const studentMsg = { speaker: "student", text: hrInput };
    setHrChat((prev) => [...prev, studentMsg]);
    setHrInput("");

    // Simulate HR response
    setTimeout(() => {
      setHrChat((prev) => [
        ...prev,
        { speaker: "hr", text: "That is very insightful. How would you describe your ability to collaborate in a high-pressure environment?" }
      ]);
    }, 1000);
  };

  // Create attempt
  const handleCreateAttempt = async (e) => {
    e.preventDefault();
    setSubmittingAttempt(true);

    try {
      const formData = new FormData();
      formData.append("hiring_template_id", templateId);
      formData.append("job_description", jobDescription);
      if (cvFile) {
        formData.append("cv_file", cvFile);
      }

      const res = await authFetch("/api/hiring/attempts", {
        method: "POST",
        body: formData, // Fetch automatically sets Content-Type for FormData
      });

      if (res.ok) {
        setShowAddModal(false);
        setCvFile(null);
        setJobDescription("");
        await loadData();
      } else {
        const error = await res.json();
        alert(error.detail || "Failed to create attempt");
      }
    } catch (err) {
      console.error(err);
      alert("An error occurred starting the interview.");
    } finally {
      setSubmittingAttempt(false);
    }
  };

  // Run code mock
  const handleRunCode = () => {
    setRunningCode(true);
    setConsoleOutput("Compiling and running against test cases...");
    setTimeout(() => {
      setConsoleOutput(
        `✓ Standard Output: Compiled Successfully\n✓ Test Case 1: nums = [2,7,11,15], target = 9 | Output: [0,1] (Expected: [0,1])\n\nResult: SUCCESS (All 1 test cases passed)`
      );
      setRunningCode(false);
    }, 1500);
  };

  // Submit code
  const handleSubmitCode = async () => {
    if (!activeAttempt) return;
    const stage = activeAttempt.stages.find((s) => s.stage_type === "coding");
    if (!stage) return;

    setSubmittingCode(true);
    setConsoleOutput("Submitting code to workspace...");
    try {
      const res = await authFetch(`/api/hiring/stages/${stage.id}/submit-coding`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: selectedLanguage, code: editorCode }),
      });
      if (res.ok) {
        setConsoleOutput(
          `Submission Saved!\nLanguage: ${selectedLanguage}\n\nStatus: Saved to Attempt History\nPress "Simulate Pass" to advance to next stage.`
        );
      }
    } catch (err) {
      console.error(err);
      setConsoleOutput("Error saving code submission.");
    } finally {
      setSubmittingCode(false);
    }
  };

  // Simulate complete stage
  const handleCompleteStage = async (passed) => {
    if (!activeAttempt) return;
    const stage = activeAttempt.stages.find((s) => s.stage_type === selectedStageType);
    if (!stage) return;

    let score = passed ? 85.0 : 45.0;
    let feedback = passed 
      ? `Demonstrated excellent skills matching the requirements for this stage of ${job?.job_title}.`
      : `Struggled to provide solid details. Needs improvement.`;

    try {
      const res = await authFetch(`/api/hiring/stages/${stage.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ passed, score, feedback }),
      });

      if (res.ok) {
        await loadData();
      }
    } catch (err) {
      console.error(err);
      alert("Failed to update stage status.");
    }
  };

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ padding: "40px" }}>
            <Skeleton variant="text" width="200px" height={24} />
            <Skeleton variant="rectangular" width="100%" height={200} style={{ marginTop: "24px" }} />
          </div>
        </div>
      </>
    );
  }

  // Get active stage details
  const activeStage = activeAttempt?.stages.find((s) => s.stage_type === selectedStageType);
  const isLocked = !activeStage || activeStage.status === "locked";

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", minHeight: "100vh" }}>
        <div className="container" style={{ padding: "32px 16px" }}>
          
          {/* Breadcrumbs / Back button */}
          <Link href="/hiring" style={{ 
            display: "inline-flex", 
            alignItems: "center", 
            gap: "8px", 
            color: "var(--text-muted)", 
            textDecoration: "none",
            marginBottom: "24px",
            fontSize: "14px",
            fontWeight: "500"
          }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <line x1="19" y1="12" x2="5" y2="12" />
              <polyline points="12 19 5 12 12 5" />
            </svg>
            Back to Job Listings
          </Link>

          {/* Job Overview header */}
          <div className="card" style={{ backgroundColor: "var(--bg-surface)", marginBottom: "32px", padding: "32px" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: "20px" }}>
              <div>
                <h1 style={{ fontSize: "26px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                  {job?.job_title}
                </h1>
                <p style={{ color: "var(--text-muted)", fontSize: "14px", margin: 0 }}>
                  Interview Owner: <strong style={{ color: "var(--text-title)" }}>{job?.teacher_name}</strong>
                </p>
              </div>

              {/* Status and Action */}
              <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                    Current Progress
                  </div>
                  <div style={{ fontSize: "15px", fontWeight: "700", textTransform: "capitalize", color: 
                    state.progress?.status === "passed" ? "var(--color-success)" : 
                    state.progress?.status === "failed" ? "var(--color-danger)" : "var(--brand)"
                  }}>
                    {state.progress ? `${state.progress.current_stage.replace("_", " ")} (${state.progress.status.replace("_", " ")})` : "Not Attempted"}
                  </div>
                </div>

                <button 
                  className="btn btn-primary" 
                  onClick={() => setShowAddModal(true)}
                  style={{ display: "flex", alignItems: "center", gap: "6px" }}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <line x1="12" y1="5" x2="12" y2="19" />
                    <line x1="5" y1="12" x2="19" y2="12" />
                  </svg>
                  New Attempt
                </button>
              </div>
            </div>
          </div>

          {/* Main workspace layout */}
          <div style={{ display: "grid", gridTemplateColumns: "300px 1fr", gap: "32px", alignItems: "start" }}>
            
            {/* Left Sidebar: Attempt Selection and Stage Progress Locking */}
            <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
              
              {/* Stages List inside selected Attempt */}
              {activeAttempt ? (
                <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px" }}>
                  <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", color: "var(--text-title)", marginBottom: "16px" }}>
                    Interview Stages
                  </h3>
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {[
                      { type: "hr", label: "HR Interview", icon: "💬" },
                      { type: "coding", label: "Coding Test", icon: "💻" },
                      { type: "problem_solving", label: "Problem Solving", icon: "🧠" }
                    ].map((stg) => {
                      const dbStage = activeAttempt.stages.find((s) => s.stage_type === stg.type);
                      const isSelected = selectedStageType === stg.type;
                      
                      let statusBadge = "Locked";
                      let badgeColor = "var(--text-subtle)";
                      let badgeBg = "var(--bg-canvas)";

                      if (dbStage) {
                        if (dbStage.status === "passed") {
                          statusBadge = "Passed";
                          badgeColor = "var(--color-success)";
                          badgeBg = "var(--bg-success)";
                        } else if (dbStage.status === "failed") {
                          statusBadge = "Failed";
                          badgeColor = "var(--color-danger)";
                          badgeBg = "var(--bg-danger)";
                        } else if (dbStage.status === "in_progress") {
                          statusBadge = "In Progress";
                          badgeColor = "var(--brand)";
                          badgeBg = "var(--brand-muted)";
                        }
                      }

                      return (
                        <button
                          key={stg.type}
                          onClick={() => setSelectedStageType(stg.type)}
                          style={{
                            width: "100%",
                            padding: "14px",
                            borderRadius: "8px",
                            border: isSelected ? "1px solid var(--brand)" : "1px solid var(--border-muted)",
                            backgroundColor: isSelected ? "var(--brand-muted)" : "transparent",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "space-between",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 0.15s ease"
                          }}
                        >
                          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                            <span style={{ fontSize: "18px" }}>{stg.icon}</span>
                            <div>
                              <div style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-title)" }}>
                                {stg.label}
                              </div>
                            </div>
                          </div>
                          <span style={{
                            fontSize: "10px",
                            fontWeight: "700",
                            padding: "2px 6px",
                            borderRadius: "4px",
                            color: badgeColor,
                            backgroundColor: badgeBg,
                            border: `1px solid ${badgeColor}22`
                          }}>
                            {statusBadge}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              ) : null}

              {/* Attempt History selection */}
              <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px" }}>
                <h3 style={{ fontSize: "14px", fontWeight: "700", textTransform: "uppercase", fontFamily: "JetBrains Mono", color: "var(--text-title)", marginBottom: "16px" }}>
                  Attempt History
                </h3>
                {state.attempts.length === 0 ? (
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", margin: 0 }}>No previous attempts.</p>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                    {state.attempts.map((att, idx) => {
                      const dateStr = new Date(att.created_at).toLocaleDateString(undefined, {
                        month: "short", day: "numeric", hour: "2-digit", minute: "2-digit"
                      });
                      const isActive = activeAttempt?.id === att.id;
                      return (
                        <button
                          key={att.id}
                          onClick={() => {
                            setActiveAttempt(att);
                            // default to first active or passed stage
                            const current = att.stages.find((s) => s.status === "in_progress") || att.stages[0];
                            setSelectedStageType(current?.stage_type || "hr");
                          }}
                          style={{
                            width: "100%",
                            padding: "12px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-muted)",
                            backgroundColor: isActive ? "var(--bg-surface-hover)" : "transparent",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 0.15s ease"
                          }}
                        >
                          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "4px" }}>
                            <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)" }}>
                              Attempt #{state.attempts.length - idx}
                            </span>
                            <span style={{ 
                              fontSize: "11px", 
                              fontWeight: "600",
                              color: att.status === "passed" ? "var(--color-success)" : 
                                     att.status === "failed" ? "var(--color-danger)" : "var(--brand)"
                            }}>
                              {att.status.toUpperCase()}
                            </span>
                          </div>
                          <div style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                            {dateStr}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Right Panel: Selected Stage Playground */}
            <div style={{ minHeight: "450px" }}>
              {!activeAttempt ? (
                <div className="card" style={{ 
                  backgroundColor: "var(--bg-surface)", 
                  padding: "48px", 
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center"
                }}>
                  <div style={{ fontSize: "36px", marginBottom: "16px" }}>👋</div>
                  <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                    Start Your Application
                  </h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "400px", margin: "0 0 24px 0", lineHeight: "1.6" }}>
                    Upload your CV and copy the job description to start the hiring flow. You'll complete HR, Coding, and Problem Solving interviews sequentially.
                  </p>
                  <button className="btn btn-primary" onClick={() => setShowAddModal(true)}>
                    Start Interview
                  </button>
                </div>
              ) : isLocked ? (
                // Locked screen
                <div className="card" style={{ 
                  backgroundColor: "var(--bg-surface)", 
                  padding: "48px", 
                  textAlign: "center",
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center"
                }}>
                  <div style={{ 
                    width: "64px", 
                    height: "64px", 
                    borderRadius: "50%", 
                    backgroundColor: "var(--bg-danger)", 
                    display: "flex", 
                    alignItems: "center", 
                    justifyContent: "center",
                    marginBottom: "24px"
                  }}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--color-danger)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
                      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
                    </svg>
                  </div>
                  <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                    Stage Locked
                  </h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "14px", maxWidth: "450px", margin: "0 0 16px 0", lineHeight: "1.6" }}>
                    This stage is currently locked. You must complete and pass all previous stages in this attempt before accessing this workspace.
                  </p>
                </div>
              ) : (
                // Active / Completed Playgrounds
                <div>
                  
                  {/* Complete stage simulator banner (helpful since AI is placeholder for now) */}
                  <div style={{
                    backgroundColor: "var(--brand-muted)",
                    border: "1px solid var(--brand-border)",
                    borderRadius: "8px",
                    padding: "16px 20px",
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "24px"
                  }}>
                    <div>
                      <div style={{ fontSize: "13px", fontWeight: "700", color: "var(--brand)" }}>
                        PROGRESSION CONTROLLER
                      </div>
                      <div style={{ fontSize: "12px", color: "var(--text-main)" }}>
                        Simulate the interview scoring workflow to lock/unlock stages.
                      </div>
                    </div>
                    {activeStage.status === "in_progress" ? (
                      <div style={{ display: "flex", gap: "10px" }}>
                        <button className="btn btn-success btn-sm" onClick={() => handleCompleteStage(true)}>
                          Simulate Pass
                        </button>
                        <button className="btn btn-danger btn-sm" onClick={() => handleCompleteStage(false)}>
                          Simulate Fail
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: "12px", fontWeight: "700", color: activeStage.status === "passed" ? "var(--color-success)" : "var(--color-danger)" }}>
                        STAGE ALREADY COMPLETED: {activeStage.status.toUpperCase()}
                      </span>
                    )}
                  </div>

                  {/* HR INTERVIEW PLAYGROUND */}
                  {selectedStageType === "hr" && (
                    <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "32px" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
                        HR Behavioral Interview
                      </h2>
                      <p style={{ color: "var(--text-muted)", fontSize: "14.5px", marginBottom: "24px", lineHeight: "1.6" }}>
                        This stage evaluates your cultural fit, background, and career aspirations. Answer the questions presented by the interviewer.
                      </p>

                      {/* Mock Chat interface */}
                      <div style={{
                        border: "1px solid var(--border-muted)",
                        borderRadius: "8px",
                        backgroundColor: "var(--bg-canvas)",
                        padding: "20px",
                        height: "300px",
                        overflowY: "auto",
                        display: "flex",
                        flexDirection: "column",
                        gap: "16px",
                        marginBottom: "20px"
                      }}>
                        {hrChat.map((msg, idx) => (
                          <div 
                            key={idx} 
                            style={{
                              alignSelf: msg.speaker === "hr" ? "flex-start" : "flex-end",
                              maxWidth: "80%",
                              padding: "12px 16px",
                              borderRadius: "8px",
                              backgroundColor: msg.speaker === "hr" ? "var(--bg-surface)" : "var(--brand)",
                              color: msg.speaker === "hr" ? "var(--text-main)" : "#ffffff",
                              boxShadow: "var(--shadow-sm)",
                              border: msg.speaker === "hr" ? "1px solid var(--border-muted)" : "none",
                              fontSize: "14px"
                            }}
                          >
                            <strong>{msg.speaker === "hr" ? "HR Manager" : "You"}:</strong>
                            <p style={{ margin: "4px 0 0 0" }}>{msg.text}</p>
                          </div>
                        ))}
                      </div>

                      <form onSubmit={sendHrMessage} style={{ display: "flex", gap: "10px" }}>
                        <input
                          type="text"
                          value={hrInput}
                          onChange={(e) => setHrInput(e.target.value)}
                          placeholder="Type your response..."
                          style={{
                            flex: 1,
                            padding: "12px 16px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-subtle)",
                            backgroundColor: "var(--bg-canvas)",
                            color: "var(--text-main)"
                          }}
                        />
                        <button type="submit" className="btn btn-primary">
                          Send
                        </button>
                      </form>
                    </div>
                  )}

                  {/* CODING TEST PLAYGROUND (Leetcode style!) */}
                  {selectedStageType === "coding" && (
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "24px", alignItems: "start" }}>
                      
                      {/* Left: Question panel */}
                      <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px", height: "650px", overflowY: "auto" }}>
                        <h2 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "12px" }}>
                          Coding Question: Two Sum
                        </h2>
                        <span className="badge badge-accent" style={{ marginBottom: "20px" }}>EASY</span>

                        <div className="article-content" style={{ fontSize: "14px" }}>
                          <p>Given an array of integers <code>nums</code> and an integer <code>target</code>, return indices of the two numbers such that they add up to <code>target</code>.</p>
                          <p>You may assume that each input would have exactly one solution, and you may not use the same element twice.</p>
                          <p>You can return the answer in any order.</p>

                          <h3 style={{ fontSize: "14px", marginTop: "16px" }}>Example 1:</h3>
                          <pre style={{ padding: "12px", background: "var(--bg-canvas)", border: "1px solid var(--border-muted)", color: "var(--text-main)" }}>
                            Input: nums = [2,7,11,15], target = 9{"\n"}
                            Output: [0,1]{"\n"}
                            Explanation: Because nums[0] + nums[1] == 9, we return [0, 1].
                          </pre>

                          <h3 style={{ fontSize: "14px", marginTop: "16px" }}>Example 2:</h3>
                          <pre style={{ padding: "12px", background: "var(--bg-canvas)", border: "1px solid var(--border-muted)", color: "var(--text-main)" }}>
                            Input: nums = [3,2,4], target = 6{"\n"}
                            Output: [1,2]
                          </pre>

                          <h3 style={{ fontSize: "14px", marginTop: "16px" }}>Constraints:</h3>
                          <ul style={{ paddingLeft: "20px", marginBottom: "16px" }}>
                            <li>2 &le; nums.length &le; 10<sup>4</sup></li>
                            <li>-10<sup>9</sup> &le; nums[i] &le; 10<sup>9</sup></li>
                            <li>-10<sup>9</sup> &le; target &le; 10<sup>9</sup></li>
                            <li>Only one valid answer exists.</li>
                          </ul>
                        </div>
                      </div>

                      {/* Right: Code editor and Output panel */}
                      <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                        
                        {/* Editor card */}
                        <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "20px", height: "400px", display: "flex", flexDirection: "column" }}>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                            <span style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)" }}>Code Editor</span>
                            
                            <select
                              value={selectedLanguage}
                              onChange={(e) => handleLanguageChange(e.target.value)}
                              style={{
                                padding: "6px 12px",
                                borderRadius: "4px",
                                border: "1px solid var(--border-subtle)",
                                backgroundColor: "var(--bg-canvas)",
                                color: "var(--text-main)",
                                fontSize: "12px",
                                outline: "none"
                              }}
                            >
                              <option value="python">Python 3</option>
                              <option value="javascript">JavaScript</option>
                              <option value="cpp">C++</option>
                              <option value="golang">Go</option>
                            </select>
                          </div>

                          <textarea
                            value={editorCode}
                            onChange={(e) => setEditorCode(e.target.value)}
                            style={{
                              flex: 1,
                              width: "100%",
                              padding: "16px",
                              fontFamily: "JetBrains Mono, Courier New, monospace",
                              fontSize: "13px",
                              backgroundColor: "var(--bg-canvas)",
                              color: "var(--text-main)",
                              border: "1px solid var(--border-muted)",
                              borderRadius: "6px",
                              resize: "none",
                              lineHeight: "1.5",
                              outline: "none"
                            }}
                          />

                          <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px", marginTop: "12px" }}>
                            <button className="btn btn-secondary btn-sm" onClick={handleRunCode} disabled={runningCode}>
                              {runningCode ? "Running..." : "Run Code"}
                            </button>
                            <button className="btn btn-primary btn-sm" onClick={handleSubmitCode} disabled={submittingCode}>
                              {submittingCode ? "Submitting..." : "Submit Code"}
                            </button>
                          </div>
                        </div>

                        {/* Test case and Console output */}
                        <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "20px", height: "230px", display: "flex", flexDirection: "column" }}>
                          <h3 style={{ fontSize: "13px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px", textTransform: "uppercase", letterSpacing: "0.05em" }}>
                            Console / Output
                          </h3>
                          <pre style={{
                            flex: 1,
                            backgroundColor: "var(--bg-canvas)",
                            padding: "12px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-muted)",
                            color: consoleOutput ? "var(--text-main)" : "var(--text-muted)",
                            fontFamily: "JetBrains Mono, monospace",
                            fontSize: "12px",
                            overflowY: "auto",
                            margin: 0,
                            whiteSpace: "pre-wrap"
                          }}>
                            {consoleOutput || "Execute code to view test case outputs..."}
                          </pre>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* PROBLEM SOLVING INTERVIEW PLAYGROUND */}
                  {selectedStageType === "problem_solving" && (
                    <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "32px" }}>
                      <h2 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "16px" }}>
                        Technical Problem Solving Interview
                      </h2>
                      <p style={{ color: "var(--text-muted)", fontSize: "14.5px", marginBottom: "24px", lineHeight: "1.6" }}>
                        This stage tests your architectural, debugging, and system design skills.
                      </p>

                      <div style={{
                        padding: "20px",
                        backgroundColor: "var(--bg-canvas)",
                        border: "1px solid var(--border-muted)",
                        borderRadius: "8px",
                        marginBottom: "24px"
                      }}>
                        <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                          System Design Scenario:
                        </h4>
                        <p style={{ fontSize: "13.5px", color: "var(--text-main)", margin: 0, lineHeight: "1.6" }}>
                          Design a scalable real-time notification service that can handle bursts of 50,000 notifications per second, supporting push, email, and SMS notifications. Describe your database choices, message broker setup, and horizontal scaling strategy.
                        </p>
                      </div>

                      <div style={{ marginBottom: "20px" }}>
                        <label style={{ display: "block", fontSize: "13px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                          Your Design Architecture / Solution:
                        </label>
                        <textarea
                          value={psSolution}
                          onChange={(e) => setPsSolution(e.target.value)}
                          placeholder="Outline your database schemas, queues, worker pools, etc..."
                          style={{
                            width: "100%",
                            height: "180px",
                            padding: "16px",
                            borderRadius: "6px",
                            border: "1px solid var(--border-subtle)",
                            backgroundColor: "var(--bg-canvas)",
                            color: "var(--text-main)",
                            fontSize: "14px",
                            resize: "none",
                            outline: "none"
                          }}
                        />
                      </div>

                      <div style={{ display: "flex", justifyContent: "flex-end" }}>
                        <button 
                          className="btn btn-primary" 
                          onClick={() => {
                            setSubmittingPs(true);
                            setTimeout(() => {
                              alert("Solution submitted! Use the simulator banner above to finalize the stage.");
                              setSubmittingPs(false);
                            }, 1000);
                          }}
                          disabled={submittingPs || !psSolution.trim()}
                        >
                          {submittingPs ? "Submitting..." : "Submit Solution"}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Feedback display (if stage passed/failed) */}
                  {activeStage && activeStage.status !== "in_progress" && (
                    <div className="card" style={{ backgroundColor: "var(--bg-surface)", padding: "24px", marginTop: "24px", borderLeft: activeStage.status === "passed" ? "4px solid var(--color-success)" : "4px solid var(--color-danger)" }}>
                      <h4 style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>
                        Stage Evaluation Feedback
                      </h4>
                      <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
                        <span style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-muted)" }}>
                          Score:
                        </span>
                        <strong style={{ fontSize: "16px", color: activeStage.status === "passed" ? "var(--color-success)" : "var(--color-danger)" }}>
                          {activeStage.score}%
                        </strong>
                      </div>
                      <p style={{ color: "var(--text-main)", fontSize: "13.5px", margin: 0, lineHeight: "1.5" }}>
                        {activeStage.feedback}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Add Attempt Modal */}
      {showAddModal && (
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
        }} onClick={() => setShowAddModal(false)}>
          <div style={{
            backgroundColor: "var(--bg-surface)",
            borderRadius: "12px",
            border: "1px solid var(--border-muted)",
            width: "100%",
            maxWidth: "500px",
            padding: "32px",
            boxShadow: "var(--shadow-lg)",
            position: "relative"
          }} onClick={(e) => e.stopPropagation()}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "20px" }}>
              <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                Start New Interview Attempt
              </h3>
              <button 
                onClick={() => setShowAddModal(false)}
                style={{ background: "transparent", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "24px", lineHeight: 1 }}
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleCreateAttempt} style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
              
              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", marginBottom: "6px" }}>
                  Upload CV (PDF, DOCX)
                </label>
                <input
                  type="file"
                  accept=".pdf,.doc,.docx"
                  onChange={(e) => setCvFile(e.target.files[0])}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-canvas)",
                    color: "var(--text-main)",
                    fontSize: "13px"
                  }}
                  required
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "13px", fontWeight: "600", color: "var(--text-muted)", marginBottom: "6px" }}>
                  Job Description
                </label>
                <textarea
                  value={jobDescription}
                  onChange={(e) => setJobDescription(e.target.value)}
                  placeholder="Paste the target job description here..."
                  style={{
                    width: "100%",
                    height: "120px",
                    padding: "12px",
                    borderRadius: "6px",
                    border: "1px solid var(--border-subtle)",
                    backgroundColor: "var(--bg-canvas)",
                    color: "var(--text-main)",
                    fontSize: "13px",
                    resize: "none",
                    outline: "none"
                  }}
                  required
                />
              </div>

              <div style={{ display: "flex", justifyContent: "flex-end", gap: "10px" }}>
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAddModal(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary btn-sm" disabled={submittingAttempt}>
                  {submittingAttempt ? "Starting..." : "Start Attempt"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

export default withAuth(JobInterviewWorkspace, ["student"]);
