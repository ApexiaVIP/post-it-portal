/**
 * RECI analytics — filtered slice of deals + pre-aggregated rollups for charts.
 *
 * Strategy: pull all deals for the requested year in a single query, then apply
 * filters + aggregate in TypeScript. The dataset is small (hundreds of rows per
 * year) so this is plenty fast and keeps the SQL trivial.
 */
import { sql } from "@vercel/postgres";
import {
  CANCELLATION_REASONS,
  CancellationReason,
  Deal,
  DEAL_STATUSES,
  DealStatus,
} from "./schema";

export interface AnalyticsFilters {
  year: number;
  adviserIds?: number[] | null;
  statuses?: DealStatus[] | null;
  reasons?: CancellationReason[] | null;
  weekFrom?: number | null;
  weekTo?: number | null;
}

export interface AnalyticsTotals {
  deals: number;
  commission: number;
  paidCommission: number;
  cancelledCount: number;
  cancelledPct: number;
}

export interface ByReasonRow {
  reason: CancellationReason;
  label: string;
  count: number;
  commission: number;
}

export interface ByWeekStatusRow {
  week: number;
  status: DealStatus;
  count: number;
  commission: number;
}

export interface ByAdviserRow {
  adviser_id: number;
  adviser_name: string;
  count: number;
  commission: number;
  paidCommission: number;
  cancelled: number;
}

export interface TrendRow {
  week: number;
  count: number;
  commission: number;
  paidCommission: number;
  cancellations: number;
}

// Row-level detail for every deal in scope (after filters). Includes the
// free-text narrative: cancellation_notes for cancelled rows, otherwise the
// deal's general notes. This is what gets printed.
export interface DealDetailRow {
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
}

export interface AnalyticsResult {
  filters: AnalyticsFilters;
  totals: AnalyticsTotals;
  byReason: ByReasonRow[];
  byWeekStatus: ByWeekStatusRow[];
  byAdviser: ByAdviserRow[];
  trend: TrendRow[];
  dealDetail: DealDetailRow[];
}

type DealRow = Deal & { adviser_name: string; adviser_slug: string };

async function fetchYearDeals(year: number): Promise<DealRow[]> {
  const { rows } = await sql<DealRow>`
    SELECT d.*, a.name AS adviser_name, a.slug AS adviser_slug
    FROM deals d
    JOIN advisers a ON a.id = d.adviser_id
    WHERE d.year = ${year}
  `;
  return rows;
}

function applyFilters(rows: DealRow[], f: AnalyticsFilters): DealRow[] {
  const adviserSet = f.adviserIds && f.adviserIds.length ? new Set(f.adviserIds) : null;
  const statusSet  = f.statuses   && f.statuses.length   ? new Set(f.statuses)   : null;
  const reasonSet  = f.reasons    && f.reasons.length    ? new Set(f.reasons)    : null;
  const wFrom = f.weekFrom ?? null;
  const wTo   = f.weekTo   ?? null;

  return rows.filter((d) => {
    if (adviserSet && !adviserSet.has(d.adviser_id)) return false;
    if (statusSet  && !statusSet.has(d.status))      return false;
    if (wFrom != null && d.week < wFrom) return false;
    if (wTo   != null && d.week > wTo)   return false;
    // Reason filter only applies to cancelled deals. If reasons are selected
    // but this deal isn't cancelled, exclude it (the filter is implicitly
    // "show only cancelled deals matching these reasons").
    if (reasonSet) {
      if (d.status !== "cancelled") return false;
      const r = d.cancellation_reason ?? "other";
      if (!reasonSet.has(r as CancellationReason)) return false;
    }
    return true;
  });
}

const REASON_LABELS: Record<CancellationReason, string> = {
  npw:       "NPW",
  postponed: "Postponed",
  declined:  "Declined",
  other:     "Other",
};

function toNum(x: unknown): number {
  if (x == null) return 0;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

function aggregate(rows: DealRow[], filters: AnalyticsFilters): AnalyticsResult {
  let dealsCount = 0;
  let commissionSum = 0;
  let paidCommissionSum = 0;
  let cancelledCount = 0;

  const reasonAcc = new Map<CancellationReason, { count: number; commission: number }>();
  for (const r of CANCELLATION_REASONS) reasonAcc.set(r, { count: 0, commission: 0 });

  // Map<`${week}|${status}`, {count, commission}>
  const weekStatusAcc = new Map<string, ByWeekStatusRow>();

  const adviserAcc = new Map<number, ByAdviserRow>();

  // Map<week, TrendRow>
  const trendAcc = new Map<number, TrendRow>();

  const dealDetail: DealDetailRow[] = [];

  for (const d of rows) {
    const c = toNum(d.commission);
    dealsCount += 1;
    commissionSum += c;
    if (d.status === "paid") paidCommissionSum += c;
    if (d.status === "cancelled") {
      cancelledCount += 1;
      const reason = (d.cancellation_reason ?? "other") as CancellationReason;
      const acc = reasonAcc.get(reason)!;
      acc.count += 1;
      acc.commission += c;
    }

    // Every filtered deal makes the detail list — not just cancelled — so the
    // table reflects whatever status the user has filtered to.
    dealDetail.push({
      id: d.id,
      adviser_id: d.adviser_id,
      adviser_name: d.adviser_name,
      adviser_slug: d.adviser_slug,
      week: d.week,
      client: d.client,
      status: d.status,
      reason: d.status === "cancelled" ? d.cancellation_reason : null,
      // For cancelled: show cancellation_notes; otherwise the deal's general notes.
      notes: d.status === "cancelled" ? d.cancellation_notes : d.notes,
      commission: c,
      cancelled_at: d.cancelled_at,
      cancelled_by: d.cancelled_by,
      provider: d.provider,
    });

    const wsKey = `${d.week}|${d.status}`;
    const ws = weekStatusAcc.get(wsKey) ?? {
      week: d.week, status: d.status, count: 0, commission: 0,
    };
    ws.count += 1;
    ws.commission += c;
    weekStatusAcc.set(wsKey, ws);

    const adv = adviserAcc.get(d.adviser_id) ?? {
      adviser_id: d.adviser_id, adviser_name: d.adviser_name,
      count: 0, commission: 0, paidCommission: 0, cancelled: 0,
    };
    adv.count += 1;
    adv.commission += c;
    if (d.status === "paid")      adv.paidCommission += c;
    if (d.status === "cancelled") adv.cancelled += 1;
    adviserAcc.set(d.adviser_id, adv);

    const tr = trendAcc.get(d.week) ?? {
      week: d.week, count: 0, commission: 0, paidCommission: 0, cancellations: 0,
    };
    tr.count += 1;
    tr.commission += c;
    if (d.status === "paid")      tr.paidCommission += c;
    if (d.status === "cancelled") tr.cancellations += 1;
    trendAcc.set(d.week, tr);
  }

  const byReason: ByReasonRow[] = CANCELLATION_REASONS.map((r) => ({
    reason: r,
    label: REASON_LABELS[r],
    count: reasonAcc.get(r)!.count,
    commission: reasonAcc.get(r)!.commission,
  }));

  const byWeekStatus: ByWeekStatusRow[] = Array.from(weekStatusAcc.values())
    .sort((a, b) => a.week - b.week || DEAL_STATUSES.indexOf(a.status) - DEAL_STATUSES.indexOf(b.status));

  const byAdviser: ByAdviserRow[] = Array.from(adviserAcc.values())
    .sort((a, b) => b.commission - a.commission);

  const trend: TrendRow[] = Array.from(trendAcc.values())
    .sort((a, b) => a.week - b.week);

  // Most-recent first: by week desc, then cancelled_at desc (cancelled rows
  // surface first inside a week), then id desc.
  dealDetail.sort((a, b) => {
    if (b.week !== a.week) return b.week - a.week;
    const at = a.cancelled_at ? Date.parse(a.cancelled_at) : 0;
    const bt = b.cancelled_at ? Date.parse(b.cancelled_at) : 0;
    if (bt !== at) return bt - at;
    return b.id - a.id;
  });

  const cancelledPct = dealsCount > 0 ? (cancelledCount / dealsCount) * 100 : 0;

  return {
    filters,
    totals: {
      deals: dealsCount,
      commission: commissionSum,
      paidCommission: paidCommissionSum,
      cancelledCount,
      cancelledPct,
    },
    byReason,
    byWeekStatus,
    byAdviser,
    trend,
    dealDetail,
  };
}

export async function analytics(filters: AnalyticsFilters): Promise<AnalyticsResult> {
  const rows = await fetchYearDeals(filters.year);
  const filtered = applyFilters(rows, filters);
  return aggregate(filtered, filters);
}

// Helpers for parsing query-string filter params on the API route.
function parseIntList(s: string | null): number[] | null {
  if (!s) return null;
  const out = s.split(",").map((x) => Number(x.trim())).filter((n) => Number.isFinite(n));
  return out.length ? out : null;
}

function parseStringList<T extends string>(s: string | null, allowed: readonly T[]): T[] | null {
  if (!s) return null;
  const allowSet = new Set<string>(allowed as readonly string[]);
  const out = s.split(",").map((x) => x.trim()).filter((x) => allowSet.has(x)) as T[];
  return out.length ? out : null;
}

export function parseFiltersFromParams(p: URLSearchParams): AnalyticsFilters {
  const year = Number(p.get("year") || new Date().getFullYear());
  const wFrom = p.get("weekFrom");
  const wTo   = p.get("weekTo");
  return {
    year: Number.isFinite(year) ? year : new Date().getFullYear(),
    adviserIds: parseIntList(p.get("advisers")),
    statuses:   parseStringList(p.get("statuses"), DEAL_STATUSES),
    reasons:    parseStringList(p.get("reasons"),  CANCELLATION_REASONS),
    weekFrom:   wFrom ? Number(wFrom) : null,
    weekTo:     wTo   ? Number(wTo)   : null,
  };
}
