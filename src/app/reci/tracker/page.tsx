"use client";

/**
 * Deal Tracker page — the report Pauline generates for Guy. Layout matches
 * the PDF she shared: per-month sections with weekly rows + Monthly Total,
 * Weekly Average and YTD summary rows. Per-adviser 3-column groups
 * (Deals / Est Comm / Av Prem) plus left-side aggregate columns
 * (Deals / Est Gross / Clawback / Est Net).
 *
 * Period picker chooses Year / Quarter / Month / Week scope.
 * Print produces a landscape paper version (one @page landscape rule is
 * injected when this page mounts and removed when it unmounts).
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";

type ScopeKind = "year" | "quarter" | "month" | "week";

interface AdviserCell { deals: number; est_comm: number; av_prem: number }
interface TrackerRow {
  kind: "week" | "monthly-total" | "weekly-average" | "ytd";
  label: string;
  weekNumbers: number[];
  deals: number;
  est_gross_comm: number;
  cancelled: number;
  clawback: number;
  est_net_comm: number;
  byAdviser: Record<number, AdviserCell>;
}
interface TrackerMonth {
  monthNumber: number;
  monthName: string;
  quarter: number;
  weekRows: TrackerRow[];
  monthlyTotal: TrackerRow;
  weeklyAverage: TrackerRow;
  yearToDate: TrackerRow;
}
interface TrackerAdviser { id: number; name: string }
interface TrackerResp {
  year: number;
  scope: { kind: ScopeKind; q?: number; month?: number; week?: number };
  advisers: TrackerAdviser[];
  months: TrackerMonth[];
  weekOnly?: TrackerRow;
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

function num(n: number, decimals = 0): string {
  return Number(n || 0).toLocaleString("en-GB", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

export default function TrackerPage() {
  const now = new Date();
  const [year,  setYear]  = useState<number>(now.getFullYear());
  const [kind,  setKind]  = useState<ScopeKind>("month");
  const [month, setMonth] = useState<number>(now.getMonth() + 1);
  const [quarter, setQuarter] = useState<number>(Math.ceil((now.getMonth() + 1) / 3));
  const [week, setWeek] = useState<number>(1);

  const [data, setData] = useState<TrackerResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // Inject a landscape @page rule for this route only; remove on unmount.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-tracker-print", "1");
    style.textContent = "@media print { @page { size: A4 landscape; margin: 8mm; } }";
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("year", String(year));
    p.set("scope", kind);
    if (kind === "quarter") p.set("q", String(quarter));
    if (kind === "month")   p.set("month", String(month));
    if (kind === "week")    p.set("week", String(week));
    return p.toString();
  }, [year, kind, quarter, month, week]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/reci/tracker?${qs}`, { signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as TrackerResp;
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">RECI Deal Tracker</h1>
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
        {(loading || err) && (
          <div className="mx-auto max-w-[1800px] px-4 pb-2 text-xs">
            {loading ? <span className="text-slate-500">Loading…</span>
                     : <span className="text-red-600">{err}</span>}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1800px] px-4 py-4">
        <PrintHeader
          title="RECI Deal Tracker"
          subtitle={scopeLabel}
          meta={[
            { label: "Year",  value: String(year) },
            { label: "Scope", value: scopeLabel },
          ]}
        />

        {data && data.weekOnly && (
          <TrackerTable advisers={data.advisers} rows={[data.weekOnly]} title={`Week ${data.weekOnly.label}`} />
        )}

        {data && data.months.map((m) => (
          <TrackerTable
            key={m.monthNumber}
            advisers={data.advisers}
            title={`${m.monthName} ${data.year} — Q${m.quarter}`}
            rows={[...m.weekRows, m.monthlyTotal, m.weeklyAverage, m.yearToDate]}
          />
        ))}

        {!data && !loading && !err && (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">No data yet.</div>
        )}
      </main>
    </div>
  );
}

// --- Sub-components ---------------------------------------------------------

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
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 py-1 ${value === o.value ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}
        >
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
    <select
      value={value}
      onChange={(e) => onChange(Number(e.target.value) as T)}
      className="rounded border border-slate-300 bg-white px-2 py-1 text-sm"
    >
      {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  );
}

function TrackerTable({ advisers, rows, title }: {
  advisers: TrackerAdviser[];
  rows: TrackerRow[];
  title: string;
}) {
  return (
    <section className="mb-6 rounded-lg border bg-white shadow-sm print-keep">
      <h2 className="border-b px-3 py-2 text-sm font-semibold text-slate-700">{title}</h2>
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-xs">
          <thead>
            <tr className="bg-slate-100 text-slate-600">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left">Week</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Deals</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Est Gross Comm</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Cancelled</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Clawback</th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Est Net Comm</th>
              {advisers.map((a) => (
                <th
                  key={a.id}
                  colSpan={3}
                  className="border-b border-r border-slate-200 bg-slate-50 px-2 py-1 text-center"
                >
                  {a.name}
                </th>
              ))}
            </tr>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left"></th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right"></th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right"></th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right"></th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right"></th>
              <th className="border-b border-r border-slate-200 px-2 py-1 text-right"></th>
              {advisers.map((a) => (
                <Fragment key={a.id}>
                  <th className="border-b border-r border-slate-100 px-2 py-1 text-right">Deals</th>
                  <th className="border-b border-r border-slate-100 px-2 py-1 text-right">Est Comm</th>
                  <th className="border-b border-r border-slate-200 px-2 py-1 text-right">Av Prem</th>
                </Fragment>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <Row key={`${r.kind}-${i}-${r.label}`} row={r} advisers={advisers} />
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Row({ row, advisers }: { row: TrackerRow; advisers: TrackerAdviser[] }) {
  // Styling by row kind.
  const bg =
    row.kind === "monthly-total"   ? "bg-slate-100 font-semibold" :
    row.kind === "weekly-average"  ? "bg-slate-50 italic" :
    row.kind === "ytd"             ? "bg-amber-50 font-semibold" :
    "";

  const labelCell =
    row.kind === "week" ? row.label
                        : row.label;

  return (
    <tr className={`${bg} print-keep`}>
      <td className="border-b border-r border-slate-200 px-2 py-1 whitespace-nowrap">{labelCell}</td>
      <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">
        {row.kind === "weekly-average" ? num(row.deals, 1) : num(row.deals)}
      </td>
      <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">{gbp(row.est_gross_comm)}</td>
      <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">{gbp(row.cancelled)}</td>
      <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">{gbp(row.clawback)}</td>
      <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">{gbp(row.est_net_comm)}</td>
      {advisers.map((a) => {
        const c = row.byAdviser[a.id] ?? { deals: 0, est_comm: 0, av_prem: 0 };
        return (
          <Fragment key={a.id}>
            <td className="border-b border-r border-slate-100 px-2 py-1 text-right tabular-nums">
              {row.kind === "weekly-average" ? num(c.deals, 1) : num(c.deals)}
            </td>
            <td className="border-b border-r border-slate-100 px-2 py-1 text-right tabular-nums">{gbp(c.est_comm)}</td>
            <td className="border-b border-r border-slate-200 px-2 py-1 text-right tabular-nums">{gbp(c.av_prem)}</td>
          </Fragment>
        );
      })}
    </tr>
  );
}
