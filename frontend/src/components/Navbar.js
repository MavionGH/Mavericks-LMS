"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useState, useRef, useEffect } from "react";

const ROLE_BADGE = {
  student: { label: "Student",  color: "var(--brand)",         bg: "var(--brand-muted)"  },
  teacher: { label: "Teacher",  color: "var(--color-success)", bg: "var(--bg-success)"   },
  admin:   { label: "Admin",    color: "var(--color-warning)", bg: "var(--bg-warning)"   },
};

const NAV_LINKS_BY_ROLE = {
  student: [
    { href: "/courses",   label: "Courses"   },
  ],
  teacher: [
    { href: "/courses",  label: "Courses"    },
    { href: "/teacher",  label: "My Courses" },
  ],
  admin: [
    { href: "/courses", label: "Courses"     },
    { href: "/admin",   label: "Admin Panel" },
    { href: "/teacher", label: "Content"     },
  ],
};

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const drawerRef = useRef(null);
  const triggerRef = useRef(null);

  const links = user ? (NAV_LINKS_BY_ROLE[user.role] || []) : [
    { href: "/courses", label: "Courses" },
  ];

  const badge = user ? ROLE_BADGE[user.role] : null;
  const firstName = user?.name?.split(" ")[0] || user?.name || "User";

  // Close drawer when clicking outside
  useEffect(() => {
    function handleClickOutside(e) {
      if (
        drawerRef.current && !drawerRef.current.contains(e.target) &&
        triggerRef.current && !triggerRef.current.contains(e.target)
      ) {
        setDrawerOpen(false);
      }
    }
    if (drawerOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [drawerOpen]);

  // Close drawer on route change
  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const avatarContent = user?.avatar ? (
    <img
      src={user.avatar}
      alt={user.name}
      style={{ width: "100%", height: "100%", objectFit: "cover" }}
    />
  ) : (
    <div style={{
      width: "100%", height: "100%",
      display: "flex", alignItems: "center", justifyContent: "center",
      background: "linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)",
      color: "#ffffff", fontWeight: "700", fontSize: "15px", textTransform: "uppercase",
    }}>
      {user?.name ? user.name.charAt(0) : "U"}
    </div>
  );

  const logoHref = user
    ? user.role === "admin"
      ? "/admin"
      : user.role === "teacher"
      ? "/teacher"
      : "/dashboard"
    : "/";

  return (
    <>
      <nav className="navbar">
        <Link href={logoHref} className="navbar-brand">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "8px" }}>
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
          </svg>
          <span style={{ fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text-title)" }}>Mavericks</span>
        </Link>

        <div className="navbar-links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? "active" : ""}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="navbar-actions">
          {user ? (
            <>
              {/* Profile trigger: Hello [name] + avatar */}
              <button
                ref={triggerRef}
                id="profile-drawer-trigger"
                onClick={() => setDrawerOpen((v) => !v)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  padding: "4px 8px",
                  borderRadius: "8px",
                  transition: "background 0.15s ease",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--brand-muted)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                {/* Hello text */}
                <span style={{
                  fontSize: "13px",
                  color: "var(--text-muted)",
                  fontWeight: "500",
                }}>
                  Hello,{" "}
                  <strong style={{ color: "var(--text-title)" }}>{firstName}</strong>
                </span>

                {/* Avatar circle */}
                <div style={{
                  width: "36px",
                  height: "36px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: drawerOpen ? "2px solid var(--brand)" : "2px solid #e2e8f0",
                  transition: "border-color 0.2s ease",
                  flexShrink: 0,
                }}>
                  {avatarContent}
                </div>

                {/* Chevron */}
                <svg
                  width="12" height="12" viewBox="0 0 24 24" fill="none"
                  stroke="var(--text-muted)" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
                  style={{
                    transform: drawerOpen ? "rotate(180deg)" : "rotate(0deg)",
                    transition: "transform 0.2s ease",
                  }}
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </>
          ) : (
            <>
              <Link href="/login"    className="btn btn-secondary btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm">Create account</Link>
            </>
          )}
        </div>
      </nav>

      {/* Profile slide-out drawer */}
      {user && (
        <>
          {/* Backdrop */}
          {drawerOpen && (
            <div
              onClick={() => setDrawerOpen(false)}
              style={{
                position: "fixed",
                inset: 0,
                zIndex: 149,
                background: "transparent",
              }}
            />
          )}

          {/* Drawer panel */}
          <div
            ref={drawerRef}
            style={{
              position: "fixed",
              top: "64px",
              right: "16px",
              width: "260px",
              background: "#ffffff",
              borderRadius: "12px",
              boxShadow: "0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.06)",
              border: "1px solid #f1f5f9",
              zIndex: 150,
              overflow: "hidden",
              transform: drawerOpen ? "translateY(0) scale(1)" : "translateY(-8px) scale(0.97)",
              opacity: drawerOpen ? 1 : 0,
              pointerEvents: drawerOpen ? "auto" : "none",
              transition: "transform 0.2s cubic-bezier(0.4,0,0.2,1), opacity 0.2s ease",
              transformOrigin: "top right",
            }}
          >
            {/* User info header */}
            <div style={{
              padding: "20px 20px 16px",
              borderBottom: "1px solid #f1f5f9",
              background: "linear-gradient(135deg, #f8faff 0%, #f0f4ff 100%)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "48px", height: "48px",
                  borderRadius: "50%", overflow: "hidden",
                  border: "2px solid #ffffff",
                  boxShadow: "0 2px 8px rgba(79,70,229,0.2)",
                  flexShrink: 0,
                }}>
                  {avatarContent}
                </div>
                <div>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", lineHeight: 1.3 }}>
                    {user.name}
                  </div>
                  <div style={{ fontSize: "11px", color: "var(--text-muted)", marginTop: "2px" }}>
                    {user.email}
                  </div>
                  {badge && (
                    <span style={{
                      display: "inline-block",
                      marginTop: "5px",
                      fontSize: "10px",
                      fontWeight: "600",
                      padding: "2px 7px",
                      borderRadius: "4px",
                      background: badge.bg,
                      color: badge.color,
                      fontFamily: "JetBrains Mono, monospace",
                      border: `1px solid ${badge.color}22`,
                    }}>
                      {badge.label}
                    </span>
                  )}
                </div>
              </div>
            </div>

             {/* Menu items */}
            <div style={{ padding: "8px 0" }}>
              <DrawerItem
                href="/profile"
                onClick={() => setDrawerOpen(false)}
                icon={
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                    <circle cx="12" cy="7" r="4" />
                  </svg>
                }
                label="Profile Settings"
              />

              {user.role === "student" && (
                <DrawerItem
                  href="/certificates"
                  onClick={() => setDrawerOpen(false)}
                  icon={
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                      <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                    </svg>
                  }
                  label="My Certificates"
                />
              )}

              <div style={{ height: "1px", background: "#f1f5f9", margin: "8px 0" }} />

              <button
                id="profile-drawer-signout"
                onClick={() => { setDrawerOpen(false); logout(); }}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  padding: "10px 20px",
                  background: "transparent",
                  border: "none",
                  cursor: "pointer",
                  fontSize: "14px",
                  color: "var(--color-danger)",
                  fontFamily: "inherit",
                  fontWeight: "500",
                  textAlign: "left",
                  transition: "background 0.12s ease",
                  borderRadius: 0,
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "#fff5f5"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                  <polyline points="16 17 21 12 16 7" />
                  <line x1="21" y1="12" x2="9" y2="12" />
                </svg>
                Sign Out
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

function DrawerItem({ href, icon, label, onClick }) {
  const pathname = usePathname();
  const isActive = pathname === href;

  return (
    <Link
      href={href}
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "12px",
        padding: "10px 20px",
        fontSize: "14px",
        fontWeight: "500",
        color: isActive ? "var(--brand)" : "var(--text-main)",
        background: isActive ? "var(--brand-muted)" : "transparent",
        textDecoration: "none",
        transition: "background 0.12s ease",
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "#f8f9fa"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: isActive ? "var(--brand)" : "var(--text-muted)", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </Link>
  );
}
