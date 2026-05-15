"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  PieChart, Pie, Cell, Tooltip as RTooltip, Legend, ResponsiveContainer,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  LineChart, Line,
} from "recharts";
import {
  DEAL_STATUSES, STATUS_LABELS, type DealStatus,
  CANCELLATION_REASONS, CANCELLATION_REASON_LABELS, type CancellationReason,
  type Deal,
} from "@/lib/reci/schema";
import { PrintButton, PrintHeader } from "@/components/print";
import { EditDealModal } from "@/components/deal-modal";

type AdviserLite = { id: number; name: string };
type Totals = {
  deals: number; commission: number; paidCommission: number;
  cancelledCount: number; cancelledPct: number;
};
type ByReasonRow = { reason: CancellationReason; label: string; count: number; commission: number };
type ByWeekStatusRow = { week: number; status: DealStatus; count: number; commission: number };
type ByAdviserRow = {
  adviser_id: number; adviser_name: string;
  count: number; commission: number; paidCommission: number; cancelled: number;
};
type TrendRow = { week: number; count: number; commission: number; paidCommission: number; cancellations: number };
type DealDetailRow = {
  id: number;
  adviser_id: number;
  adviser_name: string;
  adviser_slug: string;
  week: number;
  client: string;
  status: DealStatus;
  reason: CancellationReason | null;
  notes: string | null;
  commission: number;
  cancelled_at: string | null;
  cancelled_by: string | null;
  provider: string | null;
};

type AnalyticsResp = {
  filters: unknown;
  totals: Totals;
  byReason: ByReasonRow[];
  byWeekStatus: ByWeekStatusRow[];
  byAdviser: ByAdviserRow[];
  trend: TrendRow[];
  dealDetail: DealDetailRow[];
  advisers: AdviserLite[];
};

interface Filters {
  year: number;
  adviserIds: number[];      // [] means all
  statuses: DealStatus[];    // [] means all
  reasons: CancellationReason[]; // [] means all (only applies if cancelled in scope)
  weekFrom: number | null;
  weekTo: number | null;
}

const REASON_COLORS: Record<CancellationReason, string> = {
  npw:       "#dc2626", // red-600
  postponed: "#f59e0b", // amber-500
  declined:  "#ea580c", // orange-600
  other:     "#6b7280", // gray-500
};

const STATUS_COLORS: Record<DealStatus, string> = {
  not_yet_submitted: "#94a3b8", // slate-400
  in_processing:     "#3b82f6", // blue-500
  on_risk_nyp:       "#8b5cf6", // violet-500
  paid:              "#10b981", // emerald-500
  cancelled:         "#ef4444", // red-500
};

type LeagueMetric = "commission" | "count";
type TrendMetric  = "commission" | "paidCommission" | "count" | "cancellations";

const TREND_METRIC_LABELS: Record<TrendMetric, string> = {
  commission:     "Commission £",
  paidCommission: "Paid Commission £",
  count:          "Deals",
  cancellations:  "Cancellations",
};

function gbp(n: number): string {
  return Number(n || 0).toLocaleString("en-GB", {
    style: "currency", currency: "GBP", minimumFractionDigits: 0, maximumFractionDigits: 0,
  });
}

function filtersToQuery(f: Filters): string {
  const p = new URLSearchParams();
  p.set("year", String(f.year));
  if (f.adviserIds.length) p.set("advisers", f.adviserIds.join(","));
  if (f.statuses.length)   p.set("statuses", f.statuses.join(","));
  if (f.reasons.length)    p.set("reasons", f.reasons.join(","));
  if (f.weekFrom != null)  p.set("weekFrom", String(f.weekFrom));
  if (f.weekTo != null)    p.set("weekTo", String(f.weekTo));
  return p.toString();
}

const DEFAULT_FILTERS = (): Filters => ({
  year: new Date().getFullYear(),
  adviserIds: [],
  statuses: [],
  reasons: [],
  weekFrom: null,
  weekTo: null,
});

// --- Saved views (localStorage) --------------------------------------------
const SAVED_VIEWS_KEY = "reci.analytics.savedViews.v1";

interface SavedView { name: string; filters: Filters }

function loadSavedViews(): SavedView[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(SAVED_VIEWS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as SavedView[]) : [];
  } catch {
    return [];
  }
}

function persistSavedViews(views: SavedView[]) {
  try { window.localStorage.setItem(SAVED_VIEWS_KEY, JSON.stringify(views)); } catch {}
}

export default function AnalyticsPage() {
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS());
  // In-place edit: when a row is clicked we fetch the full deal and feed it
  // straight into the EditDealModal on this page (no navigation away).
  const [editingDeal, setEditingDeal] = useState<Deal | null>(null);
  const [opening, setOpening] = useState<number | null>(null);

  async function openDealForEdit(id: number) {
    setOpening(id);
    try {
      const r = await fetch(`/api/reci/deals/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { deal: Deal };
      setEditingDeal(j.deal);
    } catch {
      // swallow — if it fails the row simply doesn't open
    } finally {
      setOpening(null);
    }
  }
  const [data, setData] = useState<AnalyticsResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const cancelledInScope = filters.statuses.length === 0 || filters.statuses.includes("cancelled");

  const load = useCallback(async (signal: AbortSignal) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/reci/analytics?${filtersToQuery(filters)}`, { signal, cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as AnalyticsResp;
      setData(j);
    } catch (e) {
      if ((e as { name?: string })?.name === "AbortError") return;
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    const ctrl = new AbortController();
    load(ctrl.signal);
    return () => ctrl.abort();
  }, [load]);

  const toggleInArray = <T,>(arr: T[], v: T): T[] =>
    arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v];

  const setAdviser   = (id: number) => setFilters((f) => ({ ...f, adviserIds: toggleInArray(f.adviserIds, id) }));
  const setStatus    = (s: DealStatus) => setFilters((f) => ({ ...f, statuses: toggleInArray(f.statuses, s) }));
  const setReason    = (r: CancellationReason) => setFilters((f) => ({ ...f, reasons: toggleInArray(f.reasons, r) }));
  const setWeekFrom  = (v: string) => setFilters((f) => ({ ...f, weekFrom: v ? Number(v) : null }));
  const setWeekTo    = (v: string) => setFilters((f) => ({ ...f, weekTo: v ? Number(v) : null }));
  const setYear      = (v: string) => setFilters((f) => ({ ...f, year: Number(v) || new Date().getFullYear() }));
  const reset        = () => setFilters(DEFAULT_FILTERS());

  const [leagueMetric, setLeagueMetric] = useState<LeagueMetric>("commission");
  const [trendMetric,  setTrendMetric]  = useState<TrendMetric>("cancellations");

  const [savedViews, setSavedViews] = useState<SavedView[]>([]);
  const [selectedViewName, setSelectedViewName] = useState<string>("");
  useEffect(() => { setSavedViews(loadSavedViews()); }, []);

  const saveCurrentView = () => {
    const name = (window.prompt("Name this view:") ?? "").trim();
    if (!name) return;
    const next = [...savedViews.filter((v) => v.name !== name), { name, filters }];
    setSavedViews(next);
    persistSavedViews(next);
    setSelectedViewName(name);
  };

  const loadView = (name: string) => {
    setSelectedViewName(name);
    if (!name) return;
    const v = savedViews.find((x) => x.name === name);
    if (v) setFilters(v.filters);
  };

  const deleteSelectedView = () => {
    if (!selectedViewName) return;
    if (!window.confirm(`Delete view "${selectedViewName}"?`)) return;
    const next = savedViews.filter((v) => v.name !== selectedViewName);
    setSavedViews(next);
    persistSavedViews(next);
    setSelectedViewName("");
  };

  const reasonPieData = useMemo(
    () => (data?.byReason ?? []).filter((r) => r.count > 0),
    [data],
  );

  // Wide-format weekly stack: [{ week, paid, on_risk_nyp, ... }]
  const weekStackData = useMemo(() => {
    const map = new Map<number, Record<string, number> & { week: number }>();
    for (const r of data?.byWeekStatus ?? []) {
      const w = map.get(r.week) ?? { week: r.week } as Record<string, number> & { week: number };
      w[r.status] = (w[r.status] ?? 0) + r.count;
      map.set(r.week, w);
    }
    return Array.from(map.values()).sort((a, b) => a.week - b.week);
  }, [data]);

  const leagueData = useMemo(() => {
    const rows = (data?.byAdviser ?? []).slice();
    rows.sort((a, b) => (leagueMetric === "commission"
      ? b.commission - a.commission
      : b.count - a.count));
    return rows;
  }, [data, leagueMetric]);

  // Build the print-only header summary so a paper printout is identifiable
  // without the on-screen filter chrome.
  const printMeta = useMemo(() => {
    const advNames = filters.adviserIds.length
      ? (data?.advisers ?? [])
          .filter((a) => filters.adviserIds.includes(a.id))
          .map((a) => a.name)
          .join(", ") || "All"
      : "All";
    const statusNames = filters.statuses.length
      ? filters.statuses.map((s) => STATUS_LABELS[s]).join(", ")
      : "All";
    const reasonNames = filters.reasons.length
      ? filters.reasons.map((r) => CANCELLATION_REASON_LABELS[r]).join(", ")
      : (cancelledInScope ? "All" : "n/a");
    const weekRange =
      filters.weekFrom != null || filters.weekTo != null
        ? `${filters.weekFrom ?? 1} to ${filters.weekTo ?? 53}`
        : "All weeks";
    return [
      { label: "Year",     value: String(filters.year) },
      { label: "Advisers", value: advNames },
      { label: "Status",   value: statusNames },
      { label: "Reason",   value: reasonNames },
      { label: "Weeks",    value: weekRange },
    ];
  }, [filters, data, cancelledInScope]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">RECI Analytics</h1>
          </div>
          <div className="flex items-center gap-2 text-sm">
            <label className="text-slate-600">Year</label>
            <input
              type="number"
              value={filters.year}
              onChange={(e) => setYear(e.target.value)}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-right"
            />
            <PrintButton />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl space-y-6 px-4 py-6">
        <PrintHeader title="RECI Analytics" meta={printMeta} />
        {/* Filter bar */}
        <section className="no-print rounded-lg border bg-white p-4 shadow-sm">
          <div className="grid gap-4 md:grid-cols-4">
            <FilterGroup label="Adviser">
              {data?.advisers?.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {data.advisers.map((a) => (
                    <Pill
                      key={a.id}
                      active={filters.adviserIds.includes(a.id)}
                      onClick={() => setAdviser(a.id)}
                    >
                      {a.name}
                    </Pill>
                  ))}
                </div>
              ) : <span className="text-xs text-slate-400">…</span>}
            </FilterGroup>

            <FilterGroup label="Status">
              <div className="flex flex-wrap gap-1.5">
                {DEAL_STATUSES.map((s) => (
                  <Pill
                    key={s}
                    active={filters.statuses.includes(s)}
                    onClick={() => setStatus(s)}
                  >
                    {STATUS_LABELS[s]}
                  </Pill>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup
              label="Cancel Reason"
              hint={cancelledInScope ? undefined : "Select 'Cancelled' status to enable"}
            >
              <div className="flex flex-wrap gap-1.5">
                {CANCELLATION_REASONS.map((r) => (
                  <Pill
                    key={r}
                    active={filters.reasons.includes(r)}
                    onClick={() => setReason(r)}
                    disabled={!cancelledInScope}
                    color={REASON_COLORS[r]}
                  >
                    {CANCELLATION_REASON_LABELS[r]}
                  </Pill>
                ))}
              </div>
            </FilterGroup>

            <FilterGroup label="Weeks">
              <div className="flex items-center gap-2 text-sm">
                <input
                  type="number" min={1} max={53} placeholder="from"
                  value={filters.weekFrom ?? ""}
                  onChange={(e) => setWeekFrom(e.target.value)}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right"
                />
                <span className="text-slate-400">–</span>
                <input
                  type="number" min={1} max={53} placeholder="to"
                  value={filters.weekTo ?? ""}
                  onChange={(e) => setWeekTo(e.target.value)}
                  className="w-16 rounded border border-slate-300 px-2 py-1 text-right"
                />
              </div>
            </FilterGroup>
          </div>

          {/* Saved views + reset */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-500">Saved views</span>
            <select
              value={selectedViewName}
              onChange={(e) => loadView(e.target.value)}
              className="rounded border border-slate-300 bg-white px-2 py-1"
            >
              <option value="">(select a view)</option>
              {savedViews.map((v) => (
                <option key={v.name} value={v.name}>{v.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveCurrentView}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              Save current…
            </button>
            <button
              type="button"
              onClick={deleteSelectedView}
              disabled={!selectedViewName}
              className="rounded border border-slate-300 bg-white px-2 py-1 text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:text-slate-300"
            >
              Delete
            </button>
            <button
              type="button"
              onClick={reset}
              className="ml-auto rounded border border-slate-300 bg-white px-2 py-1 text-slate-600 hover:bg-slate-50"
            >
              Reset filters
            </button>
          </div>

          <div className="mt-2 text-xs text-slate-400">
            {loading ? "Loading…" : err ? <span className="text-red-600">{err}</span> : null}
          </div>
        </section>

        {/* KPI tiles */}
        <section className="no-print grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total Deals" value={data?.totals.deals.toLocaleString() ?? "–"} />
          <Kpi label="Total Commission" value={data ? gbp(data.totals.commission) : "–"} />
          <Kpi label="Paid Commission" value={data ? gbp(data.totals.paidCommission) : "–"} />
          <Kpi
            label="Cancelled"
            value={data ? `${data.totals.cancelledCount.toLocaleString()} (${data.totals.cancelledPct.toFixed(1)}%)` : "–"}
            tone="warn"
          />
        </section>

        {/* Charts */}
        <section className="no-print grid gap-4 lg:grid-cols-2">
          <ChartCard title="Cancellations by Reason">
            {reasonPieData.length === 0 ? (
              <Empty msg="No cancellations in current filter." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <PieChart>
                  <Pie
                    data={reasonPieData}
                    dataKey="count"
                    nameKey="label"
                    innerRadius={50}
                    outerRadius={90}
                    paddingAngle={2}
                  >
                    {reasonPieData.map((r) => (
                      <Cell key={r.reason} fill={REASON_COLORS[r.reason]} />
                    ))}
                  </Pie>
                  <RTooltip
                    formatter={(value, _name, item) => {
                      const row = (item?.payload ?? {}) as ByReasonRow;
                      return [`${Number(value || 0)} (${gbp(row.commission)})`, row.label];
                    }}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
          <ChartCard title="Deals per Week by Status">
            {weekStackData.length === 0 ? (
              <Empty msg="No deals in current filter." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={weekStackData} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip
                    labelFormatter={(w) => `Week ${w}`}
                    formatter={(value, name) => [value, STATUS_LABELS[name as DealStatus] ?? String(name)]}
                  />
                  <Legend formatter={(name) => STATUS_LABELS[name as DealStatus] ?? String(name)} />
                  {DEAL_STATUSES.map((s) => (
                    <Bar key={s} dataKey={s} stackId="a" fill={STATUS_COLORS[s]} />
                  ))}
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Adviser League Table"
            action={
              <Toggle
                options={[
                  { value: "commission", label: "Commission £" },
                  { value: "count",      label: "Deals" },
                ]}
                value={leagueMetric}
                onChange={(v) => setLeagueMetric(v as LeagueMetric)}
              />
            }
          >
            {leagueData.length === 0 ? (
              <Empty msg="No deals in current filter." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart
                  data={leagueData}
                  layout="vertical"
                  margin={{ top: 4, right: 8, bottom: 0, left: 8 }}
                >
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                  <YAxis type="category" dataKey="adviser_name" width={80} tick={{ fontSize: 11 }} />
                  <RTooltip
                    formatter={(value) =>
                      leagueMetric === "commission"
                        ? [gbp(Number(value)), "Commission"]
                        : [String(value), "Deals"]
                    }
                  />
                  <Bar dataKey={leagueMetric} fill="#0f172a" />
                </BarChart>
              </ResponsiveContainer>
            )}
          </ChartCard>

          <ChartCard
            title="Weekly Trend"
            action={
              <Toggle
                options={(Object.keys(TREND_METRIC_LABELS) as TrendMetric[]).map((k) => ({
                  value: k, label: TREND_METRIC_LABELS[k],
                }))}
                value={trendMetric}
                onChange={(v) => setTrendMetric(v as TrendMetric)}
              />
            }
          >
            {(data?.trend.length ?? 0) === 0 ? (
              <Empty msg="No deals in current filter." />
            ) : (
              <ResponsiveContainer width="100%" height={260}>
                <LineChart data={data!.trend} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="week" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                  <RTooltip
                    labelFormatter={(w) => `Week ${w}`}
                    formatter={(value) => {
                      const v = Number(value);
                      const isMoney = trendMetric === "commission" || trendMetric === "paidCommission";
                      return [isMoney ? gbp(v) : v, TREND_METRIC_LABELS[trendMetric]];
                    }}
                  />
                  <Line
                    type="monotone"
                    dataKey={trendMetric}
                    stroke="#0f172a"
                    strokeWidth={2}
                    dot={{ r: 3 }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </ChartCard>
        </section>

        {/* Deals detail — every filtered deal, with status + narrative notes.
            This is the section that prints. */}
        <section className="rounded-lg border bg-white shadow-sm">
          <div className="flex items-center justify-between border-b px-4 py-3">
            <h2 className="text-sm font-semibold text-slate-700">
              Deals
              {data ? (
                <span className="ml-2 font-normal text-slate-400">
                  {data.dealDetail.length} deal{data.dealDetail.length === 1 ? "" : "s"}
                </span>
              ) : null}
            </h2>
            <span className="no-print text-xs text-slate-400">Click a row to open and edit that deal</span>
          </div>
          {!data || data.dealDetail.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-slate-400">
              No deals in current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-3 py-2 text-left">Adviser</th>
                    <th className="px-3 py-2 text-right">Wk</th>
                    <th className="px-3 py-2 text-left">Client</th>
                    <th className="px-3 py-2 text-left">Status</th>
                    <th className="px-3 py-2 text-left">Reason</th>
                    <th className="px-3 py-2 text-left">Notes</th>
                    <th className="px-3 py-2 text-right">Commission</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dealDetail.map((d) => (
                    <tr
                      key={d.id}
                      className={`cursor-pointer border-t border-slate-100 align-top hover:bg-slate-50 ${
                        opening === d.id ? "opacity-60" : ""
                      }`}
                      onClick={() => openDealForEdit(d.id)}
                      title="Click to edit this deal"
                    >
                      <td className="px-3 py-2 whitespace-nowrap">
                        <Link
                          href={`/reci/${d.adviser_slug}`}
                          className="font-medium text-blue-600 hover:text-blue-800"
                          onClick={(e) => e.stopPropagation()}
                          title="Open this adviser's board"
                        >
                          {d.adviser_name}
                        </Link>
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums text-slate-600">{d.week}</td>
                      <td className="px-3 py-2 whitespace-nowrap">{d.client}</td>
                      <td className="px-3 py-2">
                        <span
                          className="rounded-full px-2 py-0.5 text-xs text-white"
                          style={{ backgroundColor: STATUS_COLORS[d.status] }}
                        >
                          {STATUS_LABELS[d.status]}
                        </span>
                      </td>
                      <td className="px-3 py-2">
                        {d.reason ? (
                          <span
                            className="rounded-full px-2 py-0.5 text-xs text-white"
                            style={{ backgroundColor: REASON_COLORS[d.reason] }}
                          >
                            {CANCELLATION_REASON_LABELS[d.reason]}
                          </span>
                        ) : (
                          <span className="text-xs text-slate-300">-</span>
                        )}
                      </td>
                      <td className="px-3 py-2 text-slate-700">
                        {d.notes ? d.notes : <span className="text-slate-300">-</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{gbp(d.commission)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      </main>

      {editingDeal && (
        <EditDealModal
          deal={editingDeal}
          onClose={() => {
            setEditingDeal(null);
            // Refresh analytics so any edit shows immediately.
            const ctrl = new AbortController();
            load(ctrl.signal);
          }}
        />
      )}
    </div>
  );
}

// ---------- small subcomponents (kept in-file; can be split if they grow) ----

function FilterGroup({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
        {hint ? <span className="ml-2 normal-case text-slate-400">{hint}</span> : null}
      </div>
      {children}
    </div>
  );
}

function Pill({
  active, disabled, color, onClick, children,
}: {
  active: boolean; disabled?: boolean; color?: string;
  onClick: () => void; children: React.ReactNode;
}) {
  const base = "rounded-full border px-2.5 py-0.5 text-xs transition-colors";
  if (disabled) {
    return (
      <button type="button" disabled className={`${base} cursor-not-allowed border-slate-200 bg-slate-50 text-slate-400`}>
        {children}
      </button>
    );
  }
  if (active) {
    return (
      <button
        type="button"
        onClick={onClick}
        style={color ? { backgroundColor: color, borderColor: color } : undefined}
        className={`${base} ${color ? "text-white" : "border-slate-900 bg-slate-900 text-white"}`}
      >
        {children}
      </button>
    );
  }
  return (
    <button type="button" onClick={onClick} className={`${base} border-slate-300 bg-white text-slate-700 hover:bg-slate-50`}>
      {children}
    </button>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: "warn" }) {
  return (
    <div className={`rounded-lg border bg-white p-4 shadow-sm ${tone === "warn" ? "border-amber-200" : ""}`}>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-2xl font-semibold ${tone === "warn" ? "text-amber-700" : "text-slate-900"}`}>
        {value}
      </div>
    </div>
  );
}

function ChartCard({
  title, action, children,
}: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-white p-4 shadow-sm">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-700">{title}</div>
        {action ? <div className="text-xs">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function Toggle<T extends string>({
  options, value, onChange,
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
}) {
  return (
    <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={`px-2 py-0.5 ${value === o.value ? "bg-slate-900 text-white" : "text-slate-600 hover:bg-slate-50"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Empty({ msg }: { msg: string }) {
  return (
    <div className="flex h-[260px] items-center justify-center text-sm text-slate-400">
      {msg}
    </div>
  );
}
