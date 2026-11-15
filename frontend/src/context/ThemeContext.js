"use client";
import { createContext, useContext, useState, useEffect, useCallback } from "react";

const ThemeContext = createContext(null);

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState("light");

  // ─── Restore theme from localStorage (or system preference) on mount ───
  // Same "sync from an external system" pattern as AuthContext: localStorage
  // and matchMedia are client-only, so we default to "light" for SSR and
  // correct it after mount to avoid a hydration mismatch.
  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    const stored = localStorage.getItem("theme");
    const initial =
      stored || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
    setTheme(initial);
    document.documentElement.classList.toggle("dark", initial === "dark");
    /* eslint-enable react-hooks/set-state-in-effect */
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "dark" ? "light" : "dark";
      localStorage.setItem("theme", next);
      document.documentElement.classList.toggle("dark", next === "dark");
      return next;
    });
  }, []);

  return (
    <ThemeContext.Provider value={{ theme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used inside <ThemeProvider>");
  return ctx;
}
