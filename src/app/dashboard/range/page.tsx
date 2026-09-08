"use client";

/**
 * Call Centre range report (Poz, 8 Sep 2026): the digital version of
 * Hayder's Monday handout. Pick a seller (or the team) and a week
 * range, get his exact columns per week with totals and averages, and
 * print for the Monday discussion.
 */
import { useCallback, useEffect, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";
import { ADVISERS } from "@/lib/schema";

interface WeekRow {
  week: number;
  callMins: number; ff: number; quotes: number; closes: number; deals: number;
  quFfPct: number | null; clQuPct: number | null; dClPct: number | null; dFfPct: number | null;
  minsPerDeal: number | null;
}
interface Resp {
  year: number; from: number; to: number; adviser: string;
  rows: WeekRow[];
  total: WeekRow & Record<string, number | null>;
  average: { callMins: number; ff: number; quotes: number; closes: number; deals: number };
  weeksCounted: number;
}

function fmtMins(mins: number): string {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtPct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default function CallCentreRangePage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [from, setFrom] = useState<number>(1);
  const [to, setTo] = useState<number>(53);
  const [adviser, setAdviser] = useState<string>("team");
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams({ year: String(year), from: String(from), to: String(to), adviser });
      const r = await fetch(`/api/snapshots/range?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [year, from, to, adviser]);
  useEffect(() => { void load(); }, [load]);

  const label = adviser === "team" ? "Whole team" : adviser;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <a href="/dashboard" className="text-sm text-slate-500 hover:text-slate-900">← Dashboard</a>
            <h1 className="text-lg font-semibold">Call Centre: week range</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Year</span>
              <input type="number" value={year}
                onChange={(e) => setYear(Number(e.target.value) || now.getFullYear())}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Weeks</span>
              <input type="number" min={1} max={53} value={from}
                onChange={(e) => setFrom(Math.max(1, Math.min(53, Number(e.target.value) || 1)))}
                className="w-14 rounded border border-slate-300 px-2 py-1 text-right" />
              <span className="text-slate-400">to</span>
              <input type="number" min={1} max={53} value={to}
                onChange={(e) => setTo(Math.max(1, Math.min(53, Number(e.target.value) || 53)))}
                className="w-14 rounded border border-slate-300 px-2 py-1 text-right" />
            </label>
            <PrintButton />
          </div>
        </div>
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-2 px-4 pb-3 text-xs">
          <span className="font-medium uppercase tracking-wide text-slate-500">Seller</span>
          <Pill label="Whole team" active={adviser === "team"} onClick={() => setAdviser("team")} />
          {ADVISERS.map((a) => (
            <Pill key={a} label={a} active={adviser === a} onClick={() => setAdviser(a)} />
          ))}
          {loading && <span className="text-slate-400">Loading…</span>}
          {err && <span className="text-red-600">{err}</span>}
        </div>
      </header>

      <main className="mx-auto max-w-[1200px] px-4 py-4">
        <PrintHeader
          title="Call Centre performance"
          subtitle={`${label} · Weeks ${data?.from ?? from}-${data?.to ?? to} · ${year}`}
          meta={data ? [
            { label: "Seller", value: label },
            { label: "Weeks", value: `${data.from} to ${data.to} (${data.weeksCounted} with data)` },
          ] : []}
        />

        {!data ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">Loading…</div>
        ) : data.rows.length === 0 ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">No data in that range.</div>
        ) : (
          <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Week</th>
                    <th className="px-3 py-2 text-right">Call time</th>
                    <th className="px-3 py-2 text-right">Fact Finds</th>
                    <th className="px-3 py-2 text-right">Quotes</th>
                    <th className="px-3 py-2 text-right">Qu/FF %</th>
                    <th className="px-3 py-2 text-right">Closes</th>
                    <th className="px-3 py-2 text-right">Cl/Qu %</th>
                    <th className="px-3 py-2 text-right">Deals</th>
                    <th className="px-3 py-2 text-right">D/Cl %</th>
                    <th className="px-3 py-2 text-right">D/FF %</th>
                    <th className="px-3 py-2 text-right">Mins p/Deal</th>
                  </tr>
                </thead>
                <tbody>
                  {data.rows.map((r) => (
                    <tr key={r.week} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium">Week {r.week}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{fmtMins(r.callMins)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.ff}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.quotes}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtPct(r.quFfPct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.closes}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtPct(r.clQuPct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums font-medium">{r.deals}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtPct(r.dClPct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums text-slate-500">{fmtPct(r.dFfPct)}</td>
                      <td className="px-3 py-1.5 text-right tabular-nums">{r.minsPerDeal ?? "—"}</td>
                    </tr>
                  ))}
                  <tr className="border-t-2 border-slate-300 bg-amber-50 font-semibold">
                    <td className="px-3 py-2">Total</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtMins(data.total.callMins)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.ff}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.quotes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(data.total.quFfPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.closes}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(data.total.clQuPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.deals}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(data.total.dClPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{fmtPct(data.total.dFfPct)}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{data.total.minsPerDeal ?? "—"}</td>
                  </tr>
                  <tr className="bg-slate-100 text-xs font-semibold text-slate-600">
                    <td className="px-3 py-1.5">AV p/Week</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{fmtMins(data.average.callMins)}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{data.average.ff}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{data.average.quotes}</td>
                    <td />
                    <td className="px-3 py-1.5 text-right tabular-nums">{data.average.closes}</td>
                    <td />
                    <td className="px-3 py-1.5 text-right tabular-nums">{data.average.deals}</td>
                    <td colSpan={3} />
                  </tr>
                </tbody>
              </table>
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 transition-colors ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}>
      {label}
    </button>
  );
}
