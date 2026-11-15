"use client";
import React from "react";

export default function Skeleton({
  variant = "text", // "text" | "circular" | "rectangular"
  width,
  height,
  borderRadius,
  style = {},
  className = "",
}) {
  const getStyles = () => {
    const base = {
      display: "block",
      width: width || (variant === "circular" ? 40 : "100%"),
      height: height || (variant === "text" ? "14px" : variant === "circular" ? 40 : 100),
      borderRadius: borderRadius || (variant === "circular" ? "50%" : variant === "text" ? "4px" : "8px"),
      marginTop: variant === "text" ? "6px" : 0,
      marginBottom: variant === "text" ? "6px" : 0,
    };
    return { ...base, ...style };
  };

  return (
    <span
      className={`skeleton-shimmer-bg ${className}`}
      style={getStyles()}
    />
  );
}

// ─── Preset Skeleton Layouts ───

export function SkeletonCardGrid({ count = 3 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(300px, 1fr))", gap: "24px", width: "100%" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
          <Skeleton variant="rectangular" height={160} />
          <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
            <Skeleton variant="text" width="40%" height={12} />
            <Skeleton variant="text" width="85%" height={18} />
            <Skeleton variant="text" width="60%" height={14} />
          </div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: "12px" }}>
            <Skeleton variant="text" width="30%" height={16} />
            <Skeleton variant="rectangular" width="90px" height={36} borderRadius="4px" />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkeletonMetrics({ count = 4 }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "20px", width: "100%", marginBottom: "28px" }}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <Skeleton variant="text" width="30px" height={28} />
          <Skeleton variant="text" width="60%" height={12} />
        </div>
      ))}
    </div>
  );
}

export function SkeletonTable({ rows = 5, cols = 5 }) {
  return (
    <div className="table-container" style={{ margin: 0 }}>
      <table>
        <thead>
          <tr>
            {Array.from({ length: cols }).map((_, i) => (
              <th key={i}>
                <Skeleton variant="text" width="60%" height={14} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }).map((_, c) => (
                <td key={c}>
                  <Skeleton variant="text" width={c === 0 ? "70%" : "50%"} height={14} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkeletonProfile() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "24px", width: "100%" }}>
      {/* Identity Card */}
      <div className="card admin-identity-card" style={{ padding: "24px" }}>
        <Skeleton variant="circular" width={60} height={60} />
        <div className="admin-identity-info" style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
          <Skeleton variant="text" width="180px" height={22} />
          <Skeleton variant="text" width="220px" height={14} />
        </div>
        <div className="admin-identity-stats" style={{ display: "flex", gap: "16px" }}>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} style={{ minWidth: "60px" }}>
              <Skeleton variant="text" width="30px" height={24} />
              <Skeleton variant="text" width="40px" height={10} />
            </div>
          ))}
        </div>
      </div>
      {/* Content areas */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "20px" }}>
        <div className="card" style={{ padding: "20px" }}>
          <Skeleton variant="text" width="50%" height={18} style={{ marginBottom: "16px" }} />
          <Skeleton variant="text" width="90%" height={14} />
          <Skeleton variant="text" width="80%" height={14} />
          <Skeleton variant="text" width="85%" height={14} />
        </div>
        <div className="card" style={{ padding: "20px" }}>
          <Skeleton variant="text" width="50%" height={18} style={{ marginBottom: "16px" }} />
          <Skeleton variant="text" width="95%" height={14} />
          <Skeleton variant="text" width="70%" height={14} />
          <Skeleton variant="text" width="80%" height={14} />
        </div>
      </div>
    </div>
  );
}

export function SkeletonClassroom() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "280px 1fr", gap: "28px", minHeight: "80vh", width: "100%" }}>
      {/* Sidebar */}
      <div className="card" style={{ padding: "20px", display: "flex", flexDirection: "column", gap: "16px" }}>
        <Skeleton variant="text" width="60%" height={18} />
        <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ display: "flex", gap: "8px", alignItems: "center" }}>
              <Skeleton variant="circular" width={16} height={16} />
              <Skeleton variant="text" width="80%" height={14} />
            </div>
          ))}
        </div>
      </div>
      {/* Main Content */}
      <div style={{ display: "flex", flexDirection: "column", gap: "24px" }}>
        <Skeleton variant="rectangular" height={450} borderRadius="8px" />
        <div className="card" style={{ padding: "24px" }}>
          <Skeleton variant="text" width="40%" height={24} style={{ marginBottom: "12px" }} />
          <Skeleton variant="text" width="100%" height={14} />
          <Skeleton variant="text" width="95%" height={14} />
          <Skeleton variant="text" width="80%" height={14} />
        </div>
      </div>
    </div>
  );
}
