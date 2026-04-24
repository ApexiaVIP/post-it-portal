"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import type { Adviser } from "@/lib/reci/schema";

export default function ReciLandingPage() {
  const [advisers, setAdvisers] = useState<Adviser[] | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/reci/advisers", { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const j = (await r.json()) as { advisers: Adviser[] };
        setAdvisers(j.advisers);
      } catch (e) {
        setErr(e instanceof Error ? e.message : "load failed");
      }
    })();
  }, []);

  return (
    <main className="max-w-5xl mx-auto p-4 md:p-8 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <h1 className="text-2xl font-semibold">RECI</h1>
        <nav className="flex gap-4 text-sm">
          <Link href="/" className="text-slate-500 hover:text-slate-700 underline">POST IT Admin</Link>
          <Link href="/dashboard" className="text-slate-500 hover:text-slate-700 underline">POST IT Dashboard</Link>
        </nav>
      </header>
      {err && <p className="text-red-600 text-sm">{err}</p>}
      {!advisers ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
          {advisers.map((a) => (
            <Link
              key={a.id}
              href={`/reci/${a.slug}`}
              className="bg-white shadow rounded-lg p-4 hover:shadow-md transition block"
            >
              <div className="text-xl font-semibold">{a.name}</div>
              <div className="text-sm text-slate-500 mt-1">View Kanban →</div>
            </Link>
          ))}
        </div>
      )}
    </main>
  );
}
