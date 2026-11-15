"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { flushSync } from "react-dom";
import { useRouter } from "next/navigation";

export const API_BASE = "http://localhost:8000";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // ─── Restore session from localStorage on mount ───
  // Legitimate "sync from an external system" effect: localStorage is only
  // available on the client, and reading it via a lazy useState initializer
  // would cause an SSR/CSR hydration mismatch. Restoring after mount is correct,
  // so the synchronous setState here is intentional.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const savedToken = localStorage.getItem("jwt_token");
    const savedUser  = localStorage.getItem("user_data");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  // ─── Helpers ───
  const saveSession = (accessToken, userData) => {
    localStorage.setItem("jwt_token", accessToken);
    localStorage.setItem("user_data", JSON.stringify(userData));
    // flushSync ensures React commits these updates synchronously so the
    // target page sees the correct user state immediately after router.push()
    flushSync(() => {
      setToken(accessToken);
      setUser(userData);
    });
  };

  const clearSession = () => {
    localStorage.removeItem("jwt_token");
    localStorage.removeItem("user_data");
    setToken(null);
    setUser(null);
  };

  // ─── Auth Actions ───
  const login = async (email, password) => {
    const res = await fetch(`${API_BASE}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Login failed");
    }
    const data = await res.json();
    saveSession(data.access_token, data.user);
    return data.user;
  };

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
    saveSession(data.access_token, data.user);
    return data.user;
  };

  const loginWithGoogle = async (credentialToken, role = null) => {
    const res = await fetch(`${API_BASE}/api/auth/google`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credential_token: credentialToken, role }),
    });
    if (!res.ok) {
      const err = await res.json();
      throw new Error(err.detail || "Google authentication failed");
    }
    const data = await res.json();
    // If the backend says "needs_role", we return the status to let the frontend prompt the user
    if (data.status === "needs_role") {
      return data;
    }
    saveSession(data.access_token, data.user);
    return data.user;
  };

  const logout = () => {
    clearSession();
    router.push("/login");
  };

  const refreshUser = useCallback(async () => {
    const savedToken = localStorage.getItem("jwt_token");
    if (!savedToken) return null;
    try {
      const res = await fetch(`${API_BASE}/api/auth/me`, {
        headers: { Authorization: `Bearer ${savedToken}` },
      });
      if (!res.ok) return null;
      const freshUser = await res.json();
      localStorage.setItem("user_data", JSON.stringify(freshUser));
      setUser(freshUser);
      return freshUser;
    } catch {
      return null;
    }
  }, []);

  // ─── Authenticated fetch wrapper ───
  const authFetch = useCallback(
    async (url, options = {}) => {
      // For FormData (file upload) let the browser set the multipart Content-Type
      // with its boundary — forcing application/json would corrupt the upload.
      const isFormData = typeof FormData !== "undefined" && options.body instanceof FormData;
      const headers = {
        ...(isFormData ? {} : { "Content-Type": "application/json" }),
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      };
      return fetch(`${API_BASE}${url}`, { ...options, headers });
    },
    [token]
  );

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, loginWithGoogle, logout, authFetch, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
