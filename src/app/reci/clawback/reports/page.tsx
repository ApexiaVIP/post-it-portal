"use client";

/**
 * Clawback Reports
 *
 * Per-seller Gross Issued CB / Saved CB / Net Position roll-ups across
 * Weekly / Monthly / Quarterly / Half-yearly / Annual scopes. Monthly
 * defaults to calendar months (1st to last). Built for Guy and Poz.
 *
 * Layout: scope toggle at the top, then one section per period (Jan 2026,
 * Feb 2026, ...). Each section has a seller-rows table with three money
 * columns + a case count. A scope-wide overall block sits at the bottom.
 *
 * Print button renders cleanly landscape; the PrintHeader strip carries
 * the scope + year so a stack of paper printouts is identifiable.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PrintButton, PrintHeader } from "@/components/print";

interface SummaryResp {
  scoped: boolean;
  onBooks:  { amount: number; cases: number };
  netExposure: number;
  lost:     { amount: number; cases: number };
  resolved: { amount: number; cases: number; savedAmount: number; resoldAmount: number; reinstatedCases: number };
  urgent:   { amount: number; cases: number };
  pending:  { amount: number; cases: number };
  active:   { amount: number; cases: number };
}

type Scope = "week" | "month" | "quarter" | "half" | "year";

interface BucketRow {
  key: string;
  adviser_id: number | null;
  gross: number;
  saved: number;
  resold: number;
  net: number;
  cases: number;
}

interface PeriodBlock {
  key: string;
  label: string;
  start: string;
  end: string;
  buckets: BucketRow[];
}

interface ReportResp {
  scope: Scope;
  year: number;
  periods: PeriodBlock[];
  overall: BucketRow[];
}

const SCOPE_LABELS: Record<Scope, string> = {
  week:    "Weekly",
  month:   "Monthly",
  quarter: "Quarterly",
  half:    "Half-yearly",
  year:    "Annual",
};

function gbp(n: number): string {
  return n.toLocaleString("en-GB", {
    style: "currency", currency: "GBP",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export default function ClawbackReportsPage() {
  const [scope, setScope] = useState<Scope>("month");
  const [year, setYear]   = useState<number>(new Date().getUTCFullYear());
  const [data, setData]   = useState<ReportResp | null>(null);
  const [summary, setSummary] = useState<SummaryResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const p = new URLSearchParams({ scope, year: String(year) });
      const [r, s] = await Promise.all([
        fetch(`/api/reci/clawback/reports?${p.toString()}`, { cache: "no-store" }),
        fetch(`/api/reci/clawback/summary`, { cache: "no-store" }),
      ]);
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      const j = await r.json();
      setData(j);
      if (s.ok) setSummary(await s.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [scope, year]);

  useEffect(() => { void load(); }, [load]);

  // Overall scope totals (across periods + sellers) for the foot.
  const overallTotals = data?.overall.reduce(
    (acc, b) => ({
      gross:  acc.gross  + b.gross,
      saved:  acc.saved  + b.saved,
      resold: acc.resold + b.resold,
      net:    acc.net    + b.net,
      cases:  acc.cases  + b.cases,
    }),
    { gross: 0, saved: 0, resold: 0, net: 0, cases: 0 },
  ) || { gross: 0, saved: 0, resold: 0, net: 0, cases: 0 };

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
      <PrintHeader
        title="Clawback Reports"
        subtitle={`${SCOPE_LABELS[scope]} · ${year}`}
        meta={[
          { label: "Scope",       value: SCOPE_LABELS[scope] },
          { label: "Year",        value: String(year) },
          { label: "Cases",       value: String(overallTotals.cases) },
          { label: "Gross issued", value: gbp(overallTotals.gross) },
          { label: "Saved",        value: gbp(overallTotals.saved) },
          { label: "Net",          value: gbp(overallTotals.net) },
        ]}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Clawback Reports</h1>
          <div className="text-sm text-slate-600">
            Per-seller Gross Issued / Saved / Net positions, grouped by CB date.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <PrintButton />
        </div>
      </div>

      {/* Executive summary tiles. Click any tile to drop into the
          dashboard with the matching filter pre-applied. */}
      {summary && (
        <section className="mt-4">
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
            Executive summary{summary.scoped ? " (scoped to your cases)" : ""}
          </h2>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
            <SummaryTile
              label="On the books"
              amount={summary.onBooks.amount}
              cases={summary.onBooks.cases}
              accent="slate"
              href="/reci/clawback"
              sub={`Net exposure: ${gbp(summary.netExposure)}`}
            />
            <SummaryTile
              label="Urgent"
              amount={summary.urgent.amount}
              cases={summary.urgent.cases}
              accent="red"
              href="/reci/clawback?source=new_ow&status=open"
              sub="New OW + still active"
            />
            <SummaryTile
              label="Pending action"
              amount={summary.pending.amount}
              cases={summary.pending.cases}
              accent="amber"
              href="/reci/clawback?status=open"
              sub="Open, no action yet"
            />
            <SummaryTile
              label="Actively being worked"
              amount={summary.active.amount}
              cases={summary.active.cases}
              accent="blue"
              href="/reci/clawback?status=open"
              sub="Open, someone's on it"
            />
            <SummaryTile
              label="Resolved"
              amount={summary.resolved.amount}
              cases={summary.resolved.cases}
              accent="green"
              href="/reci/clawback?status=saved"
              sub={`Saved ${gbp(summary.resolved.savedAmount)} · Resold ${gbp(summary.resolved.resoldAmount)}`}
            />
            <SummaryTile
              label="Lost"
              amount={summary.lost.amount}
              cases={summary.lost.cases}
              accent="rose"
              href="/reci/clawback?status=dead"
              sub="Clawback went through"
            />
          </div>
        </section>
      )}

      {/* Controls */}
      <section className="no-print mt-4 flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white p-2">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Scope</span>
        <div className="inline-flex rounded border border-slate-300 bg-white">
          {(Object.keys(SCOPE_LABELS) as Scope[]).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setScope(s)}
              className={`px-3 py-1 text-sm ${
                scope === s ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"
              }`}
            >
              {SCOPE_LABELS[s]}
            </button>
          ))}
        </div>
        <label className="ml-3 flex items-center gap-2">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Year</span>
          <input
            type="number"
            min={2020} max={2099}
            value={year}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n)) setYear(n);
            }}
            className="w-24 rounded border border-slate-300 px-2 py-1 text-sm"
          />
        </label>
      </section>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Failed to load: {error}
        </div>
      )}

      {/* Per-period sections */}
      {loading ? (
        <div className="mt-6 text-center text-slate-400">Loading...</div>
      ) : !data || data.periods.length === 0 ? (
        <div className="mt-6 text-center text-slate-400">No cases match.</div>
      ) : (
        <>
          {data.periods.map((p) => (
            <PeriodSection key={p.key} period={p} />
          ))}

          {/* Overall scope roll-up */}
          {data.overall.length > 0 && (
            <section className="mt-8 rounded border-2 border-slate-300 bg-slate-50">
              <div className="border-b border-slate-300 bg-slate-100 px-4 py-2 text-sm font-semibold uppercase tracking-wide text-slate-700">
                Overall {SCOPE_LABELS[scope]} ({year})
              </div>
              <SellerTable rows={data.overall} totals={overallTotals} />
            </section>
          )}
        </>
      )}
    </main>
  );
}

function PeriodSection({ period }: { period: PeriodBlock }) {
  const totals = period.buckets.reduce(
    (acc, b) => ({
      gross:  acc.gross  + b.gross,
      saved:  acc.saved  + b.saved,
      resold: acc.resold + b.resold,
      net:    acc.net    + b.net,
      cases:  acc.cases  + b.cases,
    }),
    { gross: 0, saved: 0, resold: 0, net: 0, cases: 0 },
  );
  return (
    <section className="mt-4 break-inside-avoid rounded border border-slate-200 bg-white">
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h2 className="text-sm font-semibold">{period.label}</h2>
        {period.start && period.end && (
          <span className="text-xs text-slate-500">{period.start} → {period.end}</span>
        )}
      </div>
      <SellerTable rows={period.buckets} totals={totals} />
    </section>
  );
}

function SellerTable({ rows, totals }: {
  rows: BucketRow[];
  totals: { gross: number; saved: number; resold: number; net: number; cases: number };
}) {
  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
        <tr>
          <th className="px-3 py-2 text-left font-medium">Seller</th>
          <th className="px-3 py-2 text-right font-medium">Cases</th>
          <th className="px-3 py-2 text-right font-medium">Gross issued £</th>
          <th className="px-3 py-2 text-right font-medium">Saved £</th>
          <th className="px-3 py-2 text-right font-medium">Resold £</th>
          <th className="px-3 py-2 text-right font-medium">Net at risk £</th>
        </tr>
      </thead>
      <tbody>
        {rows.length === 0 ? (
          <tr><td className="px-3 py-3 text-center text-slate-400" colSpan={6}>No cases.</td></tr>
        ) : rows.map((b) => (
          <tr key={b.key} className="border-t border-slate-100">
            <td className="px-3 py-2 font-medium">{b.key}</td>
            <td className="px-3 py-2 text-right">{b.cases}</td>
            <td className="px-3 py-2 text-right">{gbp(b.gross)}</td>
            <td className="px-3 py-2 text-right text-emerald-700">{b.saved > 0 ? gbp(b.saved) : "—"}</td>
            <td className="px-3 py-2 text-right text-blue-700">{b.resold > 0 ? gbp(b.resold) : "—"}</td>
            <td className="px-3 py-2 text-right font-medium">{gbp(b.net)}</td>
          </tr>
        ))}
        <tr className="border-t-2 border-slate-300 bg-amber-50 font-semibold">
          <td className="px-3 py-2">Total</td>
          <td className="px-3 py-2 text-right">{totals.cases}</td>
          <td className="px-3 py-2 text-right">{gbp(totals.gross)}</td>
          <td className="px-3 py-2 text-right text-emerald-700">{gbp(totals.saved)}</td>
          <td className="px-3 py-2 text-right text-blue-700">{gbp(totals.resold)}</td>
          <td className="px-3 py-2 text-right">{gbp(totals.net)}</td>
        </tr>
      </tbody>
    </table>
  );
}

type TileAccent = "slate" | "red" | "amber" | "blue" | "green" | "rose";

const ACCENT_CLASSES: Record<TileAccent, string> = {
  slate: "border-slate-300 bg-white hover:bg-slate-50",
  red:   "border-red-300 bg-red-50 hover:bg-red-100",
  amber: "border-amber-300 bg-amber-50 hover:bg-amber-100",
  blue:  "border-blue-300 bg-blue-50 hover:bg-blue-100",
  green: "border-emerald-300 bg-emerald-50 hover:bg-emerald-100",
  rose:  "border-rose-300 bg-rose-50 hover:bg-rose-100",
};

const ACCENT_LABEL: Record<TileAccent, string> = {
  slate: "text-slate-600",
  red:   "text-red-700",
  amber: "text-amber-700",
  blue:  "text-blue-700",
  green: "text-emerald-700",
  rose:  "text-rose-700",
};

function SummaryTile({ label, amount, cases, accent, href, sub }: {
  label: string;
  amount: number;
  cases: number;
  accent: TileAccent;
  href: string;
  sub?: string;
}) {
  return (
    <Link
      href={href}
      className={`block rounded border p-3 transition-colors ${ACCENT_CLASSES[accent]}`}
      title={`Click to drill into the dashboard (${cases} case${cases === 1 ? "" : "s"})`}
    >
      <div className={`text-xs font-semibold uppercase tracking-wide ${ACCENT_LABEL[accent]}`}>
        {label}
      </div>
      <div className="mt-1 text-xl font-semibold tabular-nums">{gbp(amount)}</div>
      <div className="text-xs text-slate-500">
        {cases.toLocaleString("en-GB")} case{cases === 1 ? "" : "s"}
      </div>
      {sub && <div className="mt-1 text-[11px] text-slate-500">{sub}</div>}
    </Link>
  );
}
