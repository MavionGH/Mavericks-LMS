"use client";

/**
 * TabWarningOverlay
 *
 * Shown when the student switches away from the quiz tab/window.
 * Unlike the fullscreen overlay, switching back is enough — no fullscreen
 * restore is needed. The student just clicks "Resume Quiz" to dismiss.
 */
export function TabWarningOverlay({ visible, message, warningCount, onResume }) {
  if (!visible) return null;

  return (
    <div
      className="quiz-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="tab-warning-title"
    >
      <div className="overlay-card" style={{ cursor: "default" }}>
        {/* Icon */}
        <div className="overlay-icon overlay-icon-warning" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <rect x="2" y="3" width="20" height="14" rx="2" ry="2"/>
            <line x1="8" y1="21" x2="16" y2="21"/>
            <line x1="12" y1="17" x2="12" y2="21"/>
          </svg>
        </div>

        {/* Badge */}
        <div className="overlay-badge overlay-badge-warning">
          Tab switch violation #{warningCount}
        </div>

        {/* Heading */}
        <h2 id="tab-warning-title" className="overlay-title">
          Do not leave this tab
        </h2>

        {/* Body */}
        <p className="overlay-body">
          {message ?? "You navigated away from the quiz. This incident has been recorded."}
        </p>

        <div className="overlay-rules">
          <p className="overlay-rules-heading">Reminder — quiz integrity rules:</p>
          <ul>
            <li>Stay on this tab for the entire quiz duration</li>
            <li>Opening new tabs or windows is not permitted</li>
            <li>Each tab-switch violation is logged for review</li>
          </ul>
        </div>

        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}
          onClick={onResume}
        >
          I Understand — Resume Quiz
        </button>
      </div>
    </div>
  );
}
