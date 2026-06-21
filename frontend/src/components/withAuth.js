"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

/**
 * Wrap any page component with this HOC to enforce role-based access.
 * @param {React.Component} Component - The page to protect.
 * @param {string[]} allowedRoles - e.g. ["admin"] or ["student","teacher"]
 */
export function withAuth(Component, allowedRoles = []) {
  return function ProtectedPage(props) {
    const { user, loading } = useAuth();
    const router = useRouter();

    useEffect(() => {
      if (loading) return;
      if (!user) {
        router.replace("/login");
        return;
      }
      if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
        // Redirect to the correct panel for the user's role
        const panelMap = {
          student: "/dashboard",
          teacher: "/teacher",
          admin: "/admin",
        };
        router.replace(panelMap[user.role] || "/");
      }
    }, [user, loading, router]);

    if (loading || !user) {
      return (
        <div style={{
          minHeight: "100vh",
          display: "grid",
          placeItems: "center",
          background: "var(--bg-canvas)",
        }}>
          <div style={{ textAlign: "center", color: "var(--text-muted)" }}>
            <div style={{
              width: 36,
              height: 36,
              border: "2px solid var(--brand)",
              borderTopColor: "transparent",
              borderRadius: "50%",
              animation: "spin 0.8s linear infinite",
              margin: "0 auto 16px",
            }} />
            <p style={{ fontSize: 13 }}>Authenticating...</p>
          </div>
        </div>
      );
    }

    if (allowedRoles.length > 0 && !allowedRoles.includes(user.role)) {
      return null; // Render nothing while redirecting
    }

    return <Component {...props} />;
  };
}
