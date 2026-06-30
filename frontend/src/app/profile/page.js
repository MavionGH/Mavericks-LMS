"use client";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useState, useRef } from "react";

function ProfilePage() {
  const { user, authFetch, refreshUser } = useAuth();
  
  const [name, setName] = useState(user?.name || "");
  const [certName, setCertName] = useState(user?.certificate_name || "");
  const [password, setPassword] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || null);
  const [avatarFile, setAvatarFile] = useState(null);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [msgType, setMsgType] = useState("success"); // success | error

  const fileInputRef = useRef(null);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatarFile(file);
      const reader = new FileReader();
      reader.onloadend = () => {
        setAvatarPreview(reader.result);
      };
      reader.readAsDataURL(file);
    }
  };

  const triggerFileInput = () => {
    fileInputRef.current.click();
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);

    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("certificate_name", certName);
      if (password) {
        formData.append("password", password);
      }
      if (avatarFile) {
        formData.append("avatar_file", avatarFile);
      }

      const res = await authFetch("/api/auth/profile", {
        method: "PUT",
        body: formData,
      });

      if (res.ok) {
        setMessage("Profile updated successfully!");
        setMsgType("success");
        setPassword(""); // Clear password field
        // Refresh the user context so the header and fields are updated
        await refreshUser();
      } else {
        const errData = await res.json();
        setMessage(errData.detail || "Failed to update profile.");
        setMsgType("error");
      }
    } catch (err) {
      console.error(err);
      setMessage("An unexpected error occurred.");
      setMsgType("error");
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", minHeight: "calc(100vh - 64px)", display: "flex", justifyContent: "center", alignItems: "center", padding: "40px 20px" }}>
        <div style={{
          backgroundColor: "#ffffff",
          borderRadius: "16px",
          boxShadow: "0 4px 20px rgba(0, 0, 0, 0.05), 0 1px 3px rgba(0, 0, 0, 0.02)",
          border: "1px solid #f1f5f9",
          width: "100%",
          maxWidth: "520px",
          overflow: "hidden",
          transition: "all 0.3s ease",
        }}>
          {/* Header Banner */}
          <div style={{
            background: "linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)",
            padding: "32px 24px",
            color: "#ffffff",
            textAlign: "center",
            position: "relative",
          }}>
            <h2 style={{ fontSize: "22px", fontWeight: "700", marginBottom: "6px" }}>Account Settings</h2>
            <p style={{ fontSize: "13px", opacity: 0.9 }}>Update your personal details and certificate preferences</p>
          </div>

          <form onSubmit={handleSubmit} style={{ padding: "32px 32px 24px" }}>
            {/* Avatar section */}
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "28px" }}>
              <div 
                onClick={triggerFileInput}
                style={{
                  position: "relative",
                  width: "90px",
                  height: "90px",
                  borderRadius: "50%",
                  cursor: "pointer",
                  overflow: "hidden",
                  border: "3px solid #ffffff",
                  boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
                  backgroundColor: "#f8fafc",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  group: "true",
                  transition: "transform 0.2s ease",
                }}
                onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
                onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
              >
                {avatarPreview ? (
                  <img 
                    src={avatarPreview} 
                    alt="Profile Preview" 
                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                  />
                ) : (
                  <div style={{
                    width: "100%",
                    height: "100%",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    background: "#4f46e511",
                    color: "#4f46e5",
                    fontWeight: "700",
                    fontSize: "28px",
                    textTransform: "uppercase"
                  }}>
                    {name ? name.charAt(0) : "U"}
                  </div>
                )}
                {/* Hover overlay */}
                <div style={{
                  position: "absolute",
                  bottom: 0,
                  left: 0,
                  width: "100%",
                  height: "35%",
                  backgroundColor: "rgba(15, 23, 42, 0.6)",
                  color: "#ffffff",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: "10px",
                  fontWeight: "600",
                  letterSpacing: "0.05em",
                }}>
                  EDIT
                </div>
              </div>
              
              <input 
                type="file"
                ref={fileInputRef}
                onChange={handleAvatarChange}
                accept="image/*"
                style={{ display: "none" }}
              />
              
              <button 
                type="button" 
                onClick={triggerFileInput} 
                style={{
                  background: "transparent",
                  border: "none",
                  color: "#4f46e5",
                  fontSize: "12px",
                  fontWeight: "600",
                  marginTop: "8px",
                  cursor: "pointer",
                }}
              >
                Change Photo
              </button>
            </div>

            {/* Alert Message */}
            {message && (
              <div style={{
                padding: "12px 16px",
                borderRadius: "8px",
                fontSize: "13px",
                fontWeight: "500",
                marginBottom: "20px",
                backgroundColor: msgType === "success" ? "#f0fdf4" : "#fef2f2",
                color: msgType === "success" ? "#16a34a" : "#dc2626",
                border: `1px solid ${msgType === "success" ? "#bbf7d0" : "#fecaca"}`,
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}>
                {msgType === "success" ? (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="12" cy="12" r="10" />
                    <line x1="12" y1="8" x2="12" y2="12" />
                    <line x1="12" y1="16" x2="12.01" y2="16" />
                  </svg>
                )}
                {message}
              </div>
            )}

            {/* Form Fields */}
            <div style={{ display: "flex", flexDirection: "column", gap: "18px" }}>
              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", fontFamily: "JetBrains Mono" }}>
                  FULL NAME
                </label>
                <input 
                  type="text"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "14px",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#4f46e5"}
                  onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
                />
              </div>

              {user?.role === "student" && (
                <div>
                  <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", fontFamily: "JetBrains Mono" }}>
                    NAME FOR CERTIFICATE
                  </label>
                  <input 
                    type="text"
                    placeholder="Defaults to Full Name if blank"
                    value={certName}
                    onChange={(e) => setCertName(e.target.value)}
                    style={{
                      width: "100%",
                      padding: "10px 14px",
                      borderRadius: "8px",
                      border: "1px solid #cbd5e1",
                      fontSize: "14px",
                      outline: "none",
                      transition: "border-color 0.2s",
                    }}
                    onFocus={(e) => e.target.style.borderColor = "#4f46e5"}
                    onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
                  />
                </div>
              )}

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#94a3b8", marginBottom: "6px", fontFamily: "JetBrains Mono" }}>
                  EMAIL ADDRESS (CANNOT BE CHANGED)
                </label>
                <input 
                  type="email"
                  disabled
                  value={user?.email || ""}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#f8fafc",
                    color: "#94a3b8",
                    fontSize: "14px",
                    cursor: "not-allowed",
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#94a3b8", marginBottom: "6px", fontFamily: "JetBrains Mono" }}>
                  ACCOUNT ROLE (CANNOT BE CHANGED)
                </label>
                <input 
                  type="text"
                  disabled
                  value={user?.role || ""}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #e2e8f0",
                    backgroundColor: "#f8fafc",
                    color: "#94a3b8",
                    fontSize: "14px",
                    cursor: "not-allowed",
                    textTransform: "capitalize"
                  }}
                />
              </div>

              <div>
                <label style={{ display: "block", fontSize: "12px", fontWeight: "600", color: "#64748b", marginBottom: "6px", fontFamily: "JetBrains Mono" }}>
                  CHANGE PASSWORD (OPTIONAL)
                </label>
                <input 
                  type="password"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  style={{
                    width: "100%",
                    padding: "10px 14px",
                    borderRadius: "8px",
                    border: "1px solid #cbd5e1",
                    fontSize: "14px",
                    outline: "none",
                    transition: "border-color 0.2s",
                  }}
                  onFocus={(e) => e.target.style.borderColor = "#4f46e5"}
                  onBlur={(e) => e.target.style.borderColor = "#cbd5e1"}
                />
              </div>
            </div>

            <div style={{ marginTop: "32px", display: "flex", justifyContent: "flex-end" }}>
              <button 
                type="submit"
                disabled={isSubmitting}
                className="btn btn-primary"
                style={{
                  width: "100%",
                  padding: "12px",
                  borderRadius: "8px",
                  fontSize: "14px",
                  fontWeight: "600",
                  cursor: isSubmitting ? "not-allowed" : "pointer",
                }}
              >
                {isSubmitting ? "Saving changes..." : "Save Changes"}
              </button>
            </div>
          </form>
        </div>
      </div>
    </>
  );
}

export default withAuth(ProfilePage);
