import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "POST IT Portal",
  description: "Manual data entry for POST IT daily report",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">{children}</body>
    </html>
  );
}
