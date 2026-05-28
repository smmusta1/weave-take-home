import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PostHog Engineering Impact — Weave Take-Home",
  description:
    "Top 5 most impactful engineers on PostHog over the last 90 days, scored on output, leverage, and durability.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-neutral-50 text-neutral-900 antialiased">
        {children}
      </body>
    </html>
  );
}
