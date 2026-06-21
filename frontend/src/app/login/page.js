"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

export default function LoginPage() {
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);

  const { login } = useAuth();
  const router = useRouter();

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
      <div
        className="page-container"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "24px", backgroundColor: "var(--bg-canvas)" }}
      >
        <div className="card" style={{ width: "100%", maxWidth: 400, padding: "40px", backgroundColor: "#ffffff" }}>
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

          <p style={{ textAlign: "center", marginTop: "28px", fontSize: "13px", color: "var(--text-muted)" }}>
            Don't have an account?{" "}
            <Link href="/register" style={{ color: "var(--brand)", fontWeight: "600", textDecoration: "none" }}>
              Register here
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
