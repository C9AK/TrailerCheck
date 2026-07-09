import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "UGL Trailer Check — Dispatch & QC",
  description: "UGL Dispatch Trailer Check & Quality Control Platform",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-slate-50 font-sans text-slate-900 antialiased dark:bg-slate-950 dark:text-slate-100">
        {children}
      </body>
    </html>
  );
}
