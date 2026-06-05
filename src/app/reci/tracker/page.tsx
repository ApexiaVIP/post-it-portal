"use client";

/**
 * Business Tracker — per-adviser weekly commission breakdown by status, with
 * percentages of weekly total. Matches the printed report Pauline uses.
 *
 * Filter bar at top: Year, Scope (Week / Month / Quarter / Year), and a
 * multi-select adviser pill row. If no advisers are selected, the page shows
 * all advisers that have data in scope, stacked one block per adviser.
 *
 * Each block:
 *   Adviser name
 *   12-column table: WEEK | PAID £ | % | ON RISK NYP £ | % | IN PROC £ | %
 *                  | NYS £ | % | CANCELLED £ | % | TOTAL £
 *   Rows: each week in scope.
 *   TOTAL row at the bottom of the block: sum across the weeks.
 *
 * Force landscape A4 for print (the 12-column table is wide).
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";

type ScopeKind = "year" | "quarter" | "month" | "week";

interface BizWeekRow {
  week: number;
  paid: number;
  on_risk_nyp: number;
  in_processing: number;
  not_yet_submitted: number;
  cancelled: number;
  total: number;
}
interface BizAdviserRollup {
  adviser_id: number;
  adviser_name: string;
  weeks: BizWeekRow[];
  total: BizWeekRow;
}
interface Adviser { id: number; name: string }
interface Resp {
  year: number;
  scope: { kind: ScopeKind; q?: number; month?: number; week?: number };
  weeksInScope: number[];
  advisers: BizAdviserRollup[];
  allAdvisers: Adviser[];
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

function gbp(n: number): string {
  return Number(n || 0).toLocaleString("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return "0%";
  return `${Math.round((part / whole) * 100)}%`;
}

export default function BusinessTrackerPage() {
  const now = new Date();
  const [year, setYear] = useState<number>(now.getFullYear());
  const [kind, setKind] = useState<ScopeKind>("year");
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [quarter, setQuarter] = useState<number>(Math.ceil((now.getMonth() + 1) / 3));
  const [week, setWeek] = useState<number>(1);
  const [selectedAdvisers, setSelectedAdvisers] = useState<number[]>([]);

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Landscape print for this page only.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-bizt-print", "1");
    style.textContent = "@media print { @page { size: A4 landscape; margin: 8mm; } }";
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("year", String(year));
    p.set("scope", kind);
    if (kind === "quarter") p.set("q",     String(quarter));
    if (kind === "month")   p.set("month", String(month));
    if (kind === "week")    p.set("week",  String(week));
    if (selectedAdvisers.length > 0) p.set("advisers", selectedAdvisers.join(","));
    return p.toString();
  }, [year, kind, quarter, month, week, selectedAdvisers]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/reci/business-tracker?${qs}`, { signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Resp;
      setData(j);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [qs]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const scopeLabel = useMemo(() => {
    if (kind === "year")    return `${year} Year To Date`;
    if (kind === "quarter") return `Q${quarter} ${year}`;
    if (kind === "month")   return `${MONTH_NAMES[month - 1]} ${year}`;
    return `Week ${week} ${year}`;
  }, [kind, year, month, quarter, week]);

  const toggleAdviser = (id: number) =>
    setSelectedAdvisers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Business Tracker</h1>
            <span className="text-sm text-slate-500">{scopeLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Year</span>
              <input
                type="number" value={year}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
              />
            </label>
            <ScopeToggle value={kind} onChange={setKind} />
            {kind === "quarter" && (
              <SelectInline value={quarter} onChange={setQuarter}
                options={[1,2,3,4].map((q) => ({ value: q, label: `Q${q}` }))} />
            )}
            {kind === "month" && (
              <SelectInline value={month} onChange={setMonth}
                options={MONTH_NAMES.map((m, i) => ({ value: i + 1, label: m }))} />
            )}
            {kind === "week" && (
              <input
                type="number" min={1} max={53} value={week}
                onChange={(e) => setWeek(Math.max(1, Math.min(53, Number(e.target.value) || 1)))}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-right"
              />
            )}
            <PrintButton />
          </div>
        </div>

        {/* Adviser multi-select filter */}
        {data && data.allAdvisers.length > 0 && (
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 pb-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-500">Advisers</span>
            {data.allAdvisers.map((a) => {
              const active = selectedAdvisers.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => toggleAdviser(a.id)}
                  className={`rounded-full border px-2.5 py-0.5 transition-colors ${
                    active
                      ? "border-slate-900 bg-slate-900 text-white"
                      : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                  }`}
                >
                  {a.name}
                </button>
              );
            })}
            {selectedAdvisers.length > 0 && (
              <button
                type="button"
                onClick={() => setSelectedAdvisers([])}
                className="text-xs text-slate-500 hover:text-slate-900 underline ml-1"
              >
                Clear (show all)
              </button>
            )}
            {selectedAdvisers.length === 0 && (
              <span className="text-slate-400">none selected — showing all advisers with data in scope</span>
            )}
          </div>
        )}

        {(loading || err) && (
          <div className="mx-auto max-w-[1800px] px-4 pb-2 text-xs">
            {loading ? <span className="text-slate-500">Loading…</span>
                     : <span className="text-red-600">{err}</span>}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-4 space-y-6">
        <PrintHeader
          title="Business Tracker"
          subtitle={scopeLabel}
          meta={[
            { label: "Year",  value: String(year) },
            { label: "Scope", value: scopeLabel },
          ]}
        />

        {!data || data.advisers.length === 0 ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">
            {loading ? "Loading…" : "No deals in current scope."}
          </div>
        ) : (
          data.advisers.map((a) => <AdviserBlock key={a.adviser_id} block={a} />)
        )}
      </main>
    </div>
  );
}

function AdviserBlock({ block }: { block: BizAdviserRollup }) {
  return (
    <section className="rounded-lg border bg-white shadow-sm print-keep">
      <h2 className="border-b bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
        {block.adviser_name}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <colgroup>
            <col style={{ width: "4.5rem" }} />     {/* Week */}
            <col style={{ width: "6.5rem" }} />     {/* Paid £ */}
            <col style={{ width: "3rem"   }} />     {/* Paid % */}
            <col style={{ width: "6.5rem" }} />     {/* On Risk NYP £ */}
            <col style={{ width: "3rem"   }} />     {/* On Risk NYP % */}
            <col style={{ width: "6.5rem" }} />     {/* In Proc £ */}
            <col style={{ width: "3rem"   }} />     {/* In Proc % */}
            <col style={{ width: "6.5rem" }} />     {/* NYS £ */}
            <col style={{ width: "3rem"   }} />     {/* NYS % */}
            <col style={{ width: "6.5rem" }} />     {/* Cancelled £ */}
            <col style={{ width: "3rem"   }} />     {/* Cancelled % */}
            <col />                                  {/* Total £ — flex */}
          </colgroup>
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left">Week</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Paid</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">%</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">On Risk NYP</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">%</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">In Proc</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">%</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">NYS</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">%</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Cancelled</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">%</th>
              <th className="border-b border-slate-200 px-2 py-1 text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {block.weeks.map((w) => (
              <Row key={w.week} row={w} weekLabel={`Week ${w.week}`} kind="week" />
            ))}
            <Row row={block.total} weekLabel="TOTAL" kind="total" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ row, weekLabel, kind }: {
  row: BizWeekRow; weekLabel: string; kind: "week" | "total";
}) {
  const bg = kind === "total" ? "bg-slate-900 text-white font-semibold" : "";
  const cellBorder = kind === "total" ? "border-slate-700" : "border-slate-100";
  const cellEmpty = (n: number) => kind === "total" ? "" : (n === 0 ? "text-slate-300" : "");
  return (
    <tr className={`${bg} print-keep`}>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 whitespace-nowrap ${kind === "total" ? "uppercase tracking-wide" : "text-slate-600"}`}>
        {weekLabel}
      </td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.paid)}`}>{gbp(row.paid)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.paid)}`}>{pct(row.paid, row.total)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.on_risk_nyp)}`}>{gbp(row.on_risk_nyp)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.on_risk_nyp)}`}>{pct(row.on_risk_nyp, row.total)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.in_processing)}`}>{gbp(row.in_processing)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.in_processing)}`}>{pct(row.in_processing, row.total)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.not_yet_submitted)}`}>{gbp(row.not_yet_submitted)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.not_yet_submitted)}`}>{pct(row.not_yet_submitted, row.total)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.cancelled)}`}>{gbp(row.cancelled)}</td>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${cellEmpty(row.cancelled)}`}>{pct(row.cancelled, row.total)}</td>
      <td className={`border-b ${cellBorder} px-2 py-1 text-right tabular-nums ${kind === "total" ? "" : "font-medium"}`}>{gbp(row.total)}</td>
    </tr>
  );
}

// ---------- Header controls ----------

function ScopeToggle({ value, onChange }: { value: ScopeKind; onChange: (v: ScopeKind) => void }) {
  const opts: { value: ScopeKind; label: string }[] = [
    { value: "week",    label: "Week" },
    { value: "month",   label: "Month" },
    { value: "quarter", label: "Quarter" },
    { value: "year",    label: "Year" },
  ];
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white text-xs">
      {opts.map((o) => (
        <button key={o.value} type="button" onClick={() => onChange(o.value)}
          className={`px-2 py-1 ${value === o.value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

function SelectInline<T extends number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select value={value}
      onChange={(e) => onChange(Number(e.target.value) as T)}
      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}
