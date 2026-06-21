"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";

const API_BASE = "http://localhost:8000";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser]       = useState(null);
  const [token, setToken]     = useState(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  // ─── Restore session from localStorage on mount ───
  useEffect(() => {
    const savedToken = localStorage.getItem("jwt_token");
    const savedUser  = localStorage.getItem("user_data");
    if (savedToken && savedUser) {
      setToken(savedToken);
      setUser(JSON.parse(savedUser));
    }
    setLoading(false);
  }, []);

  // ─── Helpers ───
  const saveSession = (accessToken, userData) => {
    localStorage.setItem("jwt_token", accessToken);
    localStorage.setItem("user_data", JSON.stringify(userData));
    setToken(accessToken);
    setUser(userData);
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

  const logout = () => {
    clearSession();
    router.push("/login");
  };

  // ─── Authenticated fetch wrapper ───
  const authFetch = useCallback(
    async (url, options = {}) => {
      const headers = {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers || {}),
      };
      return fetch(`${API_BASE}${url}`, { ...options, headers });
    },
    [token]
  );

  return (
    <AuthContext.Provider value={{ user, token, loading, login, register, logout, authFetch }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside <AuthProvider>");
  return ctx;
}
