import "./globals.css";
import "katex/dist/katex.min.css";

export const metadata = {
  title: "Adaptive Teaching Simulation",
  description: "A Next.js app for adaptive teaching simulation work."
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
