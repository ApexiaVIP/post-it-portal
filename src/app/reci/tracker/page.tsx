"use client";

/**
 * Business Tracker — per-adviser weekly commission breakdown by status, with
 * percentages of weekly total. Matches the printed report Pauline uses.
 *
 * Layout since Poz's 6 Aug 2026 amendments: totals FIRST (Overall total with
 * a weekly-average row, then the per-adviser per-status summary with £ +
 * deal counts + weekly averages), then quarter subtotals and week blocks in
 * REVERSE order — current week at the top, Week 1 at the bottom — so Guy
 * sees the overall position without scrolling. Every £ cell also shows the
 * deal count underneath.
 *
 * Filter bar at top: Year, Scope (Week / Month / Quarter / Year), and a
 * multi-select adviser pill row. If no advisers are selected, the page shows
 * all advisers that have data in scope.
 *
 * Force landscape A4 for print (the 12-column table is wide).
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  paid_n: number;
  on_risk_nyp_n: number;
  in_processing_n: number;
  not_yet_submitted_n: number;
  cancelled_n: number;
  total_n: number;
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
  // Multi-select since Poz 2 Sep 2026: Guy wants any combination of
  // quarters (Q1, Q1+Q2, ...) on one printout. Data is fetched at year
  // scope and filtered to the selected quarters client-side.
  const [quarters, setQuarters] = useState<Set<number>>(
    () => new Set([Math.ceil((now.getMonth() + 1) / 3)]),
  );
  const [week, setWeek] = useState<number>(1);
  // We track which advisers are EXCLUDED (deselected) rather than which are
  // selected, so on first paint every pill renders as visually active without
  // having to wait for the advisers list to arrive from the server. Empty
  // excluded list = show every adviser, which is the default Pauline wants.
  const [excludedAdvisers, setExcludedAdvisers] = useState<number[]>([]);

  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // We need data.allAdvisers inside the qs memo to translate the excluded
  // list back into an include list for the API, but we don't want data
  // changing to recompute qs (which would cascade into a refetch). Keep a
  // ref so the memo can read the latest without depending on it.
  const allAdvisersRef = useRef<Adviser[]>([]);
  useEffect(() => {
    if (data) allAdvisersRef.current = data.allAdvisers;
  }, [data]);

  // Landscape print for this page only. headline-print-mode powers the
  // "Print headline" button (Poz 2 Sep 2026): totals, per-adviser
  // summary and quarter subtotals only -- the week-by-week blocks hide.
  useEffect(() => {
    const style = document.createElement("style");
    style.setAttribute("data-bizt-print", "1");
    style.textContent = [
      "@media print { @page { size: A4 landscape; margin: 8mm; } }",
      "@media print { .headline-print-mode .week-print-block { display: none !important; } }",
    ].join("\n");
    document.head.appendChild(style);
    return () => { style.remove(); };
  }, []);

  const [headlinePrint, setHeadlinePrint] = useState(false);
  useEffect(() => {
    if (!headlinePrint) return;
    const done = () => setHeadlinePrint(false);
    window.addEventListener("afterprint", done);
    const t = setTimeout(() => window.print(), 50);
    return () => { clearTimeout(t); window.removeEventListener("afterprint", done); };
  }, [headlinePrint]);

  const qs = useMemo(() => {
    const p = new URLSearchParams();
    p.set("year", String(year));
    // Quarter view fetches the full year and filters client-side so any
    // combination of quarters can be shown/printed together.
    p.set("scope", kind === "quarter" ? "year" : kind);
    if (kind === "month")   p.set("month", String(month));
    if (kind === "week")    p.set("week",  String(week));
    // Compute "selected" = all known advisers minus the excluded set. Only
    // send the param when the user has actually excluded something; empty
    // excluded list is semantically identical to "no filter" so we omit it.
    if (excludedAdvisers.length > 0 && allAdvisersRef.current.length > 0) {
      const shown = allAdvisersRef.current
        .filter((a) => !excludedAdvisers.includes(a.id))
        .map((a) => a.id);
      if (shown.length > 0) p.set("advisers", shown.join(","));
    }
    return p.toString();
  }, [year, kind, month, week, excludedAdvisers]);

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
    if (kind === "quarter") {
      const qs = Array.from(quarters).sort();
      return `${qs.map((q) => `Q${q}`).join(" + ")} ${year}`;
    }
    if (kind === "month")   return `${MONTH_NAMES[month - 1]} ${year}`;
    return `Week ${week} ${year}`;
  }, [kind, year, month, quarters, week]);

  const toggleQuarter = (q: number) =>
    setQuarters((prev) => {
      const next = new Set(prev);
      if (next.has(q)) { if (next.size > 1) next.delete(q); } else next.add(q);
      return next;
    });

  const toggleAdviser = (id: number) =>
    setExcludedAdvisers((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  return (
    <div className={`min-h-screen bg-slate-50 text-slate-900${headlinePrint ? " headline-print-mode" : ""}`}>
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
              <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white text-xs">
                {[1, 2, 3, 4].map((q) => (
                  <button key={q} type="button" onClick={() => toggleQuarter(q)}
                    title="Toggle quarter (combine as many as you like)"
                    className={`px-2 py-1 ${quarters.has(q) ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                    Q{q}
                  </button>
                ))}
              </div>
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
            <a href="/reci/tracker/seller"
              className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-800 hover:bg-indigo-100">
              Seller trends
            </a>
            <a href="/reci/confirmations"
              className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-800 hover:bg-emerald-100">
              Confirmation Planner
            </a>
            <PrintButton />
            <PrintButton label="Print headline" onClick={() => setHeadlinePrint(true)} />
          </div>
        </div>

        {/* Adviser multi-select filter */}
        {data && data.allAdvisers.length > 0 && (
          <div className="mx-auto flex max-w-[1800px] flex-wrap items-center gap-2 px-4 pb-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-500">Advisers</span>
            {data.allAdvisers.map((a) => {
              const active = !excludedAdvisers.includes(a.id);
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
            {excludedAdvisers.length > 0 && (
              <button
                type="button"
                onClick={() => setExcludedAdvisers([])}
                className="text-xs text-slate-500 hover:text-slate-900 underline ml-1"
              >
                Show all
              </button>
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

        {!data ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">
            {loading ? "Loading…" : "Loading…"}
          </div>
        ) : <PivotedView data={data} quarterFilter={kind === "quarter" ? quarters : null} />}
      </main>
    </div>
  );
}

// Pivot the data: for each week in scope, build a row per adviser plus a week
// total. Skip weeks with zero overall activity. Group consecutive weeks into
// quarters (Q1-Q4) and insert a quarter subtotal block after each quarter
// when more than one quarter has data in scope. Finally a per-adviser scope
// totals block (so Pauline can see Tan's YTD, Hayder's YTD, etc. all in one
// spot) and the overall grand total card.
function PivotedView({ data, quarterFilter }: { data: Resp; quarterFilter: Set<number> | null }) {
  const sumRows = (a: BizWeekRow, b: BizWeekRow, week: number): BizWeekRow => ({
    week,
    paid:              a.paid + b.paid,
    on_risk_nyp:       a.on_risk_nyp + b.on_risk_nyp,
    in_processing:     a.in_processing + b.in_processing,
    not_yet_submitted: a.not_yet_submitted + b.not_yet_submitted,
    cancelled:         a.cancelled + b.cancelled,
    total:             a.total + b.total,
    paid_n:              a.paid_n + b.paid_n,
    on_risk_nyp_n:       a.on_risk_nyp_n + b.on_risk_nyp_n,
    in_processing_n:     a.in_processing_n + b.in_processing_n,
    not_yet_submitted_n: a.not_yet_submitted_n + b.not_yet_submitted_n,
    cancelled_n:         a.cancelled_n + b.cancelled_n,
    total_n:             a.total_n + b.total_n,
  });

  // Build the per-week sections. When a quarter multi-select is active
  // (Poz 2 Sep 2026) only the chosen quarters' weeks survive, and every
  // total below is computed from what's shown so the printout stands on
  // its own.
  const sections = data.weeksInScope.map((week) => {
    const rows = data.advisers.map((a) => {
      const row = a.weeks.find((w) => w.week === week) ?? emptyRow(week);
      return { adviser_id: a.adviser_id, adviser_name: a.adviser_name, row };
    });
    const weekTotal = rows.reduce(
      (acc, { row }) => sumRows(acc, row, week),
      emptyRow(week),
    );
    return { week, rows, weekTotal };
  }).filter((s) => s.weekTotal.total > 0)
    .filter((s) => !quarterFilter || quarterFilter.has(quarterFromWeek(data.year, s.week)));

  // Per-adviser totals across the DISPLAYED weeks (the API's own totals
  // cover its full scope, which is the whole year when quarter-filtering).
  const adviserTotals = data.advisers
    .map((a) => ({
      adviser_id: a.adviser_id,
      adviser_name: a.adviser_name,
      total: sections.reduce((acc, s) => {
        const r = s.rows.find((x) => x.adviser_id === a.adviser_id)?.row ?? emptyRow(0);
        return sumRows(acc, r, 0);
      }, emptyRow(0)),
    }))
    .filter((a) => a.total.total > 0);

  // Overall scope total (across every week shown).
  const grand = sections.reduce(
    (acc, s) => sumRows(acc, s.weekTotal, 0),
    emptyRow(0),
  );

  // Group sections by calendar quarter.
  const sectionsByQuarter = new Map<number, typeof sections>();
  for (const s of sections) {
    const q = quarterFromWeek(data.year, s.week);
    const arr = sectionsByQuarter.get(q) ?? [];
    arr.push(s);
    sectionsByQuarter.set(q, arr);
  }
  // Reverse order since Poz 6 Aug: newest quarter first, newest week first
  // inside it, with all the totals blocks ABOVE the weeks so Guy lands on
  // the overall position instead of scrolling to it.
  const quarterEntries = Array.from(sectionsByQuarter.entries()).sort((a, b) => b[0] - a[0]);
  const showQuarterSubtotals = quarterEntries.length > 1 || quarterFilter !== null;
  const showAdviserTotals    = data.advisers.length > 1;
  const weeksWithData = sections.length;

  if (sections.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">
        No deals in current scope.
      </div>
    );
  }

  return (
    <>
      <section className="rounded-lg border bg-slate-900 text-white shadow-sm print-keep">
        <div className="border-b border-slate-700 px-3 py-2 text-sm font-bold uppercase tracking-wide">
          Overall total
        </div>
        <div className="overflow-x-auto">
          <table className="w-full table-fixed border-collapse text-xs">
            <ColGroup />
            <tbody>
              <Row label="OVERALL" row={grand} kind="grand" />
              <Row label={`Avg/week (${weeksWithData} wks)`} row={averageOf(grand, weeksWithData)} kind="grandAvg" />
            </tbody>
          </table>
        </div>
      </section>

      {showAdviserTotals && (
        <AdviserTotalsBlock advisers={adviserTotals} weeksWithData={weeksWithData} />
      )}

      {quarterEntries.map(([q, qSections]) => (
        <Fragment key={q}>
          {showQuarterSubtotals && (
            <QuarterBlock q={q} sections={qSections} advisers={data.advisers} sumRows={sumRows} />
          )}
          {qSections.slice().sort((a, b) => b.week - a.week).map((s) => (
            <WeekBlock key={s.week} week={s.week} rows={s.rows} weekTotal={s.weekTotal} />
          ))}
        </Fragment>
      ))}
    </>
  );
}

/**
 * Quarter (1-4) for a given week number, using straight 13-week bins:
 *   Q1 = weeks 1-13, Q2 = 14-26, Q3 = 27-39, Q4 = 40-53.
 *
 * We deliberately don't use the ISO-week-to-calendar-month mapping because
 * ISO Week 1 of a year often has its Monday in late December of the previous
 * year (e.g. 2026 Week 1 Monday = Dec 29 2025), which would push Week 1 into
 * Q4 -- not what Pauline expects on the report. The straight-bin convention
 * matches her existing Business Tracker.
 */
function quarterFromWeek(_year: number, week: number): number {
  if (week <= 13) return 1;
  if (week <= 26) return 2;
  if (week <= 39) return 3;
  return 4;
}

function QuarterBlock({ q, sections, advisers, sumRows }: {
  q: number;
  sections: { week: number; rows: { adviser_id: number; adviser_name: string; row: BizWeekRow }[]; weekTotal: BizWeekRow }[];
  advisers: BizAdviserRollup[];
  sumRows: (a: BizWeekRow, b: BizWeekRow, week: number) => BizWeekRow;
}) {
  const advRows = advisers.map((a) => {
    const total = sections.reduce((acc, s) => {
      const r = s.rows.find((x) => x.adviser_id === a.adviser_id)?.row ?? emptyRow(0);
      return sumRows(acc, r, 0);
    }, emptyRow(0));
    return { adviser_id: a.adviser_id, adviser_name: a.adviser_name, row: total };
  });
  const qTotal = advRows.reduce((acc, r) => sumRows(acc, r.row, 0), emptyRow(0));

  return (
    <section className="rounded-lg border-2 border-amber-300 bg-white shadow-sm print-keep">
      <h2 className="border-b-2 border-amber-300 bg-amber-100 px-3 py-2 text-sm font-bold uppercase tracking-wide text-amber-900">
        Q{q} subtotal
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <ColGroup />
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left">Agent</th>
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
            {advRows.map((r) => (
              <Row key={r.adviser_id} label={r.adviser_name} row={r.row} kind="adviser" />
            ))}
            <Row label={`Q${q} total`} row={qTotal} kind="weekTotal" />
            <Row label={`Avg/week (${sections.length} wks)`} row={averageOf(qTotal, sections.length)} kind="avg" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function AdviserTotalsBlock({ advisers, weeksWithData }: {
  advisers: { adviser_id: number; adviser_name: string; total: BizWeekRow }[];
  weeksWithData: number;
}) {
  return (
    <section className="rounded-lg border-2 border-slate-400 bg-white shadow-sm print-keep">
      <h2 className="border-b-2 border-slate-400 bg-slate-200 px-3 py-2 text-sm font-bold uppercase tracking-wide text-slate-800">
        Per-adviser scope totals
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <ColGroup />
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left">Agent</th>
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
            {advisers.map((a) => (
              <Fragment key={a.adviser_id}>
                <Row label={a.adviser_name} row={a.total} kind="adviser" />
                <Row label="Avg/week" row={averageOf(a.total, weeksWithData)} kind="avg" />
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function WeekBlock({ week, rows, weekTotal }: {
  week: number;
  rows: { adviser_id: number; adviser_name: string; row: BizWeekRow }[];
  weekTotal: BizWeekRow;
}) {
  return (
    <section className="week-print-block rounded-lg border bg-white shadow-sm print-keep">
      <h2 className="border-b bg-slate-100 px-3 py-2 text-sm font-semibold text-slate-800">
        Week {week}
      </h2>
      <div className="overflow-x-auto">
        <table className="w-full table-fixed border-collapse text-xs">
          <ColGroup />
          <thead>
            <tr className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <th className="border-b border-r border-slate-200 px-2 py-1 text-left">Agent</th>
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
            {rows.map((r) => (
              <Row key={r.adviser_id} label={r.adviser_name} row={r.row} kind="adviser" />
            ))}
            <Row label={`Week ${week} total`} row={weekTotal} kind="weekTotal" />
          </tbody>
        </table>
      </div>
    </section>
  );
}

function ColGroup() {
  return (
    <colgroup>
      <col style={{ width: "7rem"   }} />     {/* Label (agent name / week total) */}
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
  );
}

function emptyRow(week: number): BizWeekRow {
  return {
    week, paid: 0, on_risk_nyp: 0, in_processing: 0, not_yet_submitted: 0, cancelled: 0, total: 0,
    paid_n: 0, on_risk_nyp_n: 0, in_processing_n: 0, not_yet_submitted_n: 0, cancelled_n: 0, total_n: 0,
  };
}

/** Divide every £ and count in a row by `div` for the weekly-average rows. */
function averageOf(row: BizWeekRow, div: number): BizWeekRow {
  const d = div > 0 ? div : 1;
  return {
    week: 0,
    paid: row.paid / d, on_risk_nyp: row.on_risk_nyp / d,
    in_processing: row.in_processing / d, not_yet_submitted: row.not_yet_submitted / d,
    cancelled: row.cancelled / d, total: row.total / d,
    paid_n: row.paid_n / d, on_risk_nyp_n: row.on_risk_nyp_n / d,
    in_processing_n: row.in_processing_n / d, not_yet_submitted_n: row.not_yet_submitted_n / d,
    cancelled_n: row.cancelled_n / d, total_n: row.total_n / d,
  };
}

/** Count formatter: whole numbers normally, 1 decimal on average rows. */
function fmtCount(n: number, isAvg: boolean): string {
  if (isAvg) return (Math.round(n * 10) / 10).toFixed(1);
  return String(Math.round(n));
}

function Row({ row, label, kind }: {
  row: BizWeekRow;
  label: string;
  kind: "adviser" | "weekTotal" | "grand" | "avg" | "grandAvg";
}) {
  const bg =
    kind === "grand"     ? "bg-slate-900 text-white text-sm font-bold" :
    kind === "grandAvg"  ? "bg-slate-800 text-slate-300 text-[11px]" :
    kind === "weekTotal" ? "bg-amber-50 font-semibold" :
    kind === "avg"       ? "bg-slate-50 text-slate-500 text-[11px]" :
    "";
  const labelClass =
    kind === "grand"     ? "uppercase tracking-wide" :
    kind === "grandAvg"  ? "uppercase tracking-wide text-[10px]" :
    kind === "weekTotal" ? "uppercase tracking-wide text-amber-800 text-[11px]" :
    kind === "avg"       ? "uppercase tracking-wide text-[10px]" :
    "font-medium text-slate-700";
  const cellBorder =
    kind === "grand" || kind === "grandAvg" ? "border-slate-700" :
    kind === "weekTotal" ? "border-amber-200" :
    "border-slate-100";
  const isData = kind === "adviser";
  const isAvg  = kind === "avg" || kind === "grandAvg";
  const dim = (n: number) => (isData && n === 0 ? "text-slate-300" : "");
  const countClass =
    kind === "grand" || kind === "grandAvg" ? "text-slate-400" : "text-slate-400";

  // The five status columns + total, each rendered as £ with the deal
  // count underneath (Poz 6 Aug: "add the number of deals... it is
  // currently just a monetary value").
  const cells: { c: number; n: number }[] = [
    { c: row.paid,              n: row.paid_n },
    { c: row.on_risk_nyp,      n: row.on_risk_nyp_n },
    { c: row.in_processing,    n: row.in_processing_n },
    { c: row.not_yet_submitted, n: row.not_yet_submitted_n },
    { c: row.cancelled,        n: row.cancelled_n },
  ];

  return (
    <tr className={`${bg} print-keep`}>
      <td className={`border-b border-r ${cellBorder} px-2 py-1 whitespace-nowrap ${labelClass}`}>{label}</td>
      {cells.map((cell, i) => (
        <Fragment key={i}>
          <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${dim(cell.c)}`}>
            <div>{gbp(cell.c)}</div>
            {(cell.n > 0 || isAvg) && (
              <div className={`text-[10px] leading-tight ${countClass}`}>
                {fmtCount(cell.n, isAvg)} {Math.round(cell.n) === 1 && !isAvg ? "deal" : "deals"}
              </div>
            )}
          </td>
          <td className={`border-b border-r ${cellBorder} px-2 py-1 text-right tabular-nums ${dim(cell.c)}`}>
            {pct(cell.c, row.total)}
          </td>
        </Fragment>
      ))}
      <td className={`border-b ${cellBorder} px-2 py-1 text-right tabular-nums ${kind === "adviser" ? "font-medium" : ""}`}>
        <div>{gbp(row.total)}</div>
        {(row.total_n > 0 || isAvg) && (
          <div className={`text-[10px] leading-tight font-normal ${countClass}`}>
            {fmtCount(row.total_n, isAvg)} {Math.round(row.total_n) === 1 && !isAvg ? "deal" : "deals"}
          </div>
        )}
      </td>
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
