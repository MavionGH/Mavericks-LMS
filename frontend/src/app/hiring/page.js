"use client";
import Navbar from "@/components/Navbar";
import Skeleton, { SkeletonCardGrid } from "@/components/Skeleton";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useEffect, useState } from "react";

function StudentHiringTemplates() {
  const { authFetch } = useAuth();
  const [jobs, setJobs] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadJobs() {
      try {
        const res = await authFetch("/api/hiring/templates");
        if (res.ok) {
          const data = await res.json();
          setJobs(data);
        }
      } catch (err) {
        console.error("Failed to load hiring templates", err);
      } finally {
        setLoading(false);
      }
    }
    loadJobs();
  }, [authFetch]);

  if (loading) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
          <div className="container" style={{ paddingTop: "40px", paddingBottom: "40px" }}>
            <div style={{ marginBottom: "28px" }}>
              <Skeleton variant="text" width="240px" height={28} />
              <Skeleton variant="text" width="340px" height={16} style={{ marginTop: "8px" }} />
            </div>
            <SkeletonCardGrid count={3} />
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", minHeight: "100vh" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          {/* Header */}
          <div style={{ marginBottom: "40px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "8px" }}>
              <h1 style={{ fontSize: "28px", fontWeight: "700", color: "var(--text-title)", letterSpacing: "-0.02em" }}>
                Hiring Interviews
              </h1>
              <span style={{
                fontSize: "11px", fontWeight: "600", padding: "3px 8px",
                borderRadius: "4px", background: "var(--brand-muted)", color: "var(--brand)",
                border: "1px solid var(--brand-border)", fontFamily: "JetBrains Mono",
              }}>
                CAREERS
              </span>
            </div>
            <p style={{ color: "var(--text-muted)", fontSize: "15px", maxWidth: "600px", lineHeight: "1.6" }}>
              Attempt mock interviews for open positions. The hiring process consists of three stages: 
              an HR Interview, a Coding Test, and a Problem Solving Interview.
            </p>
          </div>

          {/* Job Selection Grid */}
          <div style={{ marginBottom: "24px" }}>
            <h2 style={{ 
              fontSize: "13px", 
              fontWeight: "700", 
              color: "var(--text-title)", 
              marginBottom: "20px", 
              textTransform: "uppercase", 
              letterSpacing: "0.08em", 
              fontFamily: "JetBrains Mono" 
            }}>
              Available Job Openings
            </h2>
          </div>

          {jobs.length === 0 ? (
            <div className="empty-state" style={{ 
              padding: "48px", 
              textAlign: "center", 
              backgroundColor: "var(--bg-surface)", 
              border: "1px dashed var(--border-muted)", 
              borderRadius: "12px" 
            }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "16px", opacity: 0.7 }}>
                <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
              </svg>
              <p style={{ color: "var(--text-muted)", fontSize: "14px", margin: 0 }}>No hiring templates have been created by teachers yet.</p>
            </div>
          ) : (
            <div className="grid-3">
              {jobs.map((job) => (
                <div 
                  className="card" 
                  key={job.id} 
                  style={{ 
                    display: "flex", 
                    flexDirection: "column", 
                    justifyContent: "space-between", 
                    height: "100%", 
                    backgroundColor: "var(--bg-surface)",
                    transition: "transform 0.2s ease, box-shadow 0.2s ease",
                    padding: "28px"
                  }}
                >
                  <div>
                    <div style={{ 
                      width: "48px", 
                      height: "48px", 
                      borderRadius: "10px", 
                      backgroundColor: "var(--brand-muted)", 
                      display: "flex", 
                      alignItems: "center", 
                      justifyContent: "center", 
                      marginBottom: "20px",
                      border: "1px solid var(--brand-border)"
                    }}>
                      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="2" y="7" width="20" height="14" rx="2" ry="2" />
                        <path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" />
                      </svg>
                    </div>

                    <h3 style={{ 
                      fontSize: "18px", 
                      fontWeight: "700", 
                      color: "var(--text-title)", 
                      marginBottom: "8px",
                      lineHeight: "1.3"
                    }}>
                      {job.job_title}
                    </h3>

                    <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "20px" }}>
                      <span style={{ fontSize: "13px", color: "var(--text-muted)" }}>Posted by:</span>
                      <strong style={{ fontSize: "13px", color: "var(--text-title)", fontWeight: "600" }}>{job.teacher_name}</strong>
                    </div>
                  </div>

                  <div style={{ borderTop: "1px solid var(--border-muted)", paddingTop: "20px", marginTop: "12px" }}>
                    <Link 
                      href={`/hiring/${job.id}`} 
                      className="btn btn-primary" 
                      style={{ width: "100%", justifyContent: "center", display: "flex", fontSize: "14px" }}
                    >
                      Start Interview Flow
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

export default withAuth(StudentHiringTemplates, ["student"]);
