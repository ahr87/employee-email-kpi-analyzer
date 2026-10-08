import type { Metadata } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";

export const metadata: Metadata = {
  title: "Employee Email KPI Analyzer",
  description: "Analyze pasted Outlook emails and produce monthly employee email KPI reports. Runs entirely in your browser.",
};

// Static hosting cannot send security headers, so the policy is delivered as a <meta> tag: only this site's own files
// may load or connect, no plugins, no framing of forms elsewhere. Pasted emails are shown as escaped text only.
const dev = process.env.NODE_ENV !== "production";
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self'${dev ? " ws: wss:" : ""}`,
  "worker-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta httpEquiv="Content-Security-Policy" content={csp} />
        <meta name="referrer" content="no-referrer" />
      </head>
      <body><Shell>{children}</Shell></body>
    </html>
  );
}
