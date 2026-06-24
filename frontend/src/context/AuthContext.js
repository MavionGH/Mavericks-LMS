"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

export const API_BASE = "http://localhost:8000";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [token, setToken] = useState(null);
  const [loading, setLoading] = useState(true);

  const router = useRouter();
  const supabase = createClient();

  // ─── Helpers ──────────────────────────────────────────────
  const saveSession = (accessToken, userData) => {
    localStorage.setItem("jwt_token", accessToken);
    localStorage.setItem("user_data", JSON.stringify(userData));

    flushSync(() => {
      setToken(accessToken);
      setUser(userData);
    });
  };

  /**
   * Hydrate React state from a Supabase session.
   * Fetches the user's profile from public.users via the FastAPI backend.
   */
  const _hydrateFromSession = async (session) => {
    const accessToken = session.access_token;

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      if (res.ok) {
        const userData = await res.json();
        saveSession(accessToken, userData);
        return userData;
      }

      setToken(accessToken);
      return null;
    } catch {
      setToken(accessToken);
      return null;
    }
  };

  // ─── Restore session from Supabase cookies on mount ─────────────────────
  useEffect(() => {
    const initSession = async () => {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session) {
        await _hydrateFromSession(session);
      } else {
        const savedToken = localStorage.getItem("jwt_token");
        const savedUser = localStorage.getItem("user_data");

        if (savedToken) {
          setToken(savedToken);
        }

        if (savedUser) {
          try {
            setUser(JSON.parse(savedUser));
          } catch {}
        }
      }

      setLoading(false);
    };

    initSession();

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange(async (_event, session) => {
      if (session) {
        await _hydrateFromSession(session);
      } else {
        localStorage.removeItem("jwt_token");
        localStorage.removeItem("user_data");
        setUser(null);
        setToken(null);
      }
    });

    return () => subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ─── Email / Password Login ───────────────────────────────
  const login = async (email, password) => {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) {
      // Legacy login support
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.detail || "Invalid email or password");
      }

      const legacy = await res.json();

      saveSession(legacy.access_token, legacy.user);

      return legacy.user;
    }

    if (data.session) {
      return await _hydrateFromSession(data.session);
    }

    return null;
  };

  // ─── Register ─────────────────────────────────────────────
  const register = async (
    name,
    email,
    password,
    role = "student"
  ) => {
    const res = await fetch(`${API_BASE}/api/auth/register`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name,
        email,
        password,
        role,
      }),
    });

    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Registration failed");
    }

    const data = await res.json();

    saveSession(data.access_token, data.user);

    return data.user;
  };

  // ─── Google OAuth ─────────────────────────────────────────
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

    if (data?.url) {
      window.location.href = data.url;
    }
  };

  // ─── Logout ───────────────────────────────────────────────
  const logout = async () => {
    try {
      await fetch("/auth/signout", {
        method: "POST",
      });
    } catch {
      await supabase.auth.signOut();
    }

    localStorage.removeItem("jwt_token");
    localStorage.removeItem("user_data");

    setUser(null);
    setToken(null);

    router.push("/login");
  };

  // ─── Refresh User ─────────────────────────────────────────
  const refreshUser = useCallback(async () => {
    const savedToken = localStorage.getItem("jwt_token");

    if (!savedToken) return null;

    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: {
          Authorization: `Bearer ${savedToken}`,
        },
      });

      if (!res.ok) return null;

      const freshUser = await res.json();

      localStorage.setItem(
        "user_data",
        JSON.stringify(freshUser)
      );

      setUser(freshUser);

      return freshUser;
    } catch {
      return null;
    }
  }, []);

  // ─── Authenticated fetch wrapper ──────────────────────────
  const authFetch = useCallback(
    async (url, options = {}) => {
      let activeToken = token;

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (session?.access_token) {
        activeToken = session.access_token;

        if (activeToken !== token) {
          setToken(activeToken);
        }
      }

      const headers = {
        "Content-Type": "application/json",
        ...(activeToken
          ? {
              Authorization: `Bearer ${activeToken}`,
            }
          : {}),
        ...(options.headers || {}),
      };

      return fetch(`${API_BASE}${url}`, {
        ...options,
        headers,
      });
    },
    [token, supabase]
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        token,
        loading,
        login,
        register,
        loginWithGoogle,
        logout,
        authFetch,
        refreshUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);

  if (!ctx) {
    throw new Error(
      "useAuth must be used inside <AuthProvider>"
    );
  }

  return ctx;
}