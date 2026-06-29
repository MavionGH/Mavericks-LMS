"use client";

/**
 * FullscreenWarningOverlay
 *
 * Covers the entire viewport while the student is outside fullscreen mode.
 * Clicking anywhere on the backdrop or the "Resume Fullscreen" button
 * triggers onResumeFullscreen(), which calls requestFullscreen() inside a
 * real user-gesture context so the browser allows it.
 */
export function FullscreenWarningOverlay({ visible, message, warningCount, onResumeFullscreen }) {
  if (!visible) return null;

  return (
    <div
      className="quiz-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="fullscreen-warning-title"
      onClick={onResumeFullscreen}
      style={{ cursor: "pointer" }}
    >
      <div
        className="overlay-card"
        onClick={(e) => e.stopPropagation()}
        style={{ cursor: "default" }}
      >
        {/* Icon */}
        <div className="overlay-icon" aria-hidden="true">
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>

        {/* Badge */}
        <div className="overlay-badge">
          Fullscreen violation #{warningCount}
        </div>

        {/* Heading */}
        <h2 id="fullscreen-warning-title" className="overlay-title">
          You must stay in fullscreen
        </h2>

        {/* Body */}
        <p className="overlay-body">
          {message ?? "You exited fullscreen. The current question has been marked with 0 marks and the quiz has advanced."}
        </p>

        <div className="overlay-rules">
          <p className="overlay-rules-heading">Quiz integrity rules:</p>
          <ul>
            <li>Stay in fullscreen for the entire quiz</li>
            <li>Do not switch tabs or windows</li>
            <li>Copying, pasting, and right-clicking are disabled</li>
            <li>Each violation is logged and penalised with 0 marks</li>
          </ul>
        </div>

        {/* CTA */}
        <button
          type="button"
          className="btn btn-primary"
          style={{ width: "100%", justifyContent: "center", marginTop: "4px" }}
          onClick={onResumeFullscreen}
        >
          Resume Fullscreen &amp; Continue
        </button>

        <p className="overlay-hint">
          Click anywhere outside this card or the button above to re-enter fullscreen.
        </p>
      </div>
    </div>
  );
}
