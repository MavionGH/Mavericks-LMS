"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import Script from "next/script";
import { useState, useEffect, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  // Google OAuth specific states
  const [googleCredential, setGoogleCredential] = useState("");
  const [showRoleModal, setShowRoleModal]       = useState(false);
  const [roleLoading, setRoleLoading]           = useState(false);
  const [selectedRole, setSelectedRole]         = useState(null); // 'student' | 'teacher'

  const { login, loginWithGoogle, user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect already-authenticated users to their panel
  useEffect(() => {
    if (!authLoading && user) {
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.replace(panelMap[user.role] || "/dashboard");
    }
  }, [user, authLoading, router]);

  const handleGoogleCallback = useCallback(async (response) => {
    setError("");
    setLoading(true);
    try {
      const res = await loginWithGoogle(response.credential);
      if (res && res.status === "needs_role") {
        setGoogleCredential(response.credential);
        setShowRoleModal(true);
      } else if (res) {
        const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
        router.push(panelMap[res.role] || "/dashboard");
      }
    } catch (err) {
      setError(err.message || "Google authentication failed");
    } finally {
      setLoading(false);
    }
  }, [loginWithGoogle, router]);

  // Always invoke the latest callback from the GSI init below without forcing the
  // init effect to re-run (which would re-render the button) when it changes.
  const googleCallbackRef = useRef(handleGoogleCallback);
  useEffect(() => { googleCallbackRef.current = handleGoogleCallback; }, [handleGoogleCallback]);

  // Initialize Google Sign-In button once GSI script is loaded
  useEffect(() => {
    /* global google */
    const initGoogleSignIn = () => {
      if (typeof window !== "undefined" && window.google) {
        try {
          google.accounts.id.initialize({
            client_id: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "1234567890-placeholder.apps.googleusercontent.com",
            callback: (resp) => googleCallbackRef.current(resp),
          });
          google.accounts.id.renderButton(
            document.getElementById("google-signin-button"),
            { 
              theme: "outline", 
              size: "large", 
              width: "100%",
              text: "signin_with",
              shape: "rectangular"
            }
          );
        } catch (err) {
          console.error("Failed to initialize Google Sign-In:", err);
        }
      }
    };

    // Check if script is already loaded
    if (typeof window !== "undefined" && window.google) {
      initGoogleSignIn();
    } else {
      // Set an interval to check for google object
      const checkGoogleInterval = setInterval(() => {
        if (typeof window !== "undefined" && window.google) {
          initGoogleSignIn();
          clearInterval(checkGoogleInterval);
        }
      }, 500);
      return () => clearInterval(checkGoogleInterval);
    }
  }, []);

  const handleSelectRole = async (role) => {
    if (!role) return;
    setError("");
    setRoleLoading(true);
    try {
      const loggedInUser = await loginWithGoogle(googleCredential, role);
      setShowRoleModal(false);
      setSelectedRole(null);
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.push(panelMap[loggedInUser.role] || "/dashboard");
    } catch (err) {
      setError(err.message || "Failed to save role and login.");
      setShowRoleModal(false);
      setSelectedRole(null);
    } finally {
      setRoleLoading(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      // Role-based redirect
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.push(panelMap[user.role] || "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <Script 
        src="https://accounts.google.com/gsi/client" 
        strategy="afterInteractive"
      />
      <div
        className="page-container"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "24px", backgroundColor: "var(--bg-canvas)" }}
      >
        <div className="card" style={{ width: "100%", maxWidth: 400, padding: "40px", backgroundColor: "#ffffff", boxShadow: "0 10px 25px rgba(0,0,0,0.05)", borderRadius: "12px" }}>
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "12px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
              </svg>
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", marginBottom: "6px", letterSpacing: "-0.01em" }}>
              Access Workspace
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>
              Provide credentials to continue learning
            </p>
          </div>

          {error && (
            <div style={{
              marginBottom: "20px",
              padding: "12px 16px",
              borderRadius: "var(--radius-sm)",
              background: "var(--bg-danger)",
              border: "1px solid var(--border-danger)",
              color: "var(--color-danger)",
              fontSize: "13px",
              fontWeight: "600",
            }}>
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                id="login-email"
                className="form-input"
                type="email"
                placeholder="name@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input
                id="login-password"
                className="form-input"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              id="login-submit"
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: "12px" }}
              disabled={loading}
            >
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          {/* Divider */}
          <div style={{ display: "flex", alignItems: "center", margin: "24px 0", color: "var(--text-muted)", fontSize: "12px" }}>
            <div style={{ flex: 1, height: "1px", backgroundColor: "#e5e7eb" }} />
            <span style={{ padding: "0 12px", letterSpacing: "0.05em", textTransform: "uppercase" }}>or continue with</span>
            <div style={{ flex: 1, height: "1px", backgroundColor: "#e5e7eb" }} />
          </div>

          {/* Google Button Wrapper */}
          <div style={{ minHeight: "44px", width: "100%" }}>
            <div id="google-signin-button" style={{ width: "100%" }} />
          </div>

          <p style={{ textAlign: "center", marginTop: "28px", fontSize: "13px", color: "var(--text-muted)" }}>
            Don&apos;t have an account?{" "}
            <Link href="/register" style={{ color: "var(--brand)", fontWeight: "600", textDecoration: "none" }}>
              Register here
            </Link>
          </p>
        </div>
      </div>

      {/* Premium Role Selection Modal */}
      {showRoleModal && (
        <div style={{
          position: "fixed",
          top: 0, left: 0, right: 0, bottom: 0,
          backgroundColor: "rgba(15, 23, 42, 0.4)",
          backdropFilter: "blur(12px)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          zIndex: 9999,
          animation: "modalFadeIn 0.25s ease-out"
        }}>
          <div style={{
            backgroundColor: "#ffffff",
            width: "90%",
            maxWidth: "500px",
            padding: "36px",
            borderRadius: "16px",
            boxShadow: "0 25px 50px -12px rgba(0, 0, 0, 0.25)",
            textAlign: "center",
            animation: "modalScaleIn 0.3s cubic-bezier(0.34, 1.56, 0.64, 1)"
          }}>
            <h2 style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-title)", marginBottom: "8px", letterSpacing: "-0.02em" }}>
              Choose Your Role
            </h2>
            <p style={{ color: "var(--text-muted)", fontSize: "14px", marginBottom: "28px" }}>
              To complete your sign-in, please select how you will use Mavericks LMS.
            </p>

            <div style={{ display: "flex", flexDirection: "column", gap: "16px", marginBottom: "28px" }}>
              {/* Student Role Card */}
              <button 
                onClick={() => setSelectedRole("student")}
                disabled={roleLoading}
                className={`role-card-btn ${selectedRole === "student" ? "active-student" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  padding: "20px",
                  borderRadius: "12px",
                  border: selectedRole === "student" ? "2px solid var(--brand)" : "2px solid #e5e7eb",
                  background: selectedRole === "student" ? "rgba(0, 112, 243, 0.02)" : "#ffffff",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  width: "100%",
                  outline: "none"
                }}
              >
                <div style={{
                  backgroundColor: selectedRole === "student" ? "rgba(0, 112, 243, 0.15)" : "rgba(0, 112, 243, 0.08)",
                  color: "var(--brand)",
                  width: "48px",
                  height: "48px",
                  borderRadius: "10px",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  transition: "all 0.2s ease"
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
                    <path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z" />
                  </svg>
                </div>
                <div style={{ flexGrow: 1 }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "4px" }}>I am a Student</h3>
                  <p style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.4" }}>Learn new skills, watch videos, read articles, and take oral AI interviews.</p>
                </div>
                {selectedRole === "student" && (
                  <div style={{
                    backgroundColor: "var(--brand)",
                    color: "#ffffff",
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    animation: "scaleInCheck 0.2s ease"
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>

              {/* Teacher Role Card */}
              <button 
                onClick={() => setSelectedRole("teacher")}
                disabled={roleLoading}
                className={`role-card-btn ${selectedRole === "teacher" ? "active-teacher" : ""}`}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "16px",
                  padding: "20px",
                  borderRadius: "12px",
                  border: selectedRole === "teacher" ? "2px solid var(--color-success, #10b981)" : "2px solid #e5e7eb",
                  background: selectedRole === "teacher" ? "rgba(16, 185, 129, 0.02)" : "#ffffff",
                  textAlign: "left",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  width: "100%",
                  outline: "none"
                }}
              >
                <div style={{
                  backgroundColor: selectedRole === "teacher" ? "rgba(16, 185, 129, 0.15)" : "rgba(16, 185, 129, 0.08)",
                  color: "var(--color-success, #10b981)",
                  width: "48px",
                  height: "48px",
                  borderRadius: "10px",
                  display: "grid",
                  placeItems: "center",
                  flexShrink: 0,
                  transition: "all 0.2s ease"
                }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
                    <circle cx="9" cy="7" r="4" />
                    <path d="M23 21v-2a4 4 0 0 0-3-3.87" />
                    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
                  </svg>
                </div>
                <div style={{ flexGrow: 1 }}>
                  <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "4px" }}>I am a Teacher</h3>
                  <p style={{ fontSize: "12.5px", color: "var(--text-muted)", lineHeight: "1.4" }}>Create courses, upload video tutorials, write articles, and track student grades.</p>
                </div>
                {selectedRole === "teacher" && (
                  <div style={{
                    backgroundColor: "var(--color-success, #10b981)",
                    color: "#ffffff",
                    width: "22px",
                    height: "22px",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    flexShrink: 0,
                    animation: "scaleInCheck 0.2s ease"
                  }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  </div>
                )}
              </button>
            </div>

            {/* Next / Confirm Submit Button */}
            <button
              onClick={() => handleSelectRole(selectedRole)}
              disabled={!selectedRole || roleLoading}
              className="btn btn-primary"
              style={{
                width: "100%",
                padding: "14px",
                fontSize: "15px",
                fontWeight: "700",
                borderRadius: "10px",
                marginBottom: "20px",
                transition: "all 0.3s ease",
                backgroundColor: !selectedRole ? "#cbd5e1" : selectedRole === "teacher" ? "var(--color-success, #10b981)" : "var(--brand)",
                borderColor: !selectedRole ? "#cbd5e1" : selectedRole === "teacher" ? "var(--color-success, #10b981)" : "var(--brand)",
                cursor: !selectedRole ? "not-allowed" : "pointer",
                boxShadow: !selectedRole ? "none" : selectedRole === "teacher" ? "0 4px 14px rgba(16,185,129,0.2)" : "0 4px 14px rgba(0,112,243,0.2)"
              }}
            >
              {roleLoading ? (
                <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "8px" }}>
                  <span className="spinner" style={{ width: 14, height: 14, border: "2px solid #ffffff", borderTopColor: "transparent", borderRadius: "50%", display: "inline-block", animation: "spin 0.7s linear infinite" }} />
                  Creating Account…
                </div>
              ) : (
                "Confirm & Continue"
              )}
            </button>

            <div>
              <button 
                onClick={() => { setShowRoleModal(false); setSelectedRole(null); }}
                disabled={roleLoading}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-subtle, #9ca3af)",
                  fontSize: "13px",
                  fontWeight: "600",
                  cursor: "pointer",
                  textDecoration: "underline"
                }}
              >
                Cancel Sign-in
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Global CSS style overrides for interactive buttons in modal */}
      <style>{`
        @keyframes modalFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @keyframes modalScaleIn {
          from { transform: scale(0.9) translateY(10px); opacity: 0; }
          to { transform: scale(1) translateY(0); opacity: 1; }
        }
        @keyframes scaleInCheck {
          from { transform: scale(0); }
          to { transform: scale(1); }
        }
        .role-card-btn:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 15px rgba(0, 0, 0, 0.04);
        }
        .role-card-btn.active-student {
          box-shadow: 0 8px 20px rgba(0, 112, 243, 0.08) !important;
        }
        .role-card-btn.active-teacher {
          box-shadow: 0 8px 20px rgba(16, 185, 129, 0.08) !important;
        }
      `}</style>
    </>
  );
}
