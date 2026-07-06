"use client";

/**
 * Credit Control report (Guy's mock-up, 6 Jul 2026).
 *
 * Case-level detail grouped by the month the clawback lands, split
 * into forecast months (current onwards + unscheduled) and completed
 * months. Each month is a table ordered by seller then highest CB,
 * with a money footer, matching the PDF Guy sent.
 *
 * Stale rule: an OPEN case with no human action (note / contact / £ /
 * status change) inside the threshold gets a red NOT WORKED tag. The
 * threshold is adjustable at the top (default 3 days) and the same
 * rule drives the weekday digest email to Guy + Poz.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PrintButton, PrintHeader } from "@/components/print";

interface CaseRow {
  id: number;
  policy_number: string;
  provider: string;
  client_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  postcode: string | null;
  policy_type: string | null;
  seller: string;
  trigger: string | null;
  net_premium: number | null;
  clawback: number;
  status: string;
  lost_reason: string | null;
  redraw_off: number;
  redraw_on: number;
  saved_amount: number;
  resold_amount: number;
  latest_note: string | null;
  last_action_at: string | null;
  stale: boolean;
  clawback_date: string | null;
}
interface MonthTotals {
  exposure: number; outstanding: number; reinstated: number; resold: number;
  saved: number; redrawNet: number; lost: number; staleCount: number; cases: number;
}
interface MonthBlock { key: string; label: string; cases: CaseRow[]; totals: MonthTotals }
interface ReportResp {
  generatedAt: string;
  staleDays: number;
  scoped: boolean;
  forecast: MonthBlock[];
  completed: MonthBlock[];
}

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  saved: "Saved",
  resold: "Resold",
  dead: "Lost",
  reinstated: "Reinstated",
  redraw: "Redraw",
  closed: "Closed",
};
const STATUS_CLS: Record<string, string> = {
  open:       "bg-slate-100 text-slate-700",
  saved:      "bg-emerald-100 text-emerald-800",
  resold:     "bg-blue-100 text-blue-800",
  dead:       "bg-red-100 text-red-800",
  reinstated: "bg-amber-100 text-amber-800",
  redraw:     "bg-purple-100 text-purple-800",
  closed:     "bg-slate-200 text-slate-600",
};
const LOST_REASON_LABELS: Record<string, string> = {
  dead_client:    "Dead client / can't resell",
  dead_contact:   "Dead contact",
  pitched_missed: "Lost - pitched and missed",
  other:          "Other",
};

function gbp(n: number): string {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 });
}
function gbp2(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
}
function surnameFirst(c: CaseRow): string {
  if (c.client_last_name) {
    return `${c.client_last_name}, ${c.client_first_name ?? ""}`.replace(/, $/, "");
  }
  return c.client_name;
}
function daysAgo(iso: string | null): string {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  return `${d}d ago`;
}

export default function CreditReportPage() {
  const [data, setData] = useState<ReportResp | null>(null);
  const [staleDays, setStaleDays] = useState(3);
  const [showCompleted, setShowCompleted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/reci/clawback/credit-report?stale_days=${staleDays}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [staleDays]);

  useEffect(() => { void load(); }, [load]);

  const totalStale = data
    ? [...data.forecast, ...data.completed].reduce((n, m) => n + m.totals.staleCount, 0)
    : 0;

  return (
    <main className="mx-auto max-w-[1700px] px-4 py-4">
      <PrintHeader
        title="Credit Control - Clawback Forecast & Recovery"
        subtitle={`Case detail by clawback month · stale threshold ${data?.staleDays ?? staleDays} days`}
        meta={[
          { label: "Generated", value: new Date().toLocaleString("en-GB", { timeZone: "Europe/London" }) },
          { label: "Not worked", value: String(totalStale) },
        ]}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Credit Control</h1>
          <div className="text-sm text-slate-600">
            Clawback forecast and recovery, case by case, grouped by the month the clawback lands.
          </div>
        </div>
        <div className="no-print flex items-center gap-2">
          <Link href="/reci/clawback" className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Dashboard
          </Link>
          <Link href="/reci/clawback/reports" className="rounded border border-slate-300 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">
            Reports
          </Link>
          <PrintButton />
        </div>
      </div>

      <section className="no-print mt-4 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-2 text-sm">
        <label className="flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Flag as not worked after</span>
          <select
            value={staleDays}
            onChange={(e) => setStaleDays(Number(e.target.value))}
            className="rounded border border-slate-300 px-2 py-1"
          >
            {[1,2,3,4,5,7,10,14].map((d) => <option key={d} value={d}>{d} day{d === 1 ? "" : "s"}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          <span>Show completed months</span>
        </label>
        {totalStale > 0 && (
          <span className="ml-auto rounded bg-red-100 px-2 py-1 text-xs font-semibold text-red-800">
            {totalStale} case{totalStale === 1 ? "" : "s"} not worked
          </span>
        )}
      </section>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Failed to load: {error}
        </div>
      )}
      {loading && !data && <div className="mt-6 text-sm text-slate-400">Loading…</div>}

      {data && (
        <>
          {data.forecast.map((m) => <MonthSection key={m.key} block={m} kind="forecast" />)}

          {showCompleted && data.completed.length > 0 && (
            <>
              <h2 className="mt-8 border-t border-slate-300 pt-4 text-sm font-semibold uppercase tracking-wide text-slate-500">
                Completed months - worked case detail behind the summary totals
              </h2>
              {data.completed.map((m) => <MonthSection key={m.key} block={m} kind="completed" />)}
            </>
          )}
        </>
      )}
    </main>
  );
}

function MonthSection({ block, kind }: { block: MonthBlock; kind: "forecast" | "completed" }) {
  const t = block.totals;
  return (
    <section className="mt-6 break-inside-avoid">
      <div className="flex items-baseline justify-between">
        <h2 className="text-base font-semibold">
          {block.label}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {kind === "forecast" ? "clawback due this month" : "closed month"} · ordered by seller, highest clawback first
          </span>
        </h2>
        <div className="text-sm text-slate-600">
          {t.cases} case{t.cases === 1 ? "" : "s"} · exposure <strong>{gbp(t.exposure)}</strong>
          {t.staleCount > 0 && (
            <span className="ml-2 rounded bg-red-100 px-1.5 py-0.5 text-xs font-semibold text-red-800">
              {t.staleCount} not worked
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Client</th>
              <th className="px-3 py-2 text-left font-medium">Policy</th>
              <th className="px-3 py-2 text-left font-medium">Type</th>
              <th className="px-3 py-2 text-left font-medium">Seller</th>
              <th className="px-3 py-2 text-left font-medium">Trigger</th>
              <th className="px-3 py-2 text-right font-medium">Prem /mo</th>
              <th className="px-3 py-2 text-right font-medium">Clawback</th>
              <th className="px-3 py-2 text-left font-medium">Status</th>
              <th className="px-3 py-2 text-left font-medium">Last action</th>
              <th className="px-3 py-2 text-left font-medium">Reason / notes</th>
            </tr>
          </thead>
          <tbody>
            {block.cases.map((c) => (
              <tr key={c.id} className={`border-t border-slate-100 ${c.stale ? "bg-red-50" : ""}`}>
                <td className="px-3 py-1.5 font-medium">
                  <Link href={`/reci/clawback?q=${encodeURIComponent(c.policy_number)}`} className="hover:underline">
                    {surnameFirst(c)}
                  </Link>
                </td>
                <td className="px-3 py-1.5"><code className="text-xs">{c.policy_number}</code></td>
                <td className="max-w-[140px] truncate px-3 py-1.5" title={c.policy_type || ""}>{c.policy_type || "—"}</td>
                <td className="px-3 py-1.5">{c.seller}</td>
                <td className="max-w-[160px] truncate px-3 py-1.5" title={c.trigger || ""}>{c.trigger || "—"}</td>
                <td className="px-3 py-1.5 text-right">{gbp2(c.net_premium)}</td>
                <td className="px-3 py-1.5 text-right font-medium">{gbp2(c.clawback)}</td>
                <td className="px-3 py-1.5">
                  <span className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${STATUS_CLS[c.status] || ""}`}>
                    {STATUS_LABELS[c.status] || c.status}
                  </span>
                  {c.stale && (
                    <span className="ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                      Not worked
                    </span>
                  )}
                </td>
                <td className="whitespace-nowrap px-3 py-1.5 text-xs text-slate-500">{daysAgo(c.last_action_at)}</td>
                <td className="max-w-[280px] truncate px-3 py-1.5 text-xs text-slate-600" title={c.latest_note || ""}>
                  {c.status === "dead" && c.lost_reason
                    ? <strong className="mr-1">{LOST_REASON_LABELS[c.lost_reason] || c.lost_reason}.</strong>
                    : null}
                  {c.latest_note || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex flex-wrap gap-x-5 gap-y-1 border-t-2 border-slate-300 bg-slate-50 px-3 py-2 text-xs font-medium">
          <span>EXPOSURE <strong>{gbp(t.exposure)}</strong></span>
          <span className={t.outstanding > 0 ? "text-amber-700" : ""}>OUTSTANDING <strong>{gbp(t.outstanding)}</strong></span>
          <span className="text-amber-700">REINSTATED <strong>{gbp(t.reinstated)}</strong></span>
          <span className="text-blue-700">RESOLD <strong>{gbp(t.resold)}</strong></span>
          <span className="text-emerald-700">SAVED <strong>{gbp(t.saved)}</strong></span>
          <span className={t.redrawNet >= 0 ? "text-emerald-700" : "text-red-700"}>
            REDRAW NET <strong>{t.redrawNet >= 0 ? `+${gbp(t.redrawNet)}` : gbp(t.redrawNet)}</strong>
          </span>
          <span className="text-red-700">LOST <strong>{gbp(t.lost)}</strong></span>
        </div>
      </div>
    </section>
  );
}
