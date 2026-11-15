import Navbar from "@/components/Navbar";
import Link from "next/link";
import FeaturedCourses from "@/components/FeaturedCourses";

const FEATURES = [
  { metric: "01", title: "Adaptive Voice Interviews", desc: "Interact with an AI agent that speaks, listens, and tailors technical questions dynamically." },
  { metric: "02", title: "Tri-Metric Validation", desc: "Get graded instantly on Technical Knowledge, Verbal Communication, and confidence cues." },
  { metric: "03", title: "Progression Gating", desc: "Skip multiple-choice guesses. You must pass the oral assessment to unlock subsequent modules." },
  { metric: "04", title: "Verifiable Credentials", desc: "Obtain clean, cryptographic certificates upon passing the comprehensive capstone." },
];

export default function HomePage() {
  return (
    <>
      <Navbar />
      <div className="page-container">
        {/* HERO */}
        <section className="hero">
          <div className="container">
            <div className="hero-content">
              <div className="hero-badge">Maverik Learning Engine v1.0</div>
              <h1>The Oral Assessment Platform<br />for <span>Technical Knowledge.</span></h1>
              <p>
                Verify true comprehension. Learn through curated modules, pass conceptual check-points, and prove your capabilities via real-time voice-to-voice AI interviews.
              </p>
              <div style={{ display: "flex", gap: "12px" }}>
                <Link href="/courses" className="btn btn-primary btn-lg">Explore Catalog</Link>
                <Link href="/register" className="btn btn-secondary btn-lg">Create account</Link>
              </div>
            
            </div>
            
            {/* Visual illustration for Coursera/Udemy style */}
            <div style={{ display: "flex", justifyContent: "center", alignItems: "center" }}>
              <svg width="320" height="320" viewBox="0 0 200 200" fill="none" xmlns="http://www.w3.org/2000/svg">
                <circle cx="100" cy="100" r="80" fill="var(--brand-muted)" />
                <path d="M100 50L150 75L100 100L50 75L100 50Z" fill="var(--brand)" />
                <path d="M70 95V125C70 135 100 145 100 145C100 145 130 135 130 125V95" stroke="var(--brand)" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" />
                <circle cx="100" cy="100" r="10" fill="#ffffff" />
                <path d="M100 95V105" stroke="var(--brand)" strokeWidth="2" />
                <path d="M95 100H105" stroke="var(--brand)" strokeWidth="2" />
              </svg>
            </div>
          </div>
        </section>

        {/* FEATURES */}
        <section className="section" style={{ borderTop: "1px solid var(--border-muted)", backgroundColor: "#ffffff" }}>
          <div className="container">
            <div className="section-header" style={{ textAlign: "center", marginBottom: "48px" }}>
              <h2>Built for Rigorous Learning Validation</h2>
              <p>Traditional tests check recall. Maverik evaluates conceptual application.</p>
            </div>
            <div className="grid-4">
              {FEATURES.map((f, i) => (
                <div className="card" key={i}>
                  <div className="mono" style={{ color: "var(--brand)", fontSize: "14px", fontWeight: "700", marginBottom: "16px" }}>{f.metric}</div>
                  <h3 style={{ fontSize: "15px", fontWeight: "700", color: "var(--text-title)", marginBottom: "8px" }}>{f.title}</h3>
                  <p style={{ color: "var(--text-muted)", fontSize: "13px", lineHeight: "1.5" }}>{f.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* FEATURED COURSES */}
        <section className="section" style={{ borderTop: "1px solid var(--border-muted)", backgroundColor: "var(--bg-canvas)" }}>
          <div className="container">
            <div className="section-header" style={{ marginBottom: "40px" }}>
              <h2>Featured Learning Tracks</h2>
              <p>Acquire, practice, and verify your skills in real-time.</p>
            </div>
            <FeaturedCourses />
          </div>
        </section>

        {/* FOOTER */}
        <footer style={{ borderTop: "1px solid var(--border-muted)", padding: "32px 0", backgroundColor: "#ffffff" }}>
          <div className="container flex-between">
            <span style={{ color: "var(--text-muted)", fontSize: "12px" }}>© 2026 Maverik Learning. All rights reserved.</span>
            <div style={{ display: "flex", gap: "16px" }}>
              <Link href="/courses" style={{ color: "var(--text-muted)", fontSize: "12px", textDecoration: "none" }}>Platform Catalog</Link>
              <Link href="/admin" style={{ color: "var(--text-muted)", fontSize: "12px", textDecoration: "none" }}>Operations Console</Link>
            </div>
          </div>
        </footer>
      </div>
    </>
  );
}
