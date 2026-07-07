"use client";

/**
 * Credit Control report, restyled to Guy's mock-up (7 Jul 2026 feedback).
 *
 * Key mock elements reproduced:
 *   - Colour key top-right (Not worked / DD booked / Resold / Dead
 *     number / Cancelled)
 *   - Whole rows tinted by status: white=open, light green=DD booked
 *     (reinstated) + saved, dark green + white text=resold, light
 *     blue=dead number (lost, dead contact), light red=cancelled
 *     (lost, other reasons)
 *   - Chip-style money footer per month (EXPOSURE black, OUTSTANDING
 *     white, DD BOOKED green, RESOLD dark green, DEAD NUMBER blue,
 *     CANCELLED red, SAVED, LOST)
 *   - "Completed months summary" table + three YTD cards (Lost
 *     commission red / Earned commission green / Saved commission
 *     dark), positioned directly beneath the current month so Guy
 *     doesn't scroll for the key figures
 *   - table-fixed with set column widths so long client names
 *     truncate (full name on hover) instead of shifting columns
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
  exposure: number; outstanding: number; ddBooked: number; resold: number;
  deadNumber: number; cancelled: number; savedExplicit: number;
  saved: number; lost: number; redrawNet: number;
  earnedComm: number; savedComm: number;
  staleCount: number; cases: number;
}
interface MonthBlock { key: string; label: string; cases: CaseRow[]; totals: MonthTotals }
interface ReportResp {
  generatedAt: string;
  staleDays: number;
  scoped: boolean;
  forecast: MonthBlock[];
  completed: MonthBlock[];
}

/** Row tint + status pill styling per Guy's colour key. */
function rowVisual(c: CaseRow): { row: string; pill: string; pillLabel: string } {
  switch (c.status) {
    case "reinstated":
      return { row: "bg-emerald-50", pill: "bg-emerald-100 text-emerald-800 border border-emerald-300", pillLabel: "DD collection booked" };
    case "saved":
      return { row: "bg-emerald-50", pill: "bg-emerald-100 text-emerald-800 border border-emerald-300", pillLabel: "Saved" };
    case "resold":
      return { row: "bg-emerald-800 text-white", pill: "bg-emerald-950 text-white", pillLabel: "Resold" };
    case "dead":
      if (c.lost_reason === "dead_contact") {
        return { row: "bg-blue-50", pill: "bg-blue-100 text-blue-800 border border-blue-300", pillLabel: "Dead number" };
      }
      return { row: "bg-red-50", pill: "bg-red-100 text-red-800 border border-red-300", pillLabel: "Cancelled" };
    case "redraw":
      return { row: "bg-purple-50", pill: "bg-purple-100 text-purple-800 border border-purple-300", pillLabel: "Redraw" };
    case "closed":
      return { row: "bg-slate-100", pill: "bg-slate-200 text-slate-600", pillLabel: "Closed" };
    default:
      return { row: "bg-white", pill: "bg-white text-slate-700 border border-slate-300", pillLabel: "Not worked" };
  }
}

function gbp(n: number): string {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0 });
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
function daysAgo(iso: string | null): string {
  if (!iso) return "never";
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
  if (d <= 0) return "today";
  return `${d}d`;
}

const KEY_ITEMS = [
  { label: "Not worked",           cls: "bg-white border border-slate-300" },
  { label: "DD collection booked", cls: "bg-emerald-200" },
  { label: "Resold",               cls: "bg-emerald-800" },
  { label: "Dead number",          cls: "bg-blue-200" },
  { label: "Cancelled",            cls: "bg-red-200" },
];

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

  // Year summary across completed months (mock: "Completed months
  // summary, computed live from the case detail above").
  const year = new Date().getFullYear();
  const completedThisYear = data
    ? data.completed.filter((m) => m.key.startsWith(String(year))).slice().reverse()
    : [];
  const ytd = completedThisYear.reduce(
    (acc, m) => ({
      ddBooked:   acc.ddBooked + m.totals.ddBooked,
      resold:     acc.resold + m.totals.resold,
      deadNumber: acc.deadNumber + m.totals.deadNumber,
      cancelled:  acc.cancelled + m.totals.cancelled,
      lost:       acc.lost + m.totals.lost,
      earned:     acc.earned + m.totals.earnedComm,
      saved:      acc.saved + m.totals.savedComm,
    }),
    { ddBooked: 0, resold: 0, deadNumber: 0, cancelled: 0, lost: 0, earned: 0, saved: 0 },
  );

  return (
    <main className="mx-auto max-w-[1700px] px-4 py-4">
      <PrintHeader
        title="Credit Control - Clawback Forecast & Recovery Report"
        subtitle={`Cases with missed payments, cancelled DD mandates or cancelled policies · Generated ${new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" })}`}
        meta={[
          { label: "Not worked", value: String(totalStale) },
        ]}
      />

      {/* Header block matching the mock: eyebrow, big title, colour key right */}
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
        <div className="flex flex-wrap items-center gap-2 pt-1">
          {KEY_ITEMS.map((k) => (
            <span key={k.label} className="flex items-center gap-1.5 rounded border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700">
              <span className={`inline-block h-3.5 w-3.5 rounded-sm ${k.cls}`} />
              {k.label}
            </span>
          ))}
        </div>
      </div>

      <section className="no-print mt-3 flex flex-wrap items-center gap-3 rounded border border-slate-200 bg-white p-2 text-sm">
        <div className="flex items-center gap-2">
          <Link href="/reci/clawback" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Dashboard</Link>
          <Link href="/reci/clawback/reports" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Reports</Link>
          <PrintButton />
        </div>
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
          {/* Current month first... */}
          {data.forecast.length > 0 && <MonthSection block={data.forecast[0]} kind="forecast" />}

          {/* ...then the year summary directly beneath it so Guy sees the
              key figures without scrolling. */}
          <section className="mt-8 break-inside-avoid">
            <h2 className="border-b-2 border-slate-900 pb-2 text-lg font-bold">
              Completed months — {year} summary
              <span className="ml-2 text-xs font-normal text-slate-500">computed live from the case detail below</span>
            </h2>
            <div className="mt-2 overflow-x-auto rounded border border-slate-200 bg-white">
              <table className="w-full table-fixed text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                  <tr>
                    <th className="w-[12%] px-3 py-2 text-left font-medium">Month</th>
                    <th className="w-[12%] px-3 py-2 text-right font-medium text-emerald-700">DD booked</th>
                    <th className="w-[12%] px-3 py-2 text-right font-medium text-emerald-800">Resold</th>
                    <th className="w-[12%] px-3 py-2 text-right font-medium text-blue-700">Dead number</th>
                    <th className="w-[12%] px-3 py-2 text-right font-medium text-red-700">Cancelled</th>
                    <th className="w-[13%] px-3 py-2 text-right font-medium text-red-700">Lost comm.</th>
                    <th className="w-[13%] px-3 py-2 text-right font-medium text-emerald-700">Earned comm.</th>
                    <th className="w-[14%] px-3 py-2 text-right font-medium">Saved comm.</th>
                  </tr>
                </thead>
                <tbody>
                  {completedThisYear.length === 0 ? (
                    <tr><td colSpan={8} className="px-3 py-3 text-center text-slate-400">No completed months yet in {year}.</td></tr>
                  ) : completedThisYear.map((m) => (
                    <tr key={m.key} className="border-t border-slate-100">
                      <td className="px-3 py-1.5 font-medium">{m.label.replace(String(year), "").trim()} {year}</td>
                      <td className="px-3 py-1.5 text-right">{gbp(m.totals.ddBooked)}</td>
                      <td className="px-3 py-1.5 text-right">{gbp(m.totals.resold)}</td>
                      <td className="px-3 py-1.5 text-right">{gbp(m.totals.deadNumber)}</td>
                      <td className="px-3 py-1.5 text-right">{gbp(m.totals.cancelled)}</td>
                      <td className="px-3 py-1.5 text-right text-red-700">{gbp(m.totals.lost)}</td>
                      <td className="px-3 py-1.5 text-right text-emerald-700">{gbp(m.totals.earnedComm)}</td>
                      <td className="px-3 py-1.5 text-right">{gbp(m.totals.savedComm)}</td>
                    </tr>
                  ))}
                  {completedThisYear.length > 0 && (
                    <tr className="border-t-2 border-slate-300 bg-slate-50 font-semibold">
                      <td className="px-3 py-2">{year} YTD</td>
                      <td className="px-3 py-2 text-right">{gbp(ytd.ddBooked)}</td>
                      <td className="px-3 py-2 text-right">{gbp(ytd.resold)}</td>
                      <td className="px-3 py-2 text-right">{gbp(ytd.deadNumber)}</td>
                      <td className="px-3 py-2 text-right">{gbp(ytd.cancelled)}</td>
                      <td className="px-3 py-2 text-right text-red-700">{gbp(ytd.lost)}</td>
                      <td className="px-3 py-2 text-right text-emerald-700">{gbp(ytd.earned)}</td>
                      <td className="px-3 py-2 text-right">{gbp(ytd.saved)}</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Three YTD cards, mock colours */}
            <div className="mt-3 grid grid-cols-1 gap-3 md:grid-cols-3">
              <div className="rounded bg-red-900 p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Lost commission — {year} YTD</div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{gbp(ytd.lost)}</div>
                <div className="mt-1 text-xs opacity-80">Dead numbers + cancellations</div>
              </div>
              <div className="rounded bg-emerald-800 p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Earned commission — {year} YTD</div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{gbp(ytd.earned)}</div>
                <div className="mt-1 text-xs opacity-80">New commission from resold cases</div>
              </div>
              <div className="rounded bg-slate-900 p-4 text-white">
                <div className="text-xs font-semibold uppercase tracking-wide opacity-80">Saved commission — {year} YTD</div>
                <div className="mt-1 text-3xl font-bold tabular-nums">{gbp(ytd.saved)}</div>
                <div className="mt-1 text-xs opacity-80">DD collections booked + resold clawback avoided</div>
              </div>
            </div>
          </section>

          {/* Remaining forecast months */}
          {data.forecast.slice(1).map((m) => <MonthSection key={m.key} block={m} kind="forecast" />)}

          {/* Completed month detail */}
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

function Chip({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <span className={`inline-flex items-center gap-2 rounded border px-2.5 py-1.5 text-xs font-semibold ${cls}`}>
      <span className="uppercase tracking-wide">{label}</span>
      <span className="tabular-nums">{value}</span>
    </span>
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
        <table className="w-full table-fixed text-sm">
          <thead className="bg-slate-100 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="w-[13%] px-3 py-2 text-left font-medium">Client</th>
              <th className="w-[9%] px-3 py-2 text-left font-medium">Policy</th>
              <th className="w-[9%] px-3 py-2 text-left font-medium">Type</th>
              <th className="w-[8%] px-3 py-2 text-left font-medium">Seller</th>
              <th className="w-[13%] px-3 py-2 text-left font-medium">Trigger</th>
              <th className="w-[7%] px-3 py-2 text-right font-medium">Prem /mo</th>
              <th className="w-[8%] px-3 py-2 text-right font-medium">Clawback</th>
              <th className="w-[14%] px-3 py-2 text-left font-medium">Status</th>
              <th className="w-[5%] px-3 py-2 text-left font-medium">Idle</th>
              <th className="w-[14%] px-3 py-2 text-left font-medium">Reason / notes</th>
            </tr>
          </thead>
          <tbody>
            {block.cases.map((c) => {
              const v = rowVisual(c);
              const muted = c.status === "resold" ? "text-emerald-100" : "text-slate-500";
              return (
                <tr key={c.id} className={`border-t border-slate-200 ${v.row}`}>
                  <td className="truncate px-3 py-2 font-medium" title={c.client_name}>
                    <Link href={`/reci/clawback?q=${encodeURIComponent(c.policy_number)}`} className="hover:underline">
                      {surnameFirst(c)}
                    </Link>
                  </td>
                  <td className="truncate px-3 py-2 font-mono text-xs" title={c.policy_number}>{c.policy_number}</td>
                  <td className="truncate px-3 py-2" title={c.policy_type || ""}>{c.policy_type || "—"}</td>
                  <td className="truncate px-3 py-2" title={c.seller}>{c.seller}</td>
                  <td className={`truncate px-3 py-2 ${muted}`} title={c.trigger || ""}>{c.trigger || "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{gbp2(c.net_premium)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{gbp2(c.clawback)}</td>
                  <td className="px-3 py-2">
                    <span className={`inline-block max-w-full truncate rounded-full px-2 py-0.5 text-xs font-medium ${v.pill}`}>
                      {v.pillLabel}
                    </span>
                    {c.stale && (
                      <span className="ml-1 inline-block rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-bold uppercase text-white">
                        Not worked
                      </span>
                    )}
                  </td>
                  <td className={`px-3 py-2 text-xs ${muted}`}>{daysAgo(c.last_action_at)}</td>
                  <td className={`truncate px-3 py-2 text-xs ${muted}`} title={c.latest_note || ""}>
                    {c.latest_note || "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="flex flex-wrap gap-2 border-t-2 border-slate-300 bg-white px-3 py-2">
          <Chip label="Exposure"    value={gbp(t.exposure)}    cls="border-slate-900 bg-slate-900 text-white" />
          <Chip label="Outstanding" value={gbp(t.outstanding)} cls="border-slate-300 bg-white text-slate-800" />
          <Chip label="DD booked"   value={gbp(t.ddBooked)}    cls="border-emerald-300 bg-emerald-50 text-emerald-800" />
          <Chip label="Resold"      value={gbp(t.resold)}      cls="border-emerald-900 bg-emerald-800 text-white" />
          <Chip label="Dead number" value={gbp(t.deadNumber)}  cls="border-blue-300 bg-blue-50 text-blue-800" />
          <Chip label="Cancelled"   value={gbp(t.cancelled)}   cls="border-red-300 bg-red-50 text-red-800" />
          <Chip label="Saved"       value={gbp(t.saved)}       cls="border-emerald-300 bg-white text-emerald-800" />
          <Chip label="Lost"        value={gbp(t.lost)}        cls="border-red-300 bg-white text-red-800" />
        </div>
      </div>
    </section>
  );
}
