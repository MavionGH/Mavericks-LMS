"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const { login, loginWithGoogle } = useAuth();
  const router = useRouter();

  // ─── Email / Password sign-in ─────────────────────────────────────────
const { login, loginWithGoogle, user, loading: authLoading } = useAuth();
const router = useRouter();

// Redirect already-authenticated users to their panel
useEffect(() => {
  if (!authLoading && user) {
    const panelMap = {
      student: "/dashboard",
      teacher: "/teacher",
      admin: "/admin",
    };

    router.replace(panelMap[user.role] || "/dashboard");
  }
}, [user, authLoading, router]);

// ─── Email / Password sign-in ─────────────────────────────────────────

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const user = await login(email, password);
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.push(panelMap[user?.role] || "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // ─── Google OAuth sign-in ─────────────────────────────────────────────
  const handleGoogleSignIn = async () => {
    setError("");
    setGoogleLoading(true);
    try {
      await loginWithGoogle();
      // loginWithGoogle() redirects the browser — no further code runs here.
    } catch (err) {
      setError(err.message || "Google sign-in failed. Please try again.");
      setGoogleLoading(false);
    }
  };

  return (
    <>
      <Navbar />
      <div
        className="page-container"
        style={{
          display: "grid",
          placeItems: "center",
          minHeight: "100vh",
          padding: "24px",
          backgroundColor: "var(--bg-canvas)",
        }}
      >
        <div
          className="card"
          style={{ width: "100%", maxWidth: 400, padding: "40px", backgroundColor: "#ffffff" }}
        >
          {/* ── Header ── */}
          <div style={{ textAlign: "center", marginBottom: "32px" }}>
            <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
                stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z" />
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5" />
              </svg>
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)",
              marginBottom: "6px", letterSpacing: "-0.01em" }}>
              Access Workspace
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>
              Provide credentials to continue learning
            </p>
          </div>

          {/* ── Error Banner ── */}
          {error && (
            <div style={{
              marginBottom: "20px", padding: "12px 16px",
              borderRadius: "var(--radius-sm)", background: "var(--bg-danger)",
              border: "1px solid var(--border-danger)", color: "var(--color-danger)",
              fontSize: "13px", fontWeight: "600",
            }}>
              {error}
            </div>
          )}

          {/* ── Sign in with Google ── */}
          <button
            id="google-signin-btn"
            onClick={handleGoogleSignIn}
            disabled={googleLoading || loading}
            style={{
              width: "100%", display: "flex", alignItems: "center",
              justifyContent: "center", gap: "10px", padding: "10px 16px",
              borderRadius: "var(--radius-sm)", border: "1px solid var(--border-muted)",
              background: "#ffffff", color: "var(--text-main)", fontSize: "14px",
              fontWeight: "600", cursor: googleLoading ? "not-allowed" : "pointer",
              opacity: googleLoading ? 0.7 : 1,
              transition: "border-color 0.15s, box-shadow 0.15s", marginBottom: "20px",
            }}
            onMouseEnter={(e) => { if (!googleLoading) e.currentTarget.style.borderColor = "#4285F4"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--border-muted)"; }}
          >
            <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
              <path fill="none" d="M0 0h48v48H0z"/>
            </svg>
            {googleLoading ? "Redirecting to Google…" : "Sign in with Google"}
          </button>

          {/* ── Divider ── */}
          <div style={{ display: "flex", alignItems: "center", gap: "12px", marginBottom: "20px" }}>
            <div style={{ flex: 1, height: "1px", background: "var(--border-muted)" }} />
            <span style={{ color: "var(--text-muted)", fontSize: "12px", fontWeight: "500" }}>
              or continue with email
            </span>
            <div style={{ flex: 1, height: "1px", background: "var(--border-muted)" }} />
          </div>

          {/* ── Email / Password Form ── */}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input id="login-email" className="form-input" type="email"
                placeholder="name@example.com" value={email}
                onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div className="form-group">
              <label className="form-label">Password</label>
              <input id="login-password" className="form-input" type="password"
                placeholder="••••••••" value={password}
                onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <button id="login-submit" type="submit" className="btn btn-primary"
              style={{ width: "100%", marginTop: "12px" }} disabled={loading || googleLoading}>
              {loading ? "Signing in…" : "Sign In"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: "28px", fontSize: "13px", color: "var(--text-muted)" }}>
            Don&apos;t have an account?{" "}
            <Link href="/register" style={{ color: "var(--brand)", fontWeight: "600", textDecoration: "none" }}>
              Register here
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
