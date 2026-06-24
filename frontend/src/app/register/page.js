"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const ROLES = [
  {
    value: "student",
    label: "Student",
    desc: "Learn courses and earn certificates",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
        <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
      </svg>
    )
  },
  {
    value: "teacher",
    label: "Teacher",
    desc: "Create and manage course content",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"/>
        <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"/>
      </svg>
    )
  },
];

export default function RegisterPage() {
  const [name, setName]         = useState("");
  const [email, setEmail]       = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole]         = useState("student");
  const [error, setError]       = useState("");
  const [loading, setLoading]   = useState(false);
  const [pendingApproval, setPendingApproval] = useState(false);

  const { register, user, loading: authLoading } = useAuth();
  const router = useRouter();

  // Redirect already-authenticated users to their panel
  useEffect(() => {
    if (!authLoading && user) {
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.replace(panelMap[user.role] || "/dashboard");
    }
  }, [user, authLoading, router]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");
    if (password.length < 6) {
      setError("Password must be at least 6 characters.");
      return;
    }
    setLoading(true);
    try {
      const registeredUser = await register(name, email, password, role);
      if (registeredUser.role === "teacher" && !registeredUser.is_approved) {
        setPendingApproval(true);
        return;
      }
      const panelMap = { student: "/dashboard", teacher: "/teacher", admin: "/admin" };
      router.push(panelMap[registeredUser.role] || "/dashboard");
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  if (pendingApproval) {
    return (
      <>
        <Navbar />
        <div className="page-container" style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "24px", backgroundColor: "var(--bg-canvas)" }}>
          <div className="card" style={{ width: "100%", maxWidth: 460, padding: "40px", backgroundColor: "#ffffff", textAlign: "center" }}>
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--color-warning)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: "20px" }}>
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="8" x2="12" y2="12" />
              <line x1="12" y1="16" x2="12.01" y2="16" />
            </svg>
            <h2 style={{ fontSize: "20px", fontWeight: "700", color: "var(--text-title)", marginBottom: "12px" }}>Account Pending Approval</h2>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px", lineHeight: "1.6" }}>
              Your teacher account has been created. An admin must approve it before you can access the Teacher Studio and publish courses.
            </p>
            <p style={{ color: "var(--text-subtle)", fontSize: "12px", marginTop: "16px" }}>You will be able to log in once your account is approved.</p>
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <Navbar />
      <div
        className="page-container"
        style={{ display: "grid", placeItems: "center", minHeight: "100vh", padding: "24px", backgroundColor: "var(--bg-canvas)" }}
      >
        <div className="card" style={{ width: "100%", maxWidth: 460, padding: "40px", backgroundColor: "#ffffff" }}>
          <div style={{ textAlign: "center", marginBottom: "28px" }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "12px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
              </svg>
            </div>
            <h1 style={{ fontSize: "22px", fontWeight: "700", color: "var(--text-title)", marginBottom: "6px", letterSpacing: "-0.01em" }}>
              Create Account
            </h1>
            <p style={{ color: "var(--text-muted)", fontSize: "13.5px" }}>
              Select your role and register to get started
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

          {/* Role selector */}
          <div style={{ marginBottom: "24px" }}>
            <label className="form-label">Account Type</label>
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {ROLES.map((r) => (
                <label
                  key={r.value}
                  id={`role-${r.value}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "16px",
                    padding: "12px 16px",
                    borderRadius: "var(--radius-sm)",
                    border: `1px solid ${role === r.value ? "var(--brand)" : "var(--border-muted)"}`,
                    background: role === r.value ? "var(--brand-muted)" : "#ffffff",
                    cursor: "pointer",
                    transition: "var(--transition-fast)",
                  }}
                >
                  <input
                    type="radio"
                    name="role"
                    value={r.value}
                    checked={role === r.value}
                    onChange={() => setRole(r.value)}
                    style={{ accentColor: "var(--brand)" }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', color: role === r.value ? 'var(--brand)' : 'var(--text-muted)' }}>
                    {r.icon}
                  </div>
                  <div>
                    <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)" }}>{r.label}</div>
                    <div style={{ fontSize: "12px", color: "var(--text-muted)", marginTop: "2px" }}>{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <label className="form-label">Full Name</label>
              <input
                id="register-name"
                className="form-input"
                type="text"
                placeholder="John Doe"
                value={name}
                onChange={(e) => setName(e.target.value)}
                required
              />
            </div>
            <div className="form-group">
              <label className="form-label">Email</label>
              <input
                id="register-email"
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
                id="register-password"
                className="form-input"
                type="password"
                placeholder="Min. 6 characters"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
            </div>
            <button
              id="register-submit"
              type="submit"
              className="btn btn-primary"
              style={{ width: "100%", marginTop: "12px" }}
              disabled={loading}
            >
              {loading ? "Creating account…" : "Create Account"}
            </button>
          </form>

          <p style={{ textAlign: "center", marginTop: "28px", fontSize: "13px", color: "var(--text-muted)" }}>
            Already registered?{" "}
            <Link href="/login" style={{ color: "var(--brand)", fontWeight: "600", textDecoration: "none" }}>
              Sign in
            </Link>
          </p>
        </div>
      </div>
    </>
  );
}
