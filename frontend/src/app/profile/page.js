"use client";
import Navbar from "@/components/Navbar";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useState, useRef, useEffect } from "react";

function ProfilePage() {
  const { user, authFetch, refreshUser } = useAuth();
  
  const [name, setName] = useState(user?.name || "");
  const [certName, setCertName] = useState(user?.certificate_name || "");
  const [password, setPassword] = useState("");
  const [avatarPreview, setAvatarPreview] = useState(user?.avatar || null);
  const [avatarFile, setAvatarFile] = useState(null);
  const [avatarRemoved, setAvatarRemoved] = useState(false);
  
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [message, setMessage] = useState(null);
  const [msgType, setMsgType] = useState("success");

  // Tab State
  const [activeTab, setActiveTab] = useState("settings"); // "settings" | "certificates"

  // Certificates state
  const [certs, setCerts] = useState([]);
  const [certsLoading, setCertsLoading] = useState(false);
  const [selectedCert, setSelectedCert] = useState(null);

  const fileInputRef = useRef(null);

  // Sync activeTab with URL hash
  useEffect(() => {
    const handleHashChange = () => {
      const hash = typeof window !== "undefined" ? window.location.hash : "";
      if (hash === "#certificates" && user?.role === "student") {
        setActiveTab("certificates");
      } else {
        setActiveTab("settings");
      }
      if (typeof window !== "undefined") {
        window.scrollTo(0, 0);
      }
    };

    handleHashChange();
    window.addEventListener("hashchange", handleHashChange);
    return () => window.removeEventListener("hashchange", handleHashChange);
  }, [user]);

  // Load certificates for students
  useEffect(() => {
    if (user?.role !== "student") return;
    setCertsLoading(true);
    authFetch("/api/student/certificates")
      .then((res) => res.ok ? res.json() : [])
      .then((data) => {
        setCerts(data);
        if (data.length > 0) setSelectedCert(data[0]);
      })
      .catch(() => {})
      .finally(() => setCertsLoading(false));
  }, [authFetch, user?.role]);

  const handleAvatarChange = (e) => {
    const file = e.target.files[0];
    if (file) {
      setAvatarFile(file);
      setAvatarRemoved(false);
      const reader = new FileReader();
      reader.onloadend = () => setAvatarPreview(reader.result);
      reader.readAsDataURL(file);
    }
  };

  const handleRemoveAvatar = () => {
    setAvatarFile(null);
    setAvatarPreview(null);
    setAvatarRemoved(true);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const triggerFileInput = () => fileInputRef.current.click();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsSubmitting(true);
    setMessage(null);
    try {
      const formData = new FormData();
      formData.append("name", name);
      formData.append("certificate_name", certName);
      if (password) formData.append("password", password);
      if (avatarFile) {
        formData.append("avatar_file", avatarFile);
      } else if (avatarRemoved) {
        formData.append("remove_avatar", "true");
      }

      const res = await authFetch("/api/auth/profile", { method: "PUT", body: formData });
      if (res.ok) {
        setMessage("Profile updated successfully!");
        setMsgType("success");
        setPassword("");
        setAvatarRemoved(false);
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

  const handleTabSwitch = (tab) => {
    if (typeof window !== "undefined") {
      window.location.hash = tab === "certificates" ? "#certificates" : "#settings";
    }
    setActiveTab(tab);
  };

  const handlePrint = () => window.print();
  const displayName = user?.certificate_name || user?.name || "Student Name";

  const inputStyle = {
    width: "100%", padding: "10px 14px", borderRadius: "8px",
    border: "1px solid var(--border-subtle)", fontSize: "14px", outline: "none",
    transition: "border-color 0.2s", fontFamily: "inherit",
  };
  const disabledInputStyle = {
    ...inputStyle, border: "1px solid var(--border-muted)",
    backgroundColor: "var(--bg-canvas)", color: "var(--text-subtle)", cursor: "not-allowed",
  };
  const labelStyle = {
    display: "block", fontSize: "12px", fontWeight: "600",
    color: "var(--text-muted)", marginBottom: "6px", fontFamily: "JetBrains Mono",
  };

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", padding: "80px 20px 60px" }}>
        <div style={{ maxWidth: "560px", margin: "0 auto", display: "flex", flexDirection: "column", gap: "20px" }}>
          
          {/* Segmented Tab Swapper for Students */}
          {user?.role === "student" && (
            <div className="no-print" style={{
              display: "flex",
              background: "var(--bg-surface)",
              padding: "4px",
              borderRadius: "10px",
              border: "1px solid var(--border-muted)",
              boxShadow: "var(--shadow-sm)",
              marginBottom: "8px"
            }}>
              <button
                onClick={() => handleTabSwitch("settings")}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px",
                  border: "none",
                  background: activeTab === "settings" ? "var(--brand)" : "transparent",
                  color: activeTab === "settings" ? "#ffffff" : "var(--text-main)",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontSize: "13.5px",
                }}
              >
                Profile Settings
              </button>
              <button
                onClick={() => handleTabSwitch("certificates")}
                style={{
                  flex: 1,
                  padding: "10px",
                  borderRadius: "8px",
                  border: "none",
                  background: activeTab === "certificates" ? "var(--brand)" : "transparent",
                  color: activeTab === "certificates" ? "#ffffff" : "var(--text-main)",
                  fontWeight: "600",
                  cursor: "pointer",
                  transition: "all 0.2s ease",
                  fontSize: "13.5px",
                }}
              >
                My Certificates
              </button>
            </div>
          )}

          {/* Tab 1: Profile Settings Form */}
          {activeTab === "settings" && (
            <div style={{
              backgroundColor: "var(--bg-surface)", borderRadius: "16px",
              boxShadow: "var(--shadow-md)",
              border: "1px solid var(--border-muted)", overflow: "hidden",
            }}>
              {/* Header Banner */}
              <div style={{
                background: "linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)",
                padding: "28px 24px", color: "#ffffff", textAlign: "center",
              }}>
                <h2 style={{ fontSize: "20px", fontWeight: "700", marginBottom: "4px" }}>Account Settings</h2>
                <p style={{ fontSize: "13px", opacity: 0.85 }}>Update your personal details and certificate preferences</p>
              </div>

              <form onSubmit={handleSubmit} style={{ padding: "28px 32px 24px" }}>
                {/* Avatar section */}
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", marginBottom: "24px" }}>
                  <div
                    onClick={triggerFileInput}
                    style={{
                      position: "relative", width: "90px", height: "90px",
                      borderRadius: "50%", cursor: "pointer", overflow: "hidden",
                      border: "3px solid #ffffff", boxShadow: "0 4px 10px rgba(0,0,0,0.1)",
                      backgroundColor: "var(--bg-canvas)", display: "flex",
                      alignItems: "center", justifyContent: "center",
                      transition: "transform 0.2s ease",
                    }}
                    onMouseEnter={(e) => e.currentTarget.style.transform = "scale(1.03)"}
                    onMouseLeave={(e) => e.currentTarget.style.transform = "scale(1)"}
                  >
                    {avatarPreview ? (
                      <img src={avatarPreview} alt="Profile Preview" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
                    ) : (
                      <div style={{
                        width: "100%", height: "100%", display: "flex",
                        alignItems: "center", justifyContent: "center",
                        background: "linear-gradient(135deg, #4f46e5 0%, #3b82f6 100%)",
                        color: "#ffffff", fontWeight: "700", fontSize: "28px", textTransform: "uppercase",
                      }}>
                        {name ? name.charAt(0) : "U"}
                      </div>
                    )}
                    <div style={{
                      position: "absolute", bottom: 0, left: 0, width: "100%", height: "35%",
                      backgroundColor: "rgba(15,23,42,0.6)", color: "#ffffff",
                      display: "flex", alignItems: "center", justifyContent: "center",
                      fontSize: "10px", fontWeight: "600", letterSpacing: "0.05em",
                    }}>
                      EDIT
                    </div>
                  </div>
                  <input type="file" ref={fileInputRef} onChange={handleAvatarChange} accept="image/*" style={{ display: "none" }} />
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "8px" }}>
                    <button type="button" onClick={triggerFileInput} style={{
                      background: "transparent", border: "none", color: "var(--brand)",
                      fontSize: "12px", fontWeight: "600", cursor: "pointer",
                    }}>
                      Change Photo
                    </button>
                    {avatarPreview && (
                      <>
                        <span style={{ color: "var(--border-subtle)", fontSize: "12px" }}>·</span>
                        <button type="button" onClick={handleRemoveAvatar} style={{
                          background: "transparent", border: "none", color: "var(--color-danger)",
                          fontSize: "12px", fontWeight: "600", cursor: "pointer",
                        }}>
                          Remove Photo
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Alert Message */}
                {message && (
                  <div style={{
                    padding: "12px 16px", borderRadius: "8px", fontSize: "13px",
                    fontWeight: "500", marginBottom: "20px",
                    backgroundColor: msgType === "success" ? "var(--bg-success)" : "var(--bg-danger)",
                    color: msgType === "success" ? "var(--color-success)" : "var(--color-danger)",
                    border: `1px solid ${msgType === "success" ? "var(--border-success)" : "var(--border-danger)"}`,
                    display: "flex", alignItems: "center", gap: "8px",
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
                    <label style={labelStyle}>FULL NAME</label>
                    <input type="text" required value={name} onChange={(e) => setName(e.target.value)}
                      style={inputStyle}
                      onFocus={(e) => e.target.style.borderColor = "var(--brand)"}
                      onBlur={(e) => e.target.style.borderColor = "var(--border-subtle)"}
                    />
                  </div>

                  {user?.role === "student" && (
                    <div>
                      <label style={labelStyle}>NAME FOR CERTIFICATE</label>
                      <input type="text" placeholder="Defaults to Full Name if blank"
                        value={certName} onChange={(e) => setCertName(e.target.value)}
                        style={inputStyle}
                        onFocus={(e) => e.target.style.borderColor = "var(--brand)"}
                        onBlur={(e) => e.target.style.borderColor = "var(--border-subtle)"}
                      />
                    </div>
                  )}

                  <div>
                    <label style={{ ...labelStyle, color: "var(--text-subtle)" }}>EMAIL ADDRESS (CANNOT BE CHANGED)</label>
                    <input type="email" disabled value={user?.email || ""} style={disabledInputStyle} />
                  </div>

                  <div>
                    <label style={{ ...labelStyle, color: "var(--text-subtle)" }}>ACCOUNT ROLE (CANNOT BE CHANGED)</label>
                    <input type="text" disabled value={user?.role || ""} style={{ ...disabledInputStyle, textTransform: "capitalize" }} />
                  </div>

                  <div>
                    <label style={labelStyle}>CHANGE PASSWORD (OPTIONAL)</label>
                    <input type="password" placeholder="••••••••" value={password}
                      onChange={(e) => setPassword(e.target.value)} style={inputStyle}
                      onFocus={(e) => e.target.style.borderColor = "var(--brand)"}
                      onBlur={(e) => e.target.style.borderColor = "var(--border-subtle)"}
                    />
                  </div>
                </div>

                <div style={{ marginTop: "28px" }}>
                  <button type="submit" disabled={isSubmitting} className="btn btn-primary" style={{
                    width: "100%", padding: "12px", borderRadius: "8px",
                    fontSize: "14px", fontWeight: "600",
                    cursor: isSubmitting ? "not-allowed" : "pointer",
                  }}>
                    {isSubmitting ? "Saving changes..." : "Save Changes"}
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* Tab 2: Certificates Section (students only) */}
          {user?.role === "student" && activeTab === "certificates" && (
            <div
              id="certificates"
              style={{
                backgroundColor: "var(--bg-surface)", borderRadius: "16px",
                boxShadow: "var(--shadow-md)",
                border: "1px solid var(--border-muted)", overflow: "hidden",
              }}
            >
              {/* Section header */}
              <div className="no-print" style={{
                padding: "20px 28px",
                borderBottom: "1px solid var(--border-muted)",
                display: "flex",
                alignItems: "center",
                gap: "12px",
              }}>
                <div style={{
                  width: "36px", height: "36px", borderRadius: "8px",
                  background: "var(--brand-muted)", display: "flex",
                  alignItems: "center", justifyContent: "center",
                }}>
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                    <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                  </svg>
                </div>
                <div>
                  <h2 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", margin: 0 }}>
                    My Certificates
                  </h2>
                  <p style={{ fontSize: "12px", color: "var(--text-muted)", margin: 0 }}>
                    Earned by completing all modules and passing the final oral interview
                  </p>
                </div>
              </div>

              <div style={{ padding: "24px 28px" }}>
                {certsLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "12px", padding: "20px 0" }}>
                    <div style={{
                      width: 24, height: 24,
                      border: "3px solid var(--border-muted)",
                      borderTopColor: "var(--brand)",
                      borderRadius: "50%",
                      animation: "spin 0.7s linear infinite",
                    }} />
                    <span style={{ color: "var(--text-muted)", fontSize: "13px", fontFamily: "JetBrains Mono" }}>
                      Retrieving credentials...
                    </span>
                  </div>
                ) : certs.length === 0 ? (
                  <div style={{ textAlign: "center", padding: "32px 0" }}>
                    <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
                      <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--text-subtle)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                        <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                      </svg>
                    </div>
                    <p style={{ fontWeight: "600", color: "var(--text-title)", fontSize: "14px", marginBottom: "6px" }}>
                      No certificates earned yet
                    </p>
                    <p style={{ color: "var(--text-muted)", fontSize: "13px", marginBottom: "20px", lineHeight: 1.6 }}>
                      Pass all modules and complete the final oral interview to earn your certificate.
                    </p>
                    <a href="/courses" className="btn btn-primary btn-sm">Browse Courses</a>
                  </div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
                    {/* Certificate list */}
                    {certs.length > 1 && (
                      <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        <p style={{ fontSize: "11px", fontWeight: "700", color: "var(--text-muted)", fontFamily: "JetBrains Mono", textTransform: "uppercase", marginBottom: "4px" }}>
                          Earned ({certs.length})
                        </p>
                        {certs.map((c) => {
                          const isSelected = selectedCert?.id === c.id;
                          return (
                            <div
                              key={c.id}
                              onClick={() => setSelectedCert(c)}
                              style={{
                                padding: "12px 16px",
                                backgroundColor: isSelected ? "var(--brand-muted)" : "var(--bg-canvas)",
                                border: `1px solid ${isSelected ? "var(--brand-border)" : "var(--border-muted)"}`,
                                borderRadius: "8px",
                                cursor: "pointer",
                                transition: "all 0.15s ease",
                              }}
                              onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--brand)"; }}
                              onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.borderColor = "var(--border-muted)"; }}
                            >
                              <h4 style={{ fontSize: "13px", fontWeight: "600", color: "var(--text-title)", margin: "0 0 2px" }}>
                                {c.course_title || "Course"}
                              </h4>
                              <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, fontFamily: "JetBrains Mono" }}>
                                {new Date(c.issue_date).toLocaleDateString()}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Certificate preview */}
                    {selectedCert && (
                      <div id="printable-certificate" className="certificate" style={{
                        width: "100%", backgroundColor: "var(--bg-surface)",
                        padding: "36px 32px",
                        border: "6px double var(--brand-border)",
                        borderRadius: "4px",
                        boxShadow: "var(--shadow-sm)",
                        textAlign: "center",
                      }}>
                        <div style={{ display: "flex", justifyContent: "center", marginBottom: "12px" }}>
                          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                            <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                          </svg>
                        </div>
                        <h3 style={{ fontSize: "20px", fontWeight: "800", color: "var(--text-title)", letterSpacing: "0.05em", marginBottom: "6px" }}>
                          CERTIFICATE OF COMPLETION
                        </h3>
                        <div style={{ fontSize: "9px", fontWeight: "700", color: "var(--brand)", letterSpacing: "0.15em", marginBottom: "20px" }}>
                          MAVERIK LEARNING ENGINE — VERIFIED CREDENTIAL
                        </div>
                        <div style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-title)", fontFamily: "Outfit, sans-serif", margin: "16px 0" }}>
                          {displayName}
                        </div>
                        <div style={{ fontSize: "13px", color: "var(--text-muted)", lineHeight: "1.6", marginBottom: "24px" }}>
                          has successfully passed all module evaluations and the AI oral interview for:
                          <br />
                          <strong style={{ color: "var(--text-title)", fontSize: "15px", display: "inline-block", marginTop: "6px" }}>
                            {selectedCert.course_title}
                          </strong>
                        </div>
                        <div style={{
                          display: "flex", justifyContent: "center", gap: "40px",
                          borderTop: "1px solid var(--border-muted)", paddingTop: "16px",
                          color: "var(--text-muted)", fontSize: "10px",
                          fontFamily: "JetBrains Mono", fontWeight: "600",
                        }}>
                          <div>
                            <span style={{ display: "block", color: "var(--text-subtle)", marginBottom: "3px" }}>DATE OF ISSUANCE</span>
                            {new Date(selectedCert.issue_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                          </div>
                          <div>
                            <span style={{ display: "block", color: "var(--text-subtle)", marginBottom: "3px" }}>VERIFICATION CODE</span>
                            {selectedCert.verify_code}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Actions */}
                    {selectedCert && (
                      <div className="no-print" style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
                        <button onClick={handlePrint} className="btn btn-primary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="6 9 6 2 18 2 18 9" />
                            <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                            <rect x="6" y="14" width="12" height="8" />
                          </svg>
                          Print / Download PDF
                        </button>
                        {selectedCert.pdf_url && (
                          <a href={selectedCert.pdf_url} target="_blank" rel="noopener noreferrer" className="btn btn-secondary btn-sm" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                              <polyline points="7 10 12 15 17 10" />
                              <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            Download from Cloud
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Print styles */}
      <style jsx global>{`
        @media print {
          @page {
            size: A4 landscape;
            margin: 0;
          }
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            width: 297mm !important;
            height: 210mm !important;
            background: #ffffff !important;
            color: #000000 !important;
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }
          .no-print, .navbar, header, footer, button, .btn, nav {
            display: none !important;
          }
          #printable-certificate {
            display: flex !important;
            flex-direction: column !important;
            justify-content: center !important;
            align-items: center !important;
            position: fixed !important;
            top: 0 !important;
            left: 0 !important;
            width: 297mm !important;
            height: 210mm !important;
            box-sizing: border-box !important;
            margin: 0 !important;
            padding: 35mm 20mm !important;
            border: 12px double var(--brand, #4f46e5) !important;
            background: #ffffff !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            z-index: 9999999 !important;
          }
          #printable-certificate * {
            color: #1e293b !important;
          }
          #printable-certificate h2, 
          #printable-certificate h3,
          #printable-certificate .cert-name,
          #printable-certificate strong {
            color: #0f172a !important;
          }
          #printable-certificate .cert-subtitle {
            color: #4f46e5 !important;
          }
          #printable-certificate span {
            color: #64748b !important;
          }
        }
        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
    </>
  );
}

export default withAuth(ProfilePage);
