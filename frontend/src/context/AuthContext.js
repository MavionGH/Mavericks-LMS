"use client";
import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

const API_BASE = "http://localhost:8000";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();
  const supabase = createClient();

  // ─── Restore session from Supabase cookies on mount ─────────────────────
  useEffect(() => {
    const initSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        await _hydrateFromSession(session);
      }
      setLoading(false);
    };

    initSession();

    // Listen for auth-state changes (e.g. token refresh, sign-out from another tab)
    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await _hydrateFromSession(session);
      } else {
        setUser(null);
        setToken(null);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /**
   * Hydrate React state from a Supabase session.
   * Fetches the user's profile from public.users via the FastAPI backend.
   */
  const _hydrateFromSession = async (session) => {
    const accessToken = session.access_token;
    setToken(accessToken);

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (res.ok) {
        const userData = await res.json();
        setUser(userData);
      }
    } catch {
      // Network error — keep whatever we had
    }
  };

  // ─── Email / Password Login ──────────────────────────────────────────────
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Fall back to the FastAPI backend for accounts that predate Supabase Auth
      // (i.e., users created before this OAuth migration).
      // This allows a graceful migration path without a forced password reset.
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Invalid email or password");
      }
      const legacy = await res.json();
      // Store the legacy FastAPI token for this session only (no Supabase session)
      setToken(legacy.access_token);
      setUser(legacy.user);
      return legacy.user;
    }

    if (data.session) {
      await _hydrateFromSession(data.session);
      return user;
    }
  };

  // ─── Email / Password Register ───────────────────────────────────────────
  const register = async (name, email, password, role = "student") => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, email, password, role }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Registration failed");
    }
    const data = await res.json();
    setToken(data.access_token);
    setUser(data.user);
    return data.user;
  };

  // ─── Google OAuth Sign-In ────────────────────────────────────────────────
  const loginWithGoogle = async () => {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/auth/callback`,
        queryParams: {
          access_type: "offline",
          prompt: "consent",
        },
      },
    });

    if (error) {
      throw new Error(error.message || "Google sign-in failed");
    }

    // Redirect browser to the Google consent screen
    if (data?.url) {
      window.location.href = data.url;
    }
  };

  // ─── Sign Out ────────────────────────────────────────────────────────────
  const logout = async () => {
    try {
      // POST to the server-side signout route so cookies are cleared properly.
      await fetch("/auth/signout", { method: "POST" });
    } catch {
      // Fallback: sign out client-side only
      await supabase.auth.signOut();
    }
    setUser(null);
    setToken(null);
    router.push("/login");
  };

  // ─── Authenticated fetch wrapper ─────────────────────────────────────────
  const authFetch = useCallback(
    async (url, options = {}) => {
      // Always use the freshest token from the Supabase session if available
      let activeToken = token;
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (session?.access_token) {
        activeToken = session.access_token;
        if (activeToken !== token) setToken(activeToken);
      }

      const headers = {
        "Content-Type": "application/json",
        ...(activeToken ? { Authorization: `Bearer ${activeToken}` } : {}),
        ...(options.headers || {}),
      };
      return fetch(`${API_BASE}${url}`, { ...options, headers });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [token]
  );

  return (
    <AuthContext.Provider
      value={{ user, token, loading, login, register, loginWithGoogle, logout, authFetch }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
