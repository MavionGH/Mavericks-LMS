"use client";

import React from "react";

export default function Spinner({ text = "Loading...", padding = "40px" }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", padding, gap: "16px", textAlign: "center", width: "100%" }}>
      <div style={{
        width: "32px",
        height: "32px",
        border: "3px solid var(--border-muted)",
        borderTopColor: "var(--brand)",
        borderRadius: "50%",
        animation: "spin 0.8s linear infinite"
      }} />
      {text && (
        <span style={{ fontSize: "14px", fontWeight: "500", color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>
          {text}
        </span>
      )}
    </div>
  );
}
