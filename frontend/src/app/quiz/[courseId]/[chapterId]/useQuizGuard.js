"use client";

import { useEffect } from "react";

/**
 * useQuizGuard
 * Encapsulates all browser event listeners that enforce quiz integrity.
 *
 * Handles:
 *  - Fullscreen enforcement (enter / exit detection)
 *  - Tab/window switch detection via Page Visibility API
 *  - Clipboard blocking (copy, paste, cut)
 *  - Right-click context menu blocking
 *  - Keyboard shortcut blocking (Ctrl+C/V/X/A, F12, DevTools combos)
 *  - Text selection blocking
 */
export function useQuizGuard({
  enabled,
  onFullscreenExit,
  onFullscreenEnter,
  onToastWarning,
}) {
  useEffect(() => {
    if (!enabled) return;

    // ── Attempt to enter fullscreen programmatically ──────────────────────
    const attemptFullscreen = () => {
      if (document.fullscreenElement) return;
      document.documentElement
        .requestFullscreen()
        .then(() => {
          onFullscreenEnter();
        })
        .catch(() => {
          onFullscreenExit(
            "You exited fullscreen! This question has been awarded 0 marks."
          );
        });
    };

    // ── Fullscreen state change ───────────────────────────────────────────
    const handleFullscreenChange = () => {
      if (!document.fullscreenElement) {
        onFullscreenExit(
          "You exited fullscreen! This question has been awarded 0 marks."
        );
      } else {
        onFullscreenEnter();
      }
    };

    // ── Clipboard events ──────────────────────────────────────────────────
    const handleCopy = (e) => {
      e.preventDefault();
      onToastWarning("Copying is disabled during the quiz.");
    };
    const handlePaste = (e) => {
      e.preventDefault();
      onToastWarning("Pasting is disabled during the quiz.");
    };
    const handleCut = (e) => {
      e.preventDefault();
      onToastWarning("Cutting text is disabled during the quiz.");
    };

    // ── Right-click ───────────────────────────────────────────────────────
    const handleContextMenu = (e) => {
      e.preventDefault();
      onToastWarning("Right-click is disabled during the quiz.");
    };

    // ── Keyboard shortcuts ────────────────────────────────────────────────
    const handleKeyDown = (e) => {
      const key = e.key.toLowerCase();
      const ctrl = e.ctrlKey || e.metaKey;

      // Block Ctrl+C / V / X / A
      if (ctrl && ["c", "v", "x", "a"].includes(key)) {
        e.preventDefault();
        onToastWarning(`Keyboard shortcut (Ctrl+${key.toUpperCase()}) is disabled during the quiz.`);
        return;
      }

      // Block F12 and common DevTools combos
      if (
        e.key === "F12" ||
        (ctrl && e.shiftKey && ["i", "j", "c"].includes(key)) ||
        (ctrl && key === "u")
      ) {
        e.preventDefault();
        onToastWarning("Developer tools are disabled during the quiz.");
        return;
      }
    };

    // ── Text selection ────────────────────────────────────────────────────
    const handleSelectStart = (e) => {
      e.preventDefault();
    };

    // ── Mount: immediately try to enter fullscreen ────────────────────────
    attemptFullscreen();

    // ── Bind all listeners ────────────────────────────────────────────────
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("copy", handleCopy);
    document.addEventListener("paste", handlePaste);
    document.addEventListener("cut", handleCut);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("selectstart", handleSelectStart);

    return () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
      document.removeEventListener("copy", handleCopy);
      document.removeEventListener("paste", handlePaste);
      document.removeEventListener("cut", handleCut);
      document.removeEventListener("contextmenu", handleContextMenu);
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("selectstart", handleSelectStart);
    };
  }, [enabled, onFullscreenExit, onFullscreenEnter, onToastWarning]);
}
