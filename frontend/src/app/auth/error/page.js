"use client";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { Suspense } from "react";

function ErrorContent() {
  const params = useSearchParams();
  const message =
    params.get("message") ||
    "An unexpected error occurred during sign-in. Please try again.";

  return (
    <div
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
        style={{
          width: "100%",
          maxWidth: 420,
          padding: "40px",
          textAlign: "center",
          backgroundColor: "#ffffff",
        }}
      >
        {/* Error icon */}
        <div style={{ display: "flex", justifyContent: "center", marginBottom: "16px" }}>
          <svg
            width="48"
            height="48"
            viewBox="0 0 24 24"
            fill="none"
            stroke="var(--color-danger)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="8" x2="12" y2="12" />
            <line x1="12" y1="16" x2="12.01" y2="16" />
          </svg>
        </div>

        <h1
          style={{
            fontSize: "20px",
            fontWeight: "700",
            color: "var(--text-title)",
            marginBottom: "12px",
          }}
        >
          Sign-In Error
        </h1>

        <p
          style={{
            color: "var(--text-muted)",
            fontSize: "14px",
            lineHeight: "1.6",
            marginBottom: "28px",
          }}
        >
          {message}
        </p>

        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <Link href="/login" className="btn btn-primary">
            Back to Sign In
          </Link>
          <Link href="/" className="btn btn-secondary">
            Home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense fallback={null}>
      <ErrorContent />
    </Suspense>
  );
}
