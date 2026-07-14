"use client";

/**
 * Credit Control report, v2 statuses (Guy's spec, 10 Jul 2026).
 *
 * Reproduces Guy's v2 HTML mock:
 *   - Colour key of all statuses top-right
 *   - Rows tinted by group (green = On/positive, red = Off/negative,
 *     white = not worked) with the exact status chip colours from the
 *     mock
 *   - Month footer: Total Off's above Total On's, each Off cell above
 *     its On counterpart, Outstanding, Net position = exposure minus
 *     On's (Guy-confirmed formula)
 *   - Completed-months summary table (Negatives group / Positives
 *     group / Net) + three YTD cards, positioned after the full
 *     at-risk section
 *   - Old Openwork subsections inside each month: every potential
 *     clawback visible, clearly separated, with a running cumulative
 *     exposure total UFN
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
  last_contact_at: string | null;
  stale: boolean;
  clawback_date: string | null;
  historic_ow: boolean;
}
interface MonthTotals {
  exposure: number;
  outstanding: number;
  byStatus: Record<string, number>;
  other: number;
  neg: number;
  pos: number;
  net: number;
  staleCount: number;
  cases: number;
}
interface MonthBlock {
  key: string; label: string;
  cases: CaseRow[]; totals: MonthTotals;
  oldOw: CaseRow[]; oldOwExposure: number; oldOwRunning: number;
}
interface ReportResp {
  generatedAt: string;
  staleDays: number;
  scoped: boolean;
  forecast: MonthBlock[];
  completed: MonthBlock[];
  oldOwGrandTotal: number;
}

/** Guy's v2 status colours, lifted from his HTML mock. */
const STATUS_VISUAL: Record<string, { label: string; bg: string; fg: string; bd?: string; group: "none" | "pos" | "neg" | "admin" }> = {
  open:            { label: "Not worked",                        bg: "#ffffff", fg: "#475569", bd: "#cbd5e1", group: "none" },
  saved_cfo:       { label: "Saved CFO",                         bg: "#dcfce7", fg: "#166534", group: "pos" },
  saved_lapse:     { label: "Saved Lapse",                       bg: "#ccfbf1", fg: "#0f766e", group: "pos" },
  resold_on:       { label: "Resold On",                         bg: "#166534", fg: "#ffffff", group: "pos" },
  redraw_on:       { label: "Redraw On",                         bg: "#d9f99d", fg: "#3f6212", group: "pos" },
  dd_reinstated:   { label: "DD Reinstated",                     bg: "#bbf7d0", fg: "#15803d", group: "pos" },
  bp_saved:        { label: "BP Saved",                          bg: "#f0fdf4", fg: "#16a34a", bd: "#86efac", group: "pos" },
  lost_cfo:        { label: "Lost CFO",                          bg: "#991b1b", fg: "#ffffff", group: "neg" },
  lost_lapse:      { label: "Lost Lapse",                        bg: "#fee2e2", fg: "#b91c1c", group: "neg" },
  resold_off:      { label: "Resold Off",                        bg: "#7f1d1d", fg: "#ffffff", group: "neg" },
  redraw_off:      { label: "Redraw Off",                        bg: "#fecdd3", fg: "#9f1239", group: "neg" },
  dd_cancelled:    { label: "DD Mandate Cancelled",              bg: "#fed7aa", fg: "#c2410c", group: "neg" },
  bp_off:          { label: "Bounced Premium Off",               bg: "#fef3c7", fg: "#a16207", group: "neg" },
  dead_client:     { label: "Dead Client - Claim Declined",      bg: "#334155", fg: "#ffffff", group: "neg" },
  post_completion: { label: "Post Completion - Medical Decline", bg: "#ede9fe", fg: "#6d28d9", group: "neg" },
  closed:          { label: "Closed",                            bg: "#e2e8f0", fg: "#475569", group: "admin" },
};
const NEG_COLS = ["lost_cfo","lost_lapse","resold_off","redraw_off","dd_cancelled","bp_off","other"] as const;
const POS_COLS = ["saved_cfo","saved_lapse","resold_on","redraw_on","dd_reinstated","bp_saved"] as const;
const COL_SHORT: Record<string, string> = {
  lost_cfo: "Lost CFO", lost_lapse: "Lost Lapse", resold_off: "Resold Off",
  redraw_off: "Redraw Off", dd_cancelled: "DD Cancelled", bp_off: "BP Off", other: "Other",
  saved_cfo: "Saved CFO", saved_lapse: "Saved Lapse", resold_on: "Resold On",
  redraw_on: "Redraw On", dd_reinstated: "DD Reinstated", bp_saved: "BP Saved",
};
const KEY_ORDER = [
  "open","saved_cfo","saved_lapse","resold_on","redraw_on","dd_reinstated","bp_saved",
  "lost_cfo","lost_lapse","resold_off","redraw_off","dd_cancelled","bp_off",
  "dead_client","post_completion",
];

function rowTint(status: string): string {
  const g = STATUS_VISUAL[status]?.group ?? "none";
  return g === "pos" ? "#f0fdf4" : g === "neg" ? "#fef2f2" : "#ffffff";
}
function colValue(t: MonthTotals, col: string): number {
  if (col === "other") return t.other;
  return t.byStatus[col] ?? 0;
}
function gbp(n: number): string {
  return "£" + Math.round(n).toLocaleString("en-GB");
}
function gbp2(n: number | null): string {
  if (n === null) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
}
function surnameFirst(c: CaseRow): string {
  if (c.client_last_name) {
    const first = c.client_first_name ? ` ${c.client_first_name.charAt(0)}.` : "";
    return `${c.client_last_name},${first}`;
  }
  return c.client_name;
}
function daysSince(iso: string): number {
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function fmtStamp(iso: string): string {
  return new Date(iso).toLocaleString("en-GB", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * "Last contacted" cell per Guy's spec (14 Jul 2026). Shows when the
 * client was last dialled/texted/emailed (contact_attempt entries),
 * with the exact date + time, banded for OPEN cases only:
 *   1-4 days green, 5-8 amber, 8+ red, never = red.
 * Worked cases show the plain date with no chase flag: a Resold or
 * Lost case can't be "idle".
 */
function LastContacted({ c }: { c: CaseRow }) {
  const open = c.status === "open";
  if (!c.last_contact_at) {
    if (!open) return <span className="text-slate-400">—</span>;
    return (
      <span className="inline-block rounded bg-red-100 px-1.5 py-0.5 text-[11px] font-semibold text-red-800">
        never
      </span>
    );
  }
  const d = daysSince(c.last_contact_at);
  const label = d <= 0 ? "today" : `${d}d ago`;
  const stamp = fmtStamp(c.last_contact_at);
  if (!open) {
    return <span className="whitespace-nowrap text-xs text-slate-500" title={stamp}>{label}</span>;
  }
  const cls =
    d <= 4 ? "bg-emerald-100 text-emerald-800" :
    d <= 8 ? "bg-amber-100 text-amber-800" :
    "bg-red-100 text-red-800";
  return (
    <span
      className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}
      title={`Last contact: ${stamp}`}
    >
      {label}
    </span>
  );
}

function StatusChip({ status }: { status: string }) {
  const v = STATUS_VISUAL[status] ?? { label: status, bg: "#e2e8f0", fg: "#475569", group: "none" as const };
  return (
    <span
      className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold"
      style={{ background: v.bg, color: v.fg, border: v.bd ? `1px solid ${v.bd}` : "1px solid transparent" }}
    >
      {v.label}
    </span>
  );
}

export default function CreditReportPage() {
  const [data, setData] = useState<ReportResp | null>(null);
  const [showCompleted, setShowCompleted] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch(`/api/reci/clawback/credit-report`, { cache: "no-store" });
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalStale = data
    ? [...data.forecast, ...data.completed].reduce((n, m) => n + m.totals.staleCount, 0)
    : 0;

  // Year summary across completed months, v2 columns.
  const year = new Date().getFullYear();
  const completedThisYear = data
    ? data.completed.filter((m) => m.key.startsWith(String(year))).slice().reverse()
    : [];
  const ytd: Record<string, number> = { exposure: 0, net: 0 };
  for (const col of [...NEG_COLS, ...POS_COLS]) ytd[col] = 0;
  for (const m of completedThisYear) {
    ytd.exposure += m.totals.exposure;
    ytd.net += m.totals.net;
    for (const col of [...NEG_COLS, ...POS_COLS]) ytd[col] += colValue(m.totals, col);
  }
  const ytdNeg = NEG_COLS.reduce((n, c) => n + ytd[c], 0);
  const ytdPos = POS_COLS.reduce((n, c) => n + ytd[c], 0);

  return (
    <main className="mx-auto max-w-[1750px] px-4 py-4">
      <PrintHeader
        title="Credit Control - Clawback Forecast & Recovery Report"
        subtitle={`v2 statuses · Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`}
        meta={[{ label: "Not worked", value: String(totalStale) }]}
      />

      <div className="flex flex-wrap items-start justify-between gap-4 border-b-2 border-slate-900 pb-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest text-slate-500">
            Credit Control — Life &amp; Critical Illness
          </div>
          <h1 className="text-2xl font-bold">Clawback Forecast &amp; Recovery Report</h1>
          <div className="text-sm text-slate-600">
            Cases with missed payments, cancelled DD mandates or cancelled policies
            · Generated {new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}
          </div>
        </div>
        <div className="flex max-w-[560px] flex-wrap items-center gap-1.5 pt-1">
          {KEY_ORDER.map((k) => <StatusChip key={k} status={k} />)}
        </div>
      </div>

      <section className="no-print mt-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-2 text-sm">
        <div className="flex items-center gap-2">
          <Link href="/reci/clawback" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Dashboard</Link>
          <Link href="/reci/clawback/reports" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Reports</Link>
          <PrintButton />
        </div>
        <span className="text-xs text-slate-500">
          <span className="mr-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">Not worked</span>
          = open and never actioned ·
          <span className="mx-1 font-semibold">Last contacted</span>
          bands: <span className="font-semibold text-emerald-700">1-4d</span> · <span className="font-semibold text-amber-700">5-8d</span> · <span className="font-semibold text-red-700">8+d</span> (open cases only)
        </span>
        <label className="flex items-center gap-2">
          <input type="checkbox" checked={showCompleted} onChange={(e) => setShowCompleted(e.target.checked)} />
          <span>Show completed month detail</span>
        </label>
        {totalStale > 0 && (
          <span className="ml-auto rounded bg-red-600 px-2 py-1 text-xs font-bold uppercase text-white">
            {totalStale} not worked
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

          {/* Year summary after the full at-risk section (Poz 9 Jul). */}
          <section className="mt-8 break-inside-avoid">
            <h2 className="border-b-2 border-slate-900 pb-2 text-lg font-bold">
              Completed months — {year} summary
              <span className="ml-2 text-xs font-normal text-slate-500">computed live from the case detail below</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full text-xs">
                <thead>
                  <tr className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-600">
                    <th rowSpan={2} className="px-2 py-2 text-left font-semibold">Month</th>
                    <th rowSpan={2} className="px-2 py-2 text-right font-semibold">Exposure</th>
                    <th colSpan={NEG_COLS.length} className="border-b border-slate-200 bg-red-50 px-2 py-1 text-center font-bold text-red-700">Negatives (Off)</th>
                    <th colSpan={POS_COLS.length} className="border-b border-slate-200 bg-emerald-50 px-2 py-1 text-center font-bold text-emerald-700">Positives (On)</th>
                    <th rowSpan={2} className="px-2 py-2 text-right font-semibold">Net position</th>
                  </tr>
                  <tr className="bg-slate-50 text-[9px] uppercase tracking-wider text-slate-600">
                    {[...NEG_COLS, ...POS_COLS].map((c) => (
                      <th key={c} className="px-2 py-1 text-right font-medium">{COL_SHORT[c]}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {completedThisYear.length === 0 ? (
                    <tr><td colSpan={NEG_COLS.length + POS_COLS.length + 3} className="px-3 py-3 text-center text-slate-400">No completed months yet in {year}.</td></tr>
                  ) : completedThisYear.map((m) => (
                    <tr key={m.key} className="border-t border-slate-100 tabular-nums">
                      <td className="px-2 py-1.5 text-left font-medium">{m.label}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{gbp(m.totals.exposure)}</td>
                      {NEG_COLS.map((c) => {
                        const v = colValue(m.totals, c);
                        return <td key={c} className="px-2 py-1.5 text-right text-red-700">{v ? gbp(v) : "—"}</td>;
                      })}
                      {POS_COLS.map((c) => {
                        const v = colValue(m.totals, c);
                        return <td key={c} className="px-2 py-1.5 text-right text-emerald-700">{v ? gbp(v) : "—"}</td>;
                      })}
                      <td className={`px-2 py-1.5 text-right font-bold ${m.totals.net > 0 ? "text-red-700" : "text-emerald-700"}`}>{gbp(m.totals.net)}</td>
                    </tr>
                  ))}
                  {completedThisYear.length > 0 && (
                    <tr className="border-t-2 border-slate-900 bg-slate-50 font-bold tabular-nums">
                      <td className="px-2 py-2 text-left">{year} YTD</td>
                      <td className="px-2 py-2 text-right">{gbp(ytd.exposure)}</td>
                      {NEG_COLS.map((c) => <td key={c} className="px-2 py-2 text-right text-red-700">{gbp(ytd[c])}</td>)}
                      {POS_COLS.map((c) => <td key={c} className="px-2 py-2 text-right text-emerald-700">{gbp(ytd[c])}</td>)}
                      <td className={`px-2 py-2 text-right ${ytd.net > 0 ? "text-red-700" : "text-emerald-700"}`}>{gbp(ytd.net)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded-lg p-4 text-white" style={{ background: "#7f1d1d" }}>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-85">Negatives — {year} YTD</div>
                <div className="mt-1 text-3xl font-extrabold tabular-nums">{gbp(ytdNeg)}</div>
                <div className="mt-1 text-xs opacity-80">Lost CFO · Lost Lapse · Resold/Redraw Off · DD Cancelled · BP Off · Other</div>
              </div>
              <div className="rounded-lg p-4 text-white" style={{ background: "#14532d" }}>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-85">Positives — {year} YTD</div>
                <div className="mt-1 text-3xl font-extrabold tabular-nums">{gbp(ytdPos)}</div>
                <div className="mt-1 text-xs opacity-80">Saved CFO · Saved Lapse · Resold/Redraw On · DD Reinstated · BP Saved</div>
              </div>
              <div className="rounded-lg p-4 text-white" style={{ background: "#0f172a" }}>
                <div className="text-[10px] font-bold uppercase tracking-widest opacity-85">Net position — {year} YTD</div>
                <div className="mt-1 text-3xl font-extrabold tabular-nums">{gbp(ytd.net)}</div>
                <div className="mt-1 text-xs opacity-80">Exposure minus positives (closed months)</div>
              </div>
            </div>

            <div className="mt-3 rounded border border-slate-300 bg-slate-100 px-4 py-3 text-sm text-slate-700">
              <strong>Old Openwork exposure, running total UFN:</strong>{" "}
              <span className="font-bold tabular-nums">{gbp(data.oldOwGrandTotal)}</span>
              <span className="ml-2 text-slate-500">
                Unrecovered Old OW clawback across all months. Individual cases are listed inside each month below; promote one with "Mark as actualised CB" if it hits the OW bank statement.
              </span>
            </div>
          </section>

          {showCompleted && data.completed.length > 0 && (
            <>
              <h2 className="mt-10 border-b-2 border-slate-900 pb-2 text-lg font-bold">
                Completed months — worked case detail
                <span className="ml-2 text-xs font-normal text-slate-500">the evidence behind the summary totals · cancelled cases can still be called and resold</span>
              </h2>
              {data.completed.map((m) => <MonthSection key={m.key} block={m} kind="completed" />)}
            </>
          )}
        </>
      )}
    </main>
  );
}

function FootCell({ label, value, bg, fg, border, dim }: {
  label: string; value: string; bg: string; fg: string; border?: string; dim?: boolean;
}) {
  return (
    <div
      className={`min-w-0 rounded px-2 py-1 ${dim ? "opacity-40" : ""}`}
      style={{ background: bg, color: fg, border: border ? `1px solid ${border}` : undefined }}
    >
      <span className="block text-[8.5px] font-bold uppercase tracking-wider opacity-75">{label}</span>
      <span className="text-[12.5px] font-bold tabular-nums">{value}</span>
    </div>
  );
}

function CaseTable({ rows, oldOw }: { rows: CaseRow[]; oldOw?: boolean }) {
  return (
    <table className="w-full table-fixed text-sm">
      <thead className={`text-xs uppercase tracking-wide text-slate-600 ${oldOw ? "bg-amber-50" : "bg-slate-100"}`}>
        <tr>
          <th className="w-[13%] px-3 py-2 text-left font-medium">Client</th>
          <th className="w-[9%] px-3 py-2 text-left font-medium">Policy</th>
          <th className="w-[8%] px-3 py-2 text-left font-medium">Type</th>
          <th className="w-[8%] px-3 py-2 text-left font-medium">Seller</th>
          <th className="w-[12%] px-3 py-2 text-left font-medium">Trigger</th>
          <th className="w-[7%] px-3 py-2 text-right font-medium">Prem /mo</th>
          <th className="w-[8%] px-3 py-2 text-right font-medium">Clawback</th>
          <th className="w-[14%] px-3 py-2 text-left font-medium">Status</th>
          <th className="w-[8%] px-3 py-2 text-left font-medium">Last contacted</th>
          <th className="w-[13%] px-3 py-2 text-left font-medium">Reason / notes</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => (
          <tr key={c.id} className="border-t border-slate-200" style={{ background: rowTint(c.status) }}>
            <td className="truncate px-3 py-2 font-medium" title={c.client_name}>
              <Link href={`/reci/clawback?q=${encodeURIComponent(c.policy_number)}`} className="hover:underline">
                {surnameFirst(c)}
              </Link>
            </td>
            <td className="truncate px-3 py-2 font-mono text-xs" title={c.policy_number}>{c.policy_number}</td>
            <td className="truncate px-3 py-2" title={c.policy_type || ""}>{c.policy_type || "—"}</td>
            <td className="truncate px-3 py-2" title={c.seller}>{c.seller}</td>
            <td className="truncate px-3 py-2 text-slate-600" title={c.trigger || ""}>{c.trigger || "—"}</td>
            <td className="px-3 py-2 text-right tabular-nums">{gbp2(c.net_premium)}</td>
            <td className="px-3 py-2 text-right font-semibold tabular-nums">{gbp2(c.clawback)}</td>
            <td className="px-3 py-2">
              <StatusChip status={c.status} />
              {c.stale && (
                <span className="ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                  Not worked
                </span>
              )}
            </td>
            <td className="px-3 py-2"><LastContacted c={c} /></td>
            <td className="truncate px-3 py-2 text-xs text-slate-600" title={c.latest_note || ""}>
              {c.latest_note || "—"}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MonthSection({ block, kind }: { block: MonthBlock; kind: "forecast" | "completed" }) {
  const t = block.totals;
  return (
    <section className="mt-6 break-inside-avoid">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">
          {block.label}
          <span className="ml-2 text-xs font-normal text-slate-500">
            {kind === "forecast" ? "clawback due this month" : "closed month"} · ordered by seller, highest clawback first
          </span>
        </h2>
        <div className="font-mono text-sm text-slate-700">
          {t.cases} case{t.cases === 1 ? "" : "s"} · {kind === "forecast" ? "forecast exposure" : "clawback exposure"} {gbp(t.exposure)}
          {t.staleCount > 0 && (
            <span className="ml-2 rounded bg-red-600 px-1.5 py-0.5 font-sans text-xs font-bold uppercase text-white">
              {t.staleCount} not worked
            </span>
          )}
        </div>
      </div>

      <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
        {block.cases.length > 0
          ? <CaseTable rows={block.cases} />
          : <div className="px-3 py-3 text-sm text-slate-400">No current-book cases this month.</div>}

        {/* Month footer, Guy's layout: Total Off's row (each Off above
            its On), then Total On's row, Outstanding + Net position. */}
        <div className="border-t-2 border-slate-300 bg-white px-3 py-2">
          <div className="grid grid-cols-9 gap-1.5">
            <FootCell label="Total Off's" value={gbp(t.neg)} bg="#7f1d1d" fg="#ffffff" />
            {NEG_COLS.map((c) => {
              const v = colValue(t, c);
              const ref = c === "other" ? STATUS_VISUAL.dead_client : STATUS_VISUAL[c];
              return <FootCell key={c} label={COL_SHORT[c]} value={gbp(v)} bg={ref.bg} fg={ref.fg} dim={!v} />;
            })}
            <FootCell label="Outstanding" value={gbp(t.outstanding)} bg="#e2e8f0" fg="#334155" dim={!t.outstanding} />
            <FootCell label="Total On's" value={gbp(t.pos)} bg="#14532d" fg="#ffffff" />
            {POS_COLS.map((c) => {
              const v = colValue(t, c);
              const ref = STATUS_VISUAL[c];
              return <FootCell key={c} label={COL_SHORT[c]} value={gbp(v)} bg={ref.bg} fg={ref.fg} border={ref.bd} dim={!v} />;
            })}
            <div />
            <div className="min-w-0 rounded border-2 border-slate-900 bg-white px-2 py-1">
              <span className="block text-[8.5px] font-bold uppercase tracking-wider text-slate-700">Net position</span>
              <span className={`text-[12.5px] font-bold tabular-nums ${t.net > 0 ? "text-red-700" : "text-emerald-700"}`}>{gbp(t.net)}</span>
            </div>
          </div>
        </div>

        {/* Old Openwork subsection: every potential clawback visible,
            clearly separated, not expected to debit the account. */}
        {block.oldOw.length > 0 && (
          <>
            <div className="flex items-baseline justify-between border-t-2 border-amber-300 bg-amber-50 px-3 py-2">
              <div className="text-sm font-bold text-amber-900">
                Old Openwork
                <span className="ml-2 text-xs font-normal text-amber-800">
                  not expected to debit the account · promote via &quot;Mark as actualised CB&quot; if it appears on the OW bank statement
                </span>
              </div>
              <div className="font-mono text-xs text-amber-900">
                {block.oldOw.length} case{block.oldOw.length === 1 ? "" : "s"} · {gbp(block.oldOwExposure)} · running total {gbp(block.oldOwRunning)}
              </div>
            </div>
            <CaseTable rows={block.oldOw} oldOw />
          </>
        )}
      </div>
    </section>
  );
}
