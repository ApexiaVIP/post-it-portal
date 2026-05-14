import type { Metadata } from "next";
import "./globals.css";
import AppNav from "@/components/app-nav";

export const metadata: Metadata = {
  title: "POST IT Portal",
  description: "Manual data entry for POST IT daily report",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-slate-50 text-slate-900 min-h-screen">
        <AppNav />
        {children}
      </body>
    </html>
  );
}
