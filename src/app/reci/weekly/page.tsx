"use client";

/**
 * Weekly Deals report — line-by-line deal listing, grouped by week then by
 * agent. Same scope filter as the Deal Tracker. Built for landscape printing.
 */
import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import {
  STATUS_LABELS, type DealStatus,
  CANCELLATION_REASON_LABELS, type CancellationReason,
  IN_PROCESSING_STAGE_LABELS, type InProcessingStage,
} from "@/lib/reci/schema";
import { PrintButton, PrintHeader } from "@/components/print";

type ScopeKind = "year" | "quarter" | "month" | "week";

interface WeeklyDealRow {
  id: number;
  adviser_id: number;
  adviser_name: string;
  adviser_sort: number;
  week: number;
  client: string;
  postcode: string | null;
  no_of_deals: number;
  provider: string | null;
  premium: number | null;
  confirmed_date: string | null;
  poz_listened: string | null;
  submitted: string | null;
  acc_ref: string | null;
  status: DealStatus;
  in_processing_stage: InProcessingStage | null;
  reason: CancellationReason | null;
  notes: string | null;
  commission: number;
}
interface AgentGroup {
  adviser_id: number;
  adviser_name: string;
  deals: WeeklyDealRow[];
  subtotal: { count: number; commission: number };
}
interface WeekGroup {
  week: number;
  monthName: string;
  quarter: number;
  agents: AgentGroup[];
  total: { count: number; commission: number };
}
interface Resp {
  year: number;
  scope: { kind: ScopeKind; q?: number; month?: number; week?: number };
  weeks: WeekGroup[];
  grand: { count: number; commission: number };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

const STATUS_COLORS: Record<DealStatus, string> = {
  not_yet_submitted: "#94a3b8",
  in_processing:     "#3b82f6",
  on_risk_nyp:       "#8b5cf6",
  paid:              "#10b981",
  cancelled:         "#ef4444",
  clawback:          "#7c2d12",
};

const REASON_COLORS: Record<CancellationReason, string> = {
  npw:       "#dc2626", // red-600
  postponed: "#2563eb", // blue-600
  declined:  "#16a34a", // green-600
  other:     "#f59e0b", // amber-500
};

function gbp(n: number): string {
  return Number(n || 0).toLocaleString("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export default function WeeklyPage() {
  const now = new Date();
  const [year,  setYear]    = useState<number>(now.getFullYear());
  const [kind,  setKind]    = useState<ScopeKind>("month");
  const [month, setMonth]   = useState<number>(now.getMonth() + 1);
  const [quarter, setQuarter] = useState<number>(Math.ceil((now.getMonth() + 1) / 3));
  const [week,  setWeek]    = useState<number>(1);

  const [data, setData]     = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState<string | null>(null);

  // Landscape print for this page only.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-weekly-print", "1");
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
    return p.toString();
  }, [year, kind, quarter, month, week]);

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/reci/weekly-report?${qs}`, { signal, cache: "no-store" });
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

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1800px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Weekly Deals</h1>
            <span className="text-sm text-slate-500">{scopeLabel}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Year</span>
              <input type="number" value={year}
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
              <input type="number" min={1} max={53} value={week}
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
          title="Weekly Deals"
          subtitle={scopeLabel}
          meta={[
            { label: "Year",  value: String(year) },
            { label: "Scope", value: scopeLabel },
          ]}
        />

        {!data || data.weeks.length === 0 ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">
            {loading ? "Loading…" : "No deals in current scope."}
          </div>
        ) : (
          <>
            {data.weeks.map((wg) => (
              <WeekSection key={wg.week} group={wg} year={data.year} />
            ))}
            <section className="mt-4 rounded-lg border bg-slate-900 px-4 py-3 text-white shadow-sm print-keep">
              <div className="flex items-center justify-between text-sm">
                <span className="font-semibold uppercase tracking-wide">
                  Overall — {scopeLabel}
                </span>
                <span className="tabular-nums">
                  {data.grand.count} deal{data.grand.count === 1 ? "" : "s"} · {gbp(data.grand.commission)}
                </span>
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

// ---------- Sections ----------

function WeekSection({ group, year }: { group: WeekGroup; year: number }) {
  return (
    <section className="mb-5 rounded-lg border bg-white shadow-sm print-keep">
      <h2 className="border-b bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
        Week {group.week} <span className="text-xs font-normal text-slate-500">· {group.monthName} {year} · Q{group.quarter}</span>
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed text-xs">
          <colgroup>
            <col style={{ width: "13%" }} />          {/* Client */}
            <col style={{ width: "5rem" }} />         {/* Postcode */}
            <col style={{ width: "2rem" }} />         {/* # */}
            <col style={{ width: "5.5rem" }} />       {/* Provider */}
            <col style={{ width: "4.5rem" }} />       {/* Premium */}
            <col style={{ width: "4rem" }} />         {/* Confirmed */}
            <col style={{ width: "6.5rem" }} />       {/* Status */}
            <col style={{ width: "4rem" }} />         {/* Stage */}
            <col style={{ width: "5.5rem" }} />       {/* Reason */}
            <col />                                    {/* Notes — flex */}
            <col style={{ width: "5.5rem" }} />       {/* Commission */}
          </colgroup>
          <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
            <tr>
              <th className="px-2 py-1 text-left">Client</th>
              <th className="px-2 py-1 text-left">Postcode</th>
              <th className="px-2 py-1 text-right">#</th>
              <th className="px-2 py-1 text-left">Provider</th>
              <th className="px-2 py-1 text-right">Premium</th>
              <th className="px-2 py-1 text-left">Conf</th>
              <th className="px-2 py-1 text-left">Status</th>
              <th className="px-2 py-1 text-left">Stage</th>
              <th className="px-2 py-1 text-left">Reason</th>
              <th className="px-2 py-1 text-left">Notes</th>
              <th className="px-2 py-1 text-right">Commission</th>
            </tr>
          </thead>
          <tbody>
            {group.agents.map((agent) => (
              <Fragment key={agent.adviser_id}>
                <tr className="bg-slate-200 print-keep">
                  <td colSpan={11} className="px-2 py-1 text-xs font-semibold text-slate-800">
                    {agent.adviser_name}
                  </td>
                </tr>
                {agent.deals.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis" title={d.client}>{d.client}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600">{d.postcode || ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums text-slate-600">{d.no_of_deals}</td>
                    <td className="px-2 py-1 whitespace-nowrap overflow-hidden text-ellipsis text-slate-700" title={d.provider ?? ""}>{d.provider || ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums">{d.premium != null ? gbp(d.premium) : ""}</td>
                    <td className="px-2 py-1 whitespace-nowrap text-slate-600">{d.confirmed_date || ""}</td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-4 text-white"
                            style={{ backgroundColor: STATUS_COLORS[d.status] }}>
                        {STATUS_LABELS[d.status]}
                      </span>
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {d.in_processing_stage ? (
                        <span className="inline-block whitespace-nowrap rounded-full bg-blue-100 px-2 py-0.5 text-[10px] font-medium leading-4 text-blue-800">
                          {IN_PROCESSING_STAGE_LABELS[d.in_processing_stage]}
                        </span>
                      ) : ""}
                    </td>
                    <td className="px-2 py-1 whitespace-nowrap">
                      {d.reason ? (
                        <span className="inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-medium leading-4 text-white"
                              style={{ backgroundColor: REASON_COLORS[d.reason] }}>
                          {CANCELLATION_REASON_LABELS[d.reason]}
                        </span>
                      ) : ""}
                    </td>
                    <td className="px-2 py-1 text-slate-700 break-words whitespace-normal leading-snug">{d.notes ?? ""}</td>
                    <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{gbp(d.commission)}</td>
                  </tr>
                ))}
                {/* Agent subtotal — bottom of the agent's deals */}
                <tr className="border-y-2 border-amber-200 bg-amber-50 text-xs font-semibold print-keep">
                  <td colSpan={11} className="px-3 py-1.5">
                    <div className="flex items-center justify-between gap-4 whitespace-nowrap">
                      <span className="uppercase tracking-wide text-amber-800">{agent.adviser_name} subtotal</span>
                      <div className="flex items-center gap-6 tabular-nums">
                        <span className="text-slate-600">
                          {agent.subtotal.count} deal{agent.subtotal.count === 1 ? "" : "s"}
                        </span>
                        <span className="text-amber-900">{gbp(agent.subtotal.commission)}</span>
                      </div>
                    </div>
                  </td>
                </tr>
              </Fragment>
            ))}
            {/* Week total — bottom of the entire week's table */}
            <tr className="bg-slate-900 text-sm font-bold text-white print-keep">
              <td colSpan={11} className="px-3 py-2">
                <div className="flex items-center justify-between gap-4 whitespace-nowrap">
                  <span className="uppercase tracking-wide">Week {group.week} total</span>
                  <div className="flex items-center gap-6 tabular-nums">
                    <span>{group.total.count} deal{group.total.count === 1 ? "" : "s"}</span>
                    <span>{gbp(group.total.commission)}</span>
                  </div>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------- Header controls (lifted from tracker page) ----------

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
