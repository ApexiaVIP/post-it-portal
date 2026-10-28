"use client";

/**
 * A sales agent's view of their own RECI board (Poz, 15 Oct 2026): just
 * their sales in the Call recordings column (28 Oct 2026) and a "New deal"
 * button that takes the call recording(s), the call type and the client's
 * surname. The sale goes into Poz's listening pool and she fills in the
 * details, then moves it on to Not Yet Submitted.
 */
import { useState } from "react";
import Link from "next/link";
import { RecordingDrop } from "@/components/recording-drop";

export interface SellerDeal {
  id: number; client: string; week: number; year: number;
  booked_date: string | null; created_at: string; recordings: number;
}
export interface SellerBoardData {
  view: "seller";
  adviser: { name: string; slug: string };
  deals: SellerDeal[];
}

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

export function SellerBoard({ slug, data, onReload }: { slug: string; data: SellerBoardData; onReload: () => void }) {
  const [adding, setAdding] = useState<{ dealId?: number; client?: string } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  return (
    <main className="mx-auto max-w-3xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm text-slate-500"><Link href="/" className="hover:underline">Home</Link> / RECI</div>
          <h1 className="text-2xl font-semibold">{data.adviser.name}: new sales</h1>
          <p className="text-sm text-slate-600">Sales you&apos;ve added from a call recording. Poz adds the details.</p>
        </div>
        <button type="button" onClick={() => { setNotice(null); setAdding({}); }}
          className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
          + New deal
        </button>
      </header>

      {notice && <p className="rounded border border-emerald-300 bg-emerald-50 p-2 text-sm text-emerald-800">{notice}</p>}

      <section className="rounded-lg border border-slate-300 bg-slate-100">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <span className="text-sm font-medium">Call recordings</span>
          <span className="text-xs text-slate-600 tabular-nums">{data.deals.length}</span>
        </div>
        <div className="space-y-2 p-2">
          {data.deals.map((d) => (
            <div key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-slate-200 bg-white p-2 text-sm shadow-sm">
              <span className="font-medium">{d.client}</span>
              <span className="text-xs text-slate-500">Week {d.week}{d.booked_date ? ` · ${fmtDate(d.booked_date)}` : ""}</span>
              <span className={`text-xs ${d.recordings ? "text-teal-800" : "text-amber-700"}`}>
                {d.recordings ? `${d.recordings} recording${d.recordings === 1 ? "" : "s"}` : "No recording yet"}
              </span>
              <button type="button" onClick={() => { setNotice(null); setAdding({ dealId: d.id, client: d.client }); }}
                className="ml-auto rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-700 hover:bg-slate-50">
                Add recording
              </button>
            </div>
          ))}
          {data.deals.length === 0 && <p className="py-6 text-center text-xs text-slate-400">No sales waiting. Use New deal after a sale.</p>}
        </div>
      </section>

      {adding && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/30 p-4 md:items-center">
          <div className="w-full max-w-lg rounded-lg bg-white shadow-xl">
            <header className="flex items-center justify-between border-b px-4 py-3">
              <h2 className="font-semibold">{adding.dealId ? `Add a recording: ${adding.client}` : "New deal"}</h2>
              <button type="button" onClick={() => setAdding(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </header>
            <div className="p-4">
              <RecordingDrop slug={slug} dealId={adding.dealId}
                label={adding.dealId ? "Drag the recording here" : "Drag the sale's call recording(s) here"}
                onDone={() => {
                  setNotice(adding.dealId ? "Recording added." : "Sale created. Poz will add the details.");
                  setAdding(null);
                  onReload();
                }} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
