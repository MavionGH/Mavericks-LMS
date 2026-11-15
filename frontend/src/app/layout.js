import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { ThemeProvider } from "@/context/ThemeContext";

export const metadata = {
  title: "Maverik Learning — AI-Powered Education Platform",
  description:
    "Master skills through AI-driven interviews, adaptive quizzes, and interactive content. Validate your knowledge with voice-based assessments.",
};

// Runs before hydration to apply the saved theme immediately, avoiding a
// flash of the wrong theme. suppressHydrationWarning on <html> tells React
// to ignore the class this script adds ahead of the client render.
const THEME_INIT_SCRIPT = `
(function () {
  try {
    var stored = localStorage.getItem("theme");
    var dark = stored ? stored === "dark" : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.classList.toggle("dark", dark);
  } catch (e) {}
})();
`;

export default function RootLayout({ children }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider>{children}</AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
