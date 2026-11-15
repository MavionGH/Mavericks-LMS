"use client";
import Navbar from "@/components/Navbar";
import Link from "next/link";
import { useAuth } from "@/context/AuthContext";
import { withAuth } from "@/components/withAuth";
import { useEffect, useState } from "react";

function CertificatesPage() {
  const { user, authFetch } = useAuth();
  const [certs, setCerts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedCert, setSelectedCert] = useState(null);

  useEffect(() => {
    async function loadCertificates() {
      try {
        const res = await authFetch("/api/student/certificates");
        if (res.ok) {
          const data = await res.json();
          setCerts(data);
          if (data.length > 0) {
            setSelectedCert(data[0]);
          }
        }
      } catch (err) {
        console.error("Failed to load certificates", err);
      } finally {
        setLoading(false);
      }
    }
    loadCertificates();
  }, [authFetch]);

  const handlePrint = () => {
    window.print();
  };

  const displayName = user?.certificate_name || user?.name || "Student Name";

  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)", minHeight: "calc(100vh - 64px)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          
          <div className="section-header no-print" style={{ textAlign: "center", marginBottom: "40px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>VERIFIED CREDENTIALS</span>
            <h2>Issued Certificates</h2>
            <p>Cryptographically verifiable documents certifying module and oral track completions.</p>
          </div>

          {loading ? (
            <div className="no-print" style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", minHeight: "200px", gap: "12px" }}>
              <div style={{
                width: 32,
                height: 32,
                border: "3px solid var(--border-muted)",
                borderTopColor: "var(--brand)",
                borderRadius: "50%",
                animation: "spin 0.7s linear infinite"
              }} />
              <p style={{ color: "var(--text-muted)", fontSize: "14px", fontFamily: "JetBrains Mono" }}>Retrieving credentials...</p>
            </div>
          ) : certs.length === 0 ? (
            <div className="card no-print" style={{ padding: "48px 32px", textAlign: "center", maxWidth: 640, margin: "0 auto 40px", backgroundColor: "var(--bg-surface)" }}>
              <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "16px" }}>
                <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                  <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                </svg>
              </div>
              <h3 style={{ fontSize: "18px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>No credentials earned yet</h3>
              <p style={{ color: "var(--text-muted)", marginBottom: "24px", fontSize: "14px" }}>
                Complete curriculum tracks and successfully clear AI oral assessment check-points to issue certificates.
              </p>
              <Link href="/courses" className="btn btn-primary">Browse Catalog</Link>
            </div>
          ) : (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 2.5fr", gap: "32px", alignItems: "start", marginBottom: "48px" }}>
              {/* Left pane: Certificates list */}
              <div className="no-print" style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                <h3 style={{ fontSize: "12px", fontWeight: "700", color: "var(--text-title)", textTransform: "uppercase", letterSpacing: "0.08em", fontFamily: "JetBrains Mono", marginBottom: "4px" }}>
                  Earned ({certs.length})
                </h3>
                {certs.map((c) => {
                  const isSelected = selectedCert?.id === c.id;
                  return (
                    <div 
                      key={c.id}
                      onClick={() => setSelectedCert(c)}
                      style={{
                        padding: "16px",
                        backgroundColor: isSelected ? "var(--brand-muted)" : "var(--bg-surface)",
                        border: `1px solid ${isSelected ? "var(--brand-border)" : "var(--border-muted)"}`,
                        borderRadius: "8px",
                        cursor: "pointer",
                        transition: "all 0.2s ease-in-out",
                      }}
                      onMouseEnter={(e) => {
                        if (!isSelected) {
                           e.currentTarget.style.borderColor = "var(--brand)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!isSelected) {
                           e.currentTarget.style.borderColor = "var(--border-muted)";
                        }
                      }}
                    >
                      <h4 style={{ fontSize: "14px", fontWeight: "600", color: "var(--text-title)", margin: "0 0 4px 0" }}>
                        {c.course_title || "Course"}
                      </h4>
                      <p style={{ fontSize: "11px", color: "var(--text-muted)", margin: 0, fontFamily: "JetBrains Mono" }}>
                        {new Date(c.issue_date).toLocaleDateString()}
                      </p>
                    </div>
                  );
                })}
              </div>

              {/* Right pane: Certificate preview */}
              <div style={{ display: "flex", flexDirection: "column", gap: "24px", alignItems: "center" }}>
                {/* Certificate design */}
                <div id="printable-certificate" className="certificate" style={{ 
                  width: "100%", 
                  maxWidth: "760px", 
                  backgroundColor: "var(--bg-surface)",
                  padding: "48px",
                  border: "8px double var(--brand-border)",
                  borderRadius: "4px",
                  boxShadow: "0 4px 20px rgba(0,0,0,0.05)",
                  textAlign: "center",
                  position: "relative"
                }}>
                  <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "16px" }}>
                    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                      <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
                    </svg>
                  </div>
                  <h2 style={{ fontSize: "24px", fontWeight: "800", color: "var(--text-title)", letterSpacing: "0.05em", marginBottom: "8px" }}>CERTIFICATE OF COMPLETION</h2>
                  <div className="cert-subtitle" style={{ fontSize: "10px", fontWeight: "700", color: "var(--brand)", letterSpacing: "0.15em", marginBottom: "32px" }}>
                    MAVERIK LEARNING ENGINE DECENTRALIZED RECORD
                  </div>
                  <div className="cert-name" style={{ fontSize: "28px", fontWeight: "800", color: "var(--text-title)", fontFamily: "Outfit, sans-serif", margin: "24px 0" }}>
                    {displayName}
                  </div>
                  <div className="cert-course" style={{ fontSize: "14px", color: "var(--text-muted)", lineHeight: "1.6", marginBottom: "40px" }}>
                    has successfully passed all conceptual evaluations and AI oral assessments for:<br />
                    <strong style={{ color: "var(--text-title)", fontSize: "18px", display: "inline-block", marginTop: "8px" }}>
                      {selectedCert?.course_title}
                    </strong>
                  </div>
                  
                  <div style={{ display: "flex", justifyContent: "center", gap: "48px", borderTop: "1px solid var(--border-muted)", paddingTop: "24px", color: "var(--text-muted)", fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: "600" }}>
                    <div>
                      <span style={{ display: "block", color: "var(--text-subtle)", marginBottom: "4px" }}>DATE OF ISSUANCE</span>
                      {selectedCert && new Date(selectedCert.issue_date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
                    </div>
                    <div>
                      <span style={{ display: "block", color: "var(--text-subtle)", marginBottom: "4px" }}>VERIFICATION HASH</span>
                      {selectedCert?.verify_code}
                    </div>
                  </div>
                </div>

                <div className="no-print">
                  <button onClick={handlePrint} className="btn btn-primary" style={{ display: "inline-flex", alignItems: "center", gap: "8px" }}>
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <polyline points="6 9 6 2 18 2 18 9" />
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                      <rect x="6" y="14" width="12" height="8" />
                    </svg>
                    Print / Download PDF
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Catalog CTA */}
          <div className="card no-print" style={{ padding: "32px", textAlign: "center", maxWidth: 640, margin: "0 auto", backgroundColor: "var(--bg-surface)" }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "12px" }}>
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
              </svg>
            </div>
            <h3 style={{ fontSize: "16px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>Unlock new credentials</h3>
            <p style={{ color: "var(--text-muted)", marginBottom: "20px", fontSize: "13.5px" }}>
              Complete the curriculum tracks and successfully clear all AI oral interview checkpoints.
            </p>
            <Link href="/courses" className="btn btn-secondary btn-sm">Explore catalog</Link>
          </div>
        </div>
      </div>

      {/* CSS for print media layout */}
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
      `}</style>
    </>
  );
}

export default withAuth(CertificatesPage, ["student"]);
