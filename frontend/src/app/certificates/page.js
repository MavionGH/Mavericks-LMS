import Navbar from "@/components/Navbar";
import Link from "next/link";

export default function CertificatesPage() {
  return (
    <>
      <Navbar />
      <div className="page-container" style={{ backgroundColor: "var(--bg-canvas)" }}>
        <div className="container" style={{ padding: "48px 32px" }}>
          <div className="section-header" style={{ textAlign: "center", marginBottom: "40px" }}>
            <span className="badge badge-accent" style={{ marginBottom: "8px" }}>VERIFIED CREDENTIALS</span>
            <h2>Issued Certificates</h2>
            <p>Cryptographically verifiable documents certifying module and oral track completions.</p>
          </div>

          {/* Certificate design */}
          <div className="certificate" style={{ maxWidth: 760, margin: "0 auto 32px auto", backgroundColor: "#ffffff" }}>
            <div style={{ display: 'flex', justifyContent: 'center', marginBottom: "16px" }}>
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="var(--brand)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M22 10v6M2 10l10-5 10 5-10 5z"/>
                <path d="M6 12v5c0 2 2 3 6 3s6-1 6-3v-5"/>
              </svg>
            </div>
            <h2>CERTIFICATE OF COMPLETION</h2>
            <div className="cert-subtitle">MAVERIK LEARNING ENGINE DECENTRALIZED RECORD</div>
            <div className="cert-name">STUDENT NAME</div>
            <div className="cert-course">
              has successfully passed all conceptual evaluations and AI oral assessments for:<br />
              <strong style={{ color: "var(--text-title)", fontSize: "18px", display: "inline-block", marginTop: "8px" }}>JavaScript Fundamentals</strong>
            </div>
            
            <div style={{ display: "flex", justifyContent: "center", gap: "48px", borderTop: "1px solid var(--border-muted)", paddingTop: "24px", color: "var(--text-muted)", fontSize: "11px", fontFamily: "JetBrains Mono", fontWeight: "600" }}>
              <div><span style={{ display: "block", color: "var(--text-muted)", marginBottom: "4px" }}>DATE OF ISSUANCE</span>June 19, 2026</div>
              <div><span style={{ display: "block", color: "var(--text-muted)", marginBottom: "4px" }}>COMPOSITE SCORE</span>82%</div>
              <div><span style={{ display: "block", color: "var(--text-muted)", marginBottom: "4px" }}>VERIFICATION HASH</span>MVK-2026-A1B2</div>
            </div>
          </div>

          <div style={{ textAlign: "center", marginBottom: "48px" }}>
            <button className="btn btn-primary">Download PDF Credential</button>
          </div>

          {/* Catalog CTA */}
          <div className="card" style={{ padding: "32px", textAlign: "center", maxWidth: 640, margin: "0 auto", backgroundColor: "#ffffff" }}>
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
    </>
  );
}
