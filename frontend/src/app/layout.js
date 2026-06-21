import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata = {
  title: "Maverik Learning — AI-Powered Education Platform",
  description:
    "Master skills through AI-driven interviews, adaptive quizzes, and interactive content. Validate your knowledge with voice-based assessments.",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
