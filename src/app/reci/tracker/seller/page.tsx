"use client";

/**
 * Seller Trends (Poz/Guy, 2 Sep 2026).
 *
 * One adviser's Business Tracker performance over time, drawn rather
 * than tabulated: pick a seller and see month-by-month or
 * quarter-by-quarter £ by status, deal counts, averages, cancel rate
 * and share of team, with the underlying table for the print.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, CartesianGrid, Tooltip as RTooltip, Legend,
} from "recharts";
import { PrintButton, PrintHeader } from "@/components/print";
import { STATUS_LABELS, type DealStatus } from "@/lib/reci/schema";

interface PeriodRow {
  key: string; label: string;
  paid: number; on_risk_nyp: number; in_processing: number;
  not_yet_submitted: number; cancelled: number;
  total: number; liveTotal: number; deals: number; weeks: number;
  avgPerWeek: number; avgPerDeal: number; cancelRate: number; teamShare: number;
}
interface Resp {
  year: number;
  adviser: { id: number; name: string };
  advisers: { id: number; name: string }[];
  months: PeriodRow[];
  quarters: PeriodRow[];
  ytd: PeriodRow;
}

const STATUS_COLORS: Record<string, string> = {
  not_yet_submitted: "#94a3b8",
  in_processing:     "#3b82f6",
  on_risk_nyp:       "#8b5cf6",
  paid:              "#10b981",
  cancelled:         "#ef4444",
};
const STACK_STATUSES = ["paid", "on_risk_nyp", "in_processing", "not_yet_submitted", "cancelled"] as const;

type Granularity = "months" | "quarters";
type Metric = "liveTotal" | "deals" | "avgPerDeal" | "avgPerWeek" | "cancelRate" | "teamShare";
const METRIC_LABELS: Record<Metric, string> = {
  liveTotal:  "Commission £ (excl cancelled)",
  deals:      "Deals",
  avgPerDeal: "Avg £ per deal",
  avgPerWeek: "Avg £ per week",
  cancelRate: "Cancelled %",
  teamShare:  "Share of team %",
};
const PCT_METRICS: Metric[] = ["cancelRate", "teamShare"];

function gbp(n: number): string {
  return Number(n || 0).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function pct(n: number): string { return `${(n * 100).toFixed(1)}%`; }

export default function SellerTrendsPage() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [adviser, setAdviser] = useState<number | null>(null);
  const [gran, setGran] = useState<Granularity>("months");
  const [metric, setMetric] = useState<Metric>("liveTotal");
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (adviser) p.set("adviser", String(adviser));
      const r = await fetch(`/api/reci/business-tracker/seller?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Resp;
      setData(j);
      // First load: default to the first active adviser.
      if (!adviser && j.advisers.length > 0) setAdviser(j.advisers[0].id);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [year, adviser]);
  useEffect(() => { void load(); }, [load]);

  const rows = useMemo(() => (data ? data[gran] : []), [data, gran]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <a href="/reci/tracker" className="text-sm text-slate-500 hover:text-slate-900">← Business Tracker</a>
            <h1 className="text-lg font-semibold">Seller Trends</h1>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Year</span>
              <input type="number" value={year}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
            </label>
            <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white text-xs">
              {(["months", "quarters"] as Granularity[]).map((g) => (
                <button key={g} type="button" onClick={() => setGran(g)}
                  className={`px-2 py-1 ${gran === g ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  {g === "months" ? "Monthly" : "Quarterly"}
                </button>
              ))}
            </div>
            <PrintButton />
          </div>
        </div>
        {data && (
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 pb-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-500">Seller</span>
            {data.advisers.map((a) => (
              <button key={a.id} type="button" onClick={() => setAdviser(a.id)}
                className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                  adviser === a.id ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                }`}>
                {a.name}
              </button>
            ))}
            {err && <span className="ml-2 text-red-600">{err}</span>}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        <PrintHeader
          title="Seller Trends"
          subtitle={data ? `${data.adviser.name} · ${data.year}` : ""}
          meta={data ? [
            { label: "Seller", value: data.adviser.name },
            { label: "Year", value: String(data.year) },
            { label: "YTD commission (excl cancelled)", value: gbp(data.ytd.liveTotal) },
            { label: "YTD deals", value: String(data.ytd.deals) },
          ] : []}
        />

        {!data ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            {/* YTD tiles */}
            <section className="grid grid-cols-2 gap-3 md:grid-cols-6">
              <Tile label="YTD commission" value={gbp(data.ytd.liveTotal)} accent="green" />
              <Tile label="YTD deals" value={String(data.ytd.deals)} />
              <Tile label="Avg £ / deal" value={gbp(data.ytd.avgPerDeal)} />
              <Tile label="Avg £ / week" value={gbp(data.ytd.avgPerWeek)} />
              <Tile label="Cancelled %" value={pct(data.ytd.cancelRate)} accent={data.ytd.cancelRate > 0.15 ? "red" : undefined} />
              <Tile label="Share of team" value={pct(data.ytd.teamShare)} accent="blue" />
            </section>

            {/* Stacked £ by status per period */}
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <h2 className="mb-2 text-sm font-semibold text-slate-700">
                {data.adviser.name}: commission by status, {gran === "months" ? "month by month" : "quarter by quarter"}
              </h2>
              {rows.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">No deals for {data.year}.</div>
              ) : (
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={rows} margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={(v: number) => gbp(v)} width={90} />
                    <RTooltip formatter={(value, name) => [gbp(Number(value)), STATUS_LABELS[name as DealStatus] ?? String(name)]} />
                    <Legend formatter={(name) => STATUS_LABELS[name as DealStatus] ?? String(name)} />
                    {STACK_STATUSES.map((s) => (
                      <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s]} />
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Metric trend line */}
            <section className="rounded-lg border bg-white p-4 shadow-sm">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold text-slate-700">Trend</h2>
                <div className="no-print inline-flex flex-wrap overflow-hidden rounded border border-slate-300 bg-white text-xs">
                  {(Object.keys(METRIC_LABELS) as Metric[]).map((m) => (
                    <button key={m} type="button" onClick={() => setMetric(m)}
                      className={`px-2 py-1 ${metric === m ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                      {METRIC_LABELS[m]}
                    </button>
                  ))}
                </div>
              </div>
              {rows.length === 0 ? (
                <div className="py-8 text-center text-sm text-slate-400">No deals for {data.year}.</div>
              ) : (
                <ResponsiveContainer width="100%" height={240}>
                  <LineChart data={rows} margin={{ top: 8, right: 16, bottom: 0, left: 8 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                    <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                    <YAxis
                      tick={{ fontSize: 11 }} width={90}
                      tickFormatter={(v: number) =>
                        PCT_METRICS.includes(metric) ? pct(v)
                        : metric === "deals" ? String(v)
                        : gbp(v)}
                    />
                    <RTooltip formatter={(value) => {
                      const v = Number(value);
                      return [PCT_METRICS.includes(metric) ? pct(v) : metric === "deals" ? String(v) : gbp(v), METRIC_LABELS[metric]];
                    }} />
                    <Line type="monotone" dataKey={metric} stroke="#0f172a" strokeWidth={2} dot={{ r: 3 }} />
                  </LineChart>
                </ResponsiveContainer>
              )}
            </section>

            {/* Underlying table (prints) */}
            <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left">{gran === "months" ? "Month" : "Quarter"}</th>
                      <th className="px-3 py-2 text-right">Deals</th>
                      <th className="px-3 py-2 text-right">Commission £</th>
                      <th className="px-3 py-2 text-right">Paid £</th>
                      <th className="px-3 py-2 text-right">On Risk £</th>
                      <th className="px-3 py-2 text-right">In Proc £</th>
                      <th className="px-3 py-2 text-right">NYS £</th>
                      <th className="px-3 py-2 text-right">Cancelled £</th>
                      <th className="px-3 py-2 text-right">Avg £/deal</th>
                      <th className="px-3 py-2 text-right">Avg £/week</th>
                      <th className="px-3 py-2 text-right">Cancel %</th>
                      <th className="px-3 py-2 text-right">Team share</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.key} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-medium">{r.label}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{r.deals}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums font-medium">{gbp(r.liveTotal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-emerald-700">{gbp(r.paid)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(r.on_risk_nyp)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(r.in_processing)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(r.not_yet_submitted)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums text-red-700">{r.cancelled > 0 ? gbp(r.cancelled) : "—"}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(r.avgPerDeal)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(r.avgPerWeek)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.cancelRate)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{pct(r.teamShare)}</td>
                      </tr>
                    ))}
                    <tr className="border-t-2 border-slate-300 bg-amber-50 font-semibold">
                      <td className="px-3 py-2">{data.ytd.label}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{data.ytd.deals}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.liveTotal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-emerald-700">{gbp(data.ytd.paid)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.on_risk_nyp)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.in_processing)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.not_yet_submitted)}</td>
                      <td className="px-3 py-2 text-right tabular-nums text-red-700">{gbp(data.ytd.cancelled)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.avgPerDeal)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(data.ytd.avgPerWeek)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(data.ytd.cancelRate)}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{pct(data.ytd.teamShare)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "green" | "blue" | "red" }) {
  const cls =
    accent === "green" ? "border-emerald-200 bg-emerald-50" :
    accent === "blue"  ? "border-blue-200 bg-blue-50" :
    accent === "red"   ? "border-red-200 bg-red-50" :
    "border-slate-200 bg-white";
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${cls}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-lg font-semibold tabular-nums">{value}</div>
    </div>
  );
}
