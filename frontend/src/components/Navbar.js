"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";

const ROLE_BADGE = {
  student: { label: "Student",  color: "var(--brand)",         bg: "var(--brand-muted)"  },
  teacher: { label: "Teacher",  color: "var(--color-success)", bg: "var(--bg-success)"   },
  admin:   { label: "Admin",    color: "var(--color-warning)", bg: "var(--bg-warning)"   },
};

const NAV_LINKS_BY_ROLE = {
  student: [
    { href: "/courses",    label: "Courses"    },
    { href: "/dashboard",  label: "Dashboard"  },
    { href: "/certificates", label: "Certificates" },
  ],
  teacher: [
    { href: "/courses",  label: "Courses"  },
    { href: "/teacher",  label: "My Courses" },
  ],
  admin: [
    { href: "/courses", label: "Courses" },
    { href: "/admin",   label: "Admin Panel" },
    { href: "/teacher", label: "Content" },
  ],
};

export default function Navbar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();

  const links = user ? (NAV_LINKS_BY_ROLE[user.role] || []) : [
    { href: "/courses", label: "Courses" },
  ];

  const badge = user ? ROLE_BADGE[user.role] : null;

  return (
    <nav className="navbar">
      <Link href="/" className="navbar-brand">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ marginRight: '8px' }}>
          <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
          <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
        </svg>
        <span style={{ fontWeight: '700', letterSpacing: '-0.02em', color: 'var(--text-title)' }}>Mavericks</span>
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
            {/* Role badge */}
            <span style={{
              fontSize: "11px",
              fontWeight: "600",
              padding: "3px 8px",
              borderRadius: "4px",
              background: badge.bg,
              color: badge.color,
              fontFamily: "JetBrains Mono, monospace",
              border: `1px solid ${badge.color}22`,
            }}>
              {badge.label}
            </span>

            {/* User name */}
            <span style={{
              fontSize: "13px",
              color: "var(--text-main)",
              maxWidth: 120,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              fontWeight: "500"
            }}>
              {user.name}
            </span>

            {/* Logout */}
            <button
              id="logout-btn"
              onClick={logout}
              className="btn btn-secondary btn-sm"
            >
              Sign out
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
  );
}
