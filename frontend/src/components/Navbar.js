"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { useTheme } from "@/context/ThemeContext";
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
  teacher: [],
  admin: [],
};

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const drawerRef = useRef(null);
  const triggerRef = useRef(null);
  const mobileDrawerRef = useRef(null);

  const links = user ? (NAV_LINKS_BY_ROLE[user.role] || []) : [
    { href: "/courses", label: "Courses" },
  ];

  const badge = user ? ROLE_BADGE[user.role] : null;
  const firstName = user?.name?.split(" ")[0] || user?.name || "User";

  // Close drawers when clicking outside
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

  // Close drawers on route change
  useEffect(() => {
    setDrawerOpen(false);
    setMobileMenuOpen(false);
  }, [pathname]);

  // Focus trap for mobile drawer
  useEffect(() => {
    if (!mobileMenuOpen) return;
    const drawer = mobileDrawerRef.current;
    if (!drawer) return;

    const focusableElements = drawer.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    const firstElement = focusableElements[0];
    const lastElement = focusableElements[focusableElements.length - 1];

    function handleKeyDown(e) {
      if (e.key !== "Tab") return;

      if (e.shiftKey) {
        if (document.activeElement === firstElement) {
          lastElement.focus();
          e.preventDefault();
        }
      } else {
        if (document.activeElement === lastElement) {
          firstElement.focus();
          e.preventDefault();
        }
      }
    }

    if (firstElement) {
      setTimeout(() => firstElement.focus(), 50);
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [mobileMenuOpen]);

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
        <Link href={logoHref} className="navbar-brand" style={{ minWidth: "44px", minHeight: "44px", display: "inline-flex", alignItems: "center" }}>
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: "8px" }}>
            <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
          </svg>
          <span style={{ fontWeight: "700", letterSpacing: "-0.02em", color: "var(--text-title)" }}>MLP</span>
        </Link>

        <div className="navbar-links">
          {links.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              className={pathname === l.href ? "active" : ""}
              style={{ minHeight: "44px", display: "inline-flex", alignItems: "center", padding: "0 8px" }}
            >
              {l.label}
            </Link>
          ))}
        </div>

        <div className="navbar-actions">
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: "44px",
              height: "44px",
              background: "transparent",
              border: "none",
              borderRadius: "8px",
              cursor: "pointer",
              color: "var(--text-muted)",
              transition: "background 0.15s ease",
            }}
            onMouseEnter={(e) => e.currentTarget.style.background = "var(--brand-muted)"}
            onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
          >
            {theme === "dark" ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="4" />
                <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
              </svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              </svg>
            )}
          </button>

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
                  minHeight: "44px",
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
                  border: drawerOpen ? "2px solid var(--brand)" : "2px solid var(--border-muted)",
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
              <Link href="/login"    className="btn btn-secondary btn-sm" style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 16px" }}>Sign in</Link>
              <Link href="/register" className="btn btn-primary btn-sm" style={{ display: "inline-flex", alignItems: "center", minHeight: "44px", padding: "0 16px" }}>Create account</Link>
            </>
          )}
        </div>

        {/* Hamburger Icon button for mobile (< 768px) */}
        <button
          type="button"
          onClick={() => setMobileMenuOpen(true)}
          className="navbar-hamburger-btn"
          aria-label="Open navigation menu"
          style={{
            alignItems: "center",
            justifyContent: "center",
            width: "44px",
            height: "44px",
            background: "transparent",
            border: "none",
            borderRadius: "8px",
            cursor: "pointer",
            color: "var(--text-title)",
          }}
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
      </nav>

      {/* Profile slide-out drawer (Desktop only or fallback) */}
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
              background: "var(--bg-surface)",
              borderRadius: "12px",
              boxShadow: "var(--shadow-lg)",
              border: "1px solid var(--border-muted)",
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
              borderBottom: "1px solid var(--border-muted)",
              background: "linear-gradient(135deg, var(--bg-surface-hover) 0%, var(--brand-muted) 100%)",
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                <div style={{
                  width: "48px", height: "48px",
                  borderRadius: "50%", overflow: "hidden",
                  border: "2px solid var(--bg-surface)",
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

              <div style={{ height: "1px", background: "var(--border-muted)", margin: "8px 0" }} />

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
                  minHeight: "44px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-danger)"}
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

      {/* Mobile Drawer (visible on < 768px via CSS) */}
      {mobileMenuOpen && (
        <>
          {/* Dark Backdrop */}
          <div
            className="mobile-drawer-backdrop"
            onClick={() => setMobileMenuOpen(false)}
            style={{
              position: "fixed",
              inset: 0,
              backgroundColor: "rgba(15, 23, 42, 0.6)",
              backdropFilter: "blur(4px)",
              zIndex: 9999,
            }}
          />

          {/* Drawer Panel */}
          <div
            ref={mobileDrawerRef}
            className="mobile-drawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            style={{
              position: "fixed",
              top: 0,
              right: 0,
              bottom: 0,
              width: "280px",
              backgroundColor: "var(--bg-surface)",
              borderLeft: "1px solid var(--border-muted)",
              boxShadow: "var(--shadow-lg)",
              zIndex: 10000,
              display: "flex",
              flexDirection: "column",
              padding: "20px",
              boxSizing: "border-box",
            }}
          >
            {/* Header with Close Button */}
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px" }}>
              <span style={{ fontWeight: "700", color: "var(--text-title)" }}>Menu</span>
              <button
                onClick={() => setMobileMenuOpen(false)}
                aria-label="Close menu"
                style={{
                  width: "44px",
                  height: "44px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "50%",
                  cursor: "pointer",
                  color: "var(--text-muted)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* User Info Header (if logged in) */}
            {user && (
              <div style={{
                padding: "16px",
                borderRadius: "8px",
                backgroundColor: "var(--bg-canvas)",
                marginBottom: "20px",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}>
                <div style={{
                  width: "40px",
                  height: "40px",
                  borderRadius: "50%",
                  overflow: "hidden",
                  border: "2px solid var(--border-muted)",
                }}>
                  {avatarContent}
                </div>
                <div style={{ overflow: "hidden" }}>
                  <div style={{ fontSize: "14px", fontWeight: "700", color: "var(--text-title)", textOverflow: "ellipsis", overflow: "hidden", whiteSpace: "nowrap" }}>
                    {user.name}
                  </div>
                  {badge && (
                    <span style={{
                      display: "inline-block",
                      marginTop: "2px",
                      fontSize: "10px",
                      fontWeight: "600",
                      padding: "1px 5px",
                      borderRadius: "3px",
                      background: badge.bg,
                      color: badge.color,
                      fontFamily: "JetBrains Mono, monospace",
                    }}>
                      {badge.label}
                    </span>
                  )}
                </div>
              </div>
            )}

            {/* Nav Links */}
            <div style={{ display: "flex", flexDirection: "column", gap: "8px", flexGrow: 1 }}>
              {links.map((l) => (
                <Link
                  key={l.href}
                  href={l.href}
                  onClick={() => setMobileMenuOpen(false)}
                  style={{
                    padding: "12px 16px",
                    borderRadius: "8px",
                    textDecoration: "none",
                    color: pathname === l.href ? "var(--brand)" : "var(--text-main)",
                    backgroundColor: pathname === l.href ? "var(--brand-muted)" : "transparent",
                    fontWeight: "600",
                    fontSize: "15px",
                    display: "block",
                    minHeight: "44px",
                  }}
                >
                  {l.label}
                </Link>
              ))}

              {user && (
                <>
                  <Link
                    href={logoHref}
                    onClick={() => setMobileMenuOpen(false)}
                    style={{
                      padding: "12px 16px",
                      borderRadius: "8px",
                      textDecoration: "none",
                      color: pathname === logoHref ? "var(--brand)" : "var(--text-main)",
                      backgroundColor: pathname === logoHref ? "var(--brand-muted)" : "transparent",
                      fontWeight: "600",
                      fontSize: "15px",
                      display: "block",
                      minHeight: "44px",
                    }}
                  >
                    Dashboard Workspace
                  </Link>
                  <Link
                    href="/profile"
                    onClick={() => setMobileMenuOpen(false)}
                    style={{
                      padding: "12px 16px",
                      borderRadius: "8px",
                      textDecoration: "none",
                      color: pathname === "/profile" ? "var(--brand)" : "var(--text-main)",
                      backgroundColor: pathname === "/profile" ? "var(--brand-muted)" : "transparent",
                      fontWeight: "600",
                      fontSize: "15px",
                      display: "block",
                      minHeight: "44px",
                    }}
                  >
                    Profile Settings
                  </Link>
                  {user.role === "student" && (
                    <Link
                      href="/certificates"
                      onClick={() => setMobileMenuOpen(false)}
                      style={{
                        padding: "12px 16px",
                        borderRadius: "8px",
                        textDecoration: "none",
                        color: pathname === "/certificates" ? "var(--brand)" : "var(--text-main)",
                        backgroundColor: pathname === "/certificates" ? "var(--brand-muted)" : "transparent",
                        fontWeight: "600",
                        fontSize: "15px",
                        display: "block",
                        minHeight: "44px",
                      }}
                    >
                      My Certificates
                    </Link>
                  )}
                </>
              )}
            </div>

            {/* Theme Toggle & Logout */}
            <div style={{ borderTop: "1px solid var(--border-muted)", paddingTop: "16px", marginTop: "16px" }}>
              <button
                type="button"
                onClick={toggleTheme}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "12px",
                  width: "100%",
                  padding: "12px 16px",
                  background: "transparent",
                  border: "none",
                  borderRadius: "8px",
                  cursor: "pointer",
                  color: "var(--text-main)",
                  fontWeight: "600",
                  fontSize: "15px",
                  minHeight: "44px",
                }}
                onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-surface-hover)"}
                onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
              >
                {theme === "dark" ? (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <circle cx="12" cy="12" r="4" />
                      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
                    </svg>
                    Light Mode
                  </>
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
                    </svg>
                    Dark Mode
                  </>
                )}
              </button>

              {user ? (
                <button
                  onClick={() => { setMobileMenuOpen(false); logout(); }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    width: "100%",
                    padding: "12px 16px",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "15px",
                    color: "var(--color-danger)",
                    fontWeight: "600",
                    textAlign: "left",
                    borderRadius: "8px",
                    marginTop: "8px",
                    minHeight: "44px",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-danger)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "transparent"}
                >
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                    <polyline points="16 17 21 12 16 7" />
                    <line x1="21" y1="12" x2="9" y2="12" />
                  </svg>
                  Sign Out
                </button>
              ) : (
                <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "12px" }}>
                  <Link href="/login" onClick={() => setMobileMenuOpen(false)} className="btn btn-secondary btn-sm" style={{ width: "100%", justifyContent: "center", minHeight: "44px", display: "flex", alignItems: "center" }}>Sign in</Link>
                  <Link href="/register" onClick={() => setMobileMenuOpen(false)} className="btn btn-primary btn-sm" style={{ width: "100%", justifyContent: "center", minHeight: "44px", display: "flex", alignItems: "center" }}>Create account</Link>
                </div>
              )}
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
        minHeight: "44px",
      }}
      onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.background = "var(--bg-surface-hover)"; }}
      onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.background = "transparent"; }}
    >
      <span style={{ color: isActive ? "var(--brand)" : "var(--text-muted)", flexShrink: 0 }}>
        {icon}
      </span>
      {label}
    </Link>
  );
}
