/**
 * Deal Tracker rollups — the report Pauline sends to Guy.
 *
 * Strategy: pull all deals for the requested year in one query, then aggregate
 * by week x adviser in TypeScript. Same shape as analytics.ts.
 *
 * Cancellation handling (per Pauline):
 *   - Cancelled deals are EXCLUDED from per-adviser figures (Deals / Est Comm /
 *     Av Prem) because they "haven't gone from In P to NYP or paid".
 *   - Cancelled deals ARE counted in the aggregate Est Gross Comm so the
 *     report still shows the original forecast.
 *   - Clawback = SUM of commission of cancelled deals (informational).
 *   - Est Net Comm = Gross - Clawback (matches sum of per-adviser Est Comms).
 */
import { sql } from "@vercel/postgres";
import { Deal, DealStatus } from "./schema";

export type Scope =
  | { kind: "year" }
  | { kind: "quarter"; q: 1 | 2 | 3 | 4 }
  | { kind: "month";   month: number }    // 1-12
  | { kind: "week";    week: number };    // 1-53

export interface AdviserCell {
  deals: number;        // SUM(no_of_deals) for non-cancelled
  est_comm: number;     // SUM(commission)  for non-cancelled
  av_prem: number;      // AVG(premium)     for non-cancelled (0 if none)
}

export interface TrackerRow {
  kind: "week" | "monthly-total" | "weekly-average" | "ytd";
  label: string;
  weekNumbers: number[];           // weeks covered
  deals: number;                   // total deals excluding cancelled and clawback
  est_gross_comm: number;          // commission of ALL deals (incl cancelled and clawback)
  cancelled: number;               // commission of cancelled deals (lost forecast)
  clawback: number;                // commission of clawback deals (refunded after payout)
  est_net_comm: number;            // gross - cancelled - clawback (truly retained)
  byAdviser: Record<number, AdviserCell>;
}

export interface TrackerMonth {
  monthNumber: number;             // 1-12
  monthName: string;               // "February"
  quarter: number;                 // 1-4
  weekRows: TrackerRow[];
  monthlyTotal: TrackerRow;
  weeklyAverage: TrackerRow;
  yearToDate: TrackerRow;
}

export interface TrackerAdviser {
  id: number;
  name: string;
}

export interface TrackerResult {
  year: number;
  scope: Scope;
  advisers: TrackerAdviser[];
  months: TrackerMonth[];          // empty for "week" scope; see weekOnly
  weekOnly?: TrackerRow;           // populated only for { kind: "week" }
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ----------------------------------------------------------------------------
// ISO week -> Monday date -> calendar month/quarter
// ----------------------------------------------------------------------------

export function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7; // 1 (Mon) .. 7 (Sun)
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return target;
}

function monthForWeek(year: number, week: number): number {
  // 1-12; based on the Monday of that ISO week.
  return isoWeekMonday(year, week).getUTCMonth() + 1;
}

function quarterForMonth(month: number): number {
  return Math.ceil(month / 3);
}

// ----------------------------------------------------------------------------
// Fetch + group
// ----------------------------------------------------------------------------

type DealRow = Deal & { adviser_name: string; adviser_sort: number };

async function fetchYearDeals(year: number): Promise<DealRow[]> {
  const { rows } = await sql<DealRow>`
    SELECT d.*, a.name AS adviser_name, a.sort_order AS adviser_sort
    FROM deals d
    JOIN advisers a ON a.id = d.adviser_id
    WHERE d.year = ${year}
  `;
  return rows;
}

async function fetchActiveAdvisers(): Promise<TrackerAdviser[]> {
  const { rows } = await sql<{ id: number; name: string }>`
    SELECT id, name FROM advisers WHERE active = true
    ORDER BY sort_order ASC, name ASC
  `;
  return rows;
}

// ----------------------------------------------------------------------------
// Aggregation
// ----------------------------------------------------------------------------

function emptyAdviserCells(advisers: TrackerAdviser[]): Record<number, AdviserCell> {
  const out: Record<number, AdviserCell> = {};
  for (const a of advisers) out[a.id] = { deals: 0, est_comm: 0, av_prem: 0 };
  return out;
}

interface AdviserAcc { deals: number; commSum: number; premSum: number; premCount: number }

function aggregate(
  rows: DealRow[],
  advisers: TrackerAdviser[],
  kind: TrackerRow["kind"],
  label: string,
  weekNumbers: number[],
): TrackerRow {
  let totalDeals = 0;
  let grossComm = 0;
  let cancelled = 0;
  let clawback = 0;
  const acc = new Map<number, AdviserAcc>();
  for (const a of advisers) acc.set(a.id, { deals: 0, commSum: 0, premSum: 0, premCount: 0 });

  for (const d of rows) {
    const c = Number(d.commission ?? 0) || 0;
    const isCancelled = d.status === "cancelled";
    const isClawback  = d.status === "clawback";

    // Aggregate columns: gross includes everything.
    grossComm += c;
    if (isCancelled) cancelled += c;
    if (isClawback)  clawback  += c;
    if (!isCancelled && !isClawback) {
      totalDeals += Number(d.no_of_deals ?? 0) || 0;
    }

    // Per-adviser excludes both cancelled (never realised) and clawback
    // (realised then refunded). Sum of per-adviser Est Comm therefore equals
    // Est Net Comm = Gross - Cancelled - Clawback.
    if (isCancelled || isClawback) continue;

    const a = acc.get(d.adviser_id);
    if (!a) continue;
    a.deals    += Number(d.no_of_deals ?? 0) || 0;
    a.commSum  += c;
    if (d.premium != null) {
      const p = Number(d.premium) || 0;
      a.premSum   += p;
      a.premCount += 1;
    }
  }

  const byAdviser: Record<number, AdviserCell> = {};
  for (const a of advisers) {
    const x = acc.get(a.id)!;
    byAdviser[a.id] = {
      deals:    x.deals,
      est_comm: x.commSum,
      av_prem:  x.premCount > 0 ? x.premSum / x.premCount : 0,
    };
  }

  return {
    kind, label, weekNumbers,
    deals: totalDeals,
    est_gross_comm: grossComm,
    cancelled,
    clawback,
    est_net_comm: grossComm - cancelled - clawback,
    byAdviser,
  };
}

function averageRow(monthlyTotal: TrackerRow, weeksInMonth: number, advisers: TrackerAdviser[]): TrackerRow {
  const div = weeksInMonth > 0 ? weeksInMonth : 1;
  const byAdviser: Record<number, AdviserCell> = {};
  for (const a of advisers) {
    const t = monthlyTotal.byAdviser[a.id];
    byAdviser[a.id] = {
      deals:    t.deals    / div,
      est_comm: t.est_comm / div,
      av_prem:  t.av_prem, // av-of-avs ≈ av; not strictly correct but matches Pauline's sheet meaning
    };
  }
  // Label is overridden by the caller (it knows the month name); leave a
  // sensible placeholder here.
  return {
    kind:  "weekly-average",
    label: "Weekly Average (Full)",
    weekNumbers: monthlyTotal.weekNumbers,
    deals:           monthlyTotal.deals / div,
    est_gross_comm:  monthlyTotal.est_gross_comm / div,
    cancelled:       monthlyTotal.cancelled / div,
    clawback:        monthlyTotal.clawback / div,
    est_net_comm:    monthlyTotal.est_net_comm / div,
    byAdviser,
  };
}

// ----------------------------------------------------------------------------
// Main entry
// ----------------------------------------------------------------------------

export async function dealTracker(year: number, scope: Scope): Promise<TrackerResult> {
  const [allDeals, advisers] = await Promise.all([
    fetchYearDeals(year),
    fetchActiveAdvisers(),
  ]);

  // Pre-group deals by week so we can build week rows cheaply.
  const dealsByWeek = new Map<number, DealRow[]>();
  for (const d of allDeals) {
    const arr = dealsByWeek.get(d.week) ?? [];
    arr.push(d);
    dealsByWeek.set(d.week, arr);
  }

  // --- "week" scope: just the single row.
  if (scope.kind === "week") {
    const w = scope.week;
    const row = aggregate(dealsByWeek.get(w) ?? [], advisers, "week", String(w), [w]);
    return { year, scope, advisers, months: [], weekOnly: row };
  }

  // Otherwise: determine which months are in scope.
  const monthsInScope: number[] = (() => {
    if (scope.kind === "year")    return Array.from({length: 12}, (_, i) => i + 1);
    if (scope.kind === "quarter") return [scope.q * 3 - 2, scope.q * 3 - 1, scope.q * 3];
    return [scope.month];
  })();

  // For each week of the year, work out its month.
  const weekToMonth = new Map<number, number>();
  for (let w = 1; w <= 53; w++) {
    weekToMonth.set(w, monthForWeek(year, w));
  }

  const months: TrackerMonth[] = [];
  for (const m of monthsInScope) {
    const weeksInMonth = Array.from(weekToMonth.entries())
      .filter(([, mm]) => mm === m)
      .map(([w]) => w)
      .sort((a, b) => a - b);

    // Week rows
    const weekRows: TrackerRow[] = weeksInMonth.map((w) =>
      aggregate(dealsByWeek.get(w) ?? [], advisers, "week", String(w), [w]),
    );

    // Monthly total (all deals in any of this month's weeks).
    const monthDeals = weeksInMonth.flatMap((w) => dealsByWeek.get(w) ?? []);
    const monthlyTotal = aggregate(
      monthDeals, advisers, "monthly-total",
      `${MONTH_NAMES[m - 1]} Monthly Total`, weeksInMonth,
    );

    // Weekly average — divide each metric by number of weeks present.
    const weeklyAverage = averageRow(monthlyTotal, weeksInMonth.length, advisers);
    weeklyAverage.label = `${MONTH_NAMES[m - 1]} Weekly Average (Full)`;

    // YTD = all deals in weeks 1..last-week-of-this-month inclusive.
    const ytdMaxWeek = Math.max(...weeksInMonth);
    const ytdDeals: DealRow[] = [];
    for (let w = 1; w <= ytdMaxWeek; w++) {
      const arr = dealsByWeek.get(w);
      if (arr) ytdDeals.push(...arr);
    }
    const ytdWeeks = Array.from({length: ytdMaxWeek}, (_, i) => i + 1);
    const yearToDate = aggregate(
      ytdDeals, advisers, "ytd",
      "Total Year To Date", ytdWeeks,
    );

    months.push({
      monthNumber: m,
      monthName: MONTH_NAMES[m - 1],
      quarter: quarterForMonth(m),
      weekRows,
      monthlyTotal,
      weeklyAverage,
      yearToDate,
    });
  }

  return { year, scope, advisers, months };
}

// ----------------------------------------------------------------------------
// Per-adviser Business Tracker — one table per adviser with week rows showing
// each status's commission and percentage of that week's total. Matches the
// printed report Pauline uses.
// ----------------------------------------------------------------------------

export interface BizWeekRow {
  week: number;
  paid: number;
  on_risk_nyp: number;
  in_processing: number;
  not_yet_submitted: number;
  cancelled: number;       // includes status='cancelled' AND status='clawback' so it
                           // matches the long-standing 5-column Business Tracker layout
  total: number;
  // Deal counts alongside the £ figures (Poz 6 Aug: "it is currently just
  // a monetary value"). Sums of no_of_deals, same bucketing as the £.
  paid_n: number;
  on_risk_nyp_n: number;
  in_processing_n: number;
  not_yet_submitted_n: number;
  cancelled_n: number;
  total_n: number;
}

export interface BizAdviserRollup {
  adviser_id: number;
  adviser_name: string;
  weeks: BizWeekRow[];     // ordered by week ascending
  total: BizWeekRow;       // sum across the weeks in scope; .week = 0 sentinel
}

export interface BusinessTrackerByAdviserResult {
  year: number;
  scope: Scope;
  weeksInScope: number[];
  advisers: BizAdviserRollup[]; // one block per adviser actually having data in scope
  allAdvisers: TrackerAdviser[]; // for filter UI population
}

function emptyBizRow(week: number): BizWeekRow {
  return {
    week,
    paid: 0, on_risk_nyp: 0, in_processing: 0,
    not_yet_submitted: 0, cancelled: 0, total: 0,
    paid_n: 0, on_risk_nyp_n: 0, in_processing_n: 0,
    not_yet_submitted_n: 0, cancelled_n: 0, total_n: 0,
  };
}

function addToBiz(row: BizWeekRow, status: DealStatus, c: number, n: number): void {
  if (status === "paid")              { row.paid += c;              row.paid_n += n; }
  else if (status === "on_risk_nyp")  { row.on_risk_nyp += c;      row.on_risk_nyp_n += n; }
  else if (status === "in_processing") { row.in_processing += c;   row.in_processing_n += n; }
  else if (status === "not_yet_submitted") { row.not_yet_submitted += c; row.not_yet_submitted_n += n; }
  else if (status === "cancelled")    { row.cancelled += c;        row.cancelled_n += n; }
  else if (status === "clawback")     { row.cancelled += c;        row.cancelled_n += n; }
  row.total = row.paid + row.on_risk_nyp + row.in_processing + row.not_yet_submitted + row.cancelled;
  row.total_n = row.paid_n + row.on_risk_nyp_n + row.in_processing_n + row.not_yet_submitted_n + row.cancelled_n;
}

export async function businessTrackerByAdviser(
  year: number,
  scope: Scope,
  filterAdviserIds?: number[] | null,
): Promise<BusinessTrackerByAdviserResult> {
  const [allDeals, advisers] = await Promise.all([
    fetchYearDeals(year),
    fetchActiveAdvisers(),
  ]);

  // Map<week, void>: which weeks the scope wants.
  const weeks = (() => {
    if (scope.kind === "week")    return [scope.week];
    if (scope.kind === "year")    return Array.from({length: 53}, (_, i) => i + 1);
    const months = scope.kind === "quarter"
      ? [scope.q * 3 - 2, scope.q * 3 - 1, scope.q * 3]
      : [scope.month];
    const out: number[] = [];
    for (let w = 1; w <= 53; w++) {
      if (months.includes(monthForWeek(year, w))) out.push(w);
    }
    return out;
  })();
  const weekSet = new Set(weeks);

  const wantedAdvisers = (filterAdviserIds && filterAdviserIds.length > 0)
    ? new Set(filterAdviserIds)
    : null; // null = all

  // Per adviser, Map<week, BizWeekRow>.
  const byAdviser = new Map<number, Map<number, BizWeekRow>>();

  for (const d of allDeals) {
    if (!weekSet.has(d.week)) continue;
    if (wantedAdvisers && !wantedAdvisers.has(d.adviser_id)) continue;
    // Renamed from `weeks` to `advWeekMap` so we don't shadow the outer
    // `weeks` array. The Next.js production build was clobbering the outer
    // binding, leaving the post-loop `weeks.slice()` operating on a Map and
    // returning zero advisers from the no-filter code path.
    let advWeekMap = byAdviser.get(d.adviser_id);
    if (!advWeekMap) {
      advWeekMap = new Map<number, BizWeekRow>();
      byAdviser.set(d.adviser_id, advWeekMap);
    }
    let row = advWeekMap.get(d.week);
    if (!row) { row = emptyBizRow(d.week); advWeekMap.set(d.week, row); }
    const c = Number(d.commission ?? 0) || 0;
    const n = Number(d.no_of_deals ?? 0) || 0;
    addToBiz(row, d.status, c, n);
  }

  // Build the result ordered by adviser sort_order.
  const result: BizAdviserRollup[] = [];
  for (const a of advisers) {
    if (wantedAdvisers && !wantedAdvisers.has(a.id)) continue;
    const wkMap = byAdviser.get(a.id);
    if (!wkMap || wkMap.size === 0) continue; // skip advisers with no data in scope

    const wkRows: BizWeekRow[] = [];
    for (const w of weeks.slice().sort((a, b) => a - b)) {
      const row = wkMap.get(w) ?? emptyBizRow(w);
      wkRows.push(row);
    }
    const total = wkRows.reduce(
      (acc, r) => ({
        week: 0,
        paid:              acc.paid + r.paid,
        on_risk_nyp:       acc.on_risk_nyp + r.on_risk_nyp,
        in_processing:     acc.in_processing + r.in_processing,
        not_yet_submitted: acc.not_yet_submitted + r.not_yet_submitted,
        cancelled:         acc.cancelled + r.cancelled,
        total:             acc.total + r.total,
        paid_n:              acc.paid_n + r.paid_n,
        on_risk_nyp_n:       acc.on_risk_nyp_n + r.on_risk_nyp_n,
        in_processing_n:     acc.in_processing_n + r.in_processing_n,
        not_yet_submitted_n: acc.not_yet_submitted_n + r.not_yet_submitted_n,
        cancelled_n:         acc.cancelled_n + r.cancelled_n,
        total_n:             acc.total_n + r.total_n,
      }),
      emptyBizRow(0),
    );
    result.push({
      adviser_id: a.id,
      adviser_name: a.name,
      weeks: wkRows,
      total,
    });
  }

  return {
    year,
    scope,
    weeksInScope: weeks,
    advisers: result,
    allAdvisers: advisers,
  };
}

export function parseScopeFromParams(p: URLSearchParams): Scope {
  const kind = (p.get("scope") ?? "month") as Scope["kind"];
  if (kind === "year") return { kind: "year" };
  if (kind === "quarter") {
    const q = Math.max(1, Math.min(4, Number(p.get("q") ?? 1))) as 1 | 2 | 3 | 4;
    return { kind: "quarter", q };
  }
  if (kind === "week") {
    const w = Math.max(1, Math.min(53, Number(p.get("week") ?? 1)));
    return { kind: "week", week: w };
  }
  // default month
  const m = Math.max(1, Math.min(12, Number(p.get("month") ?? (new Date().getMonth() + 1))));
  return { kind: "month", month: m };
}

// ----------------------------------------------------------------------------
// Seller performance trends (Poz/Guy, 2 Sep 2026): one adviser's Business
// Tracker measures rolled up per month and per quarter so Guy can see how
// an individual is trending rather than reading the figures in isolation.
// Quarters use the same straight 13-week bins as the Business Tracker page.
// ----------------------------------------------------------------------------

export interface SellerPeriodRow {
  key: string;              // "m1".."m12" or "q1".."q4"
  label: string;            // "January" / "Q1"
  // £ by status (cancelled includes clawback, matching the tracker).
  paid: number;
  on_risk_nyp: number;
  in_processing: number;
  not_yet_submitted: number;
  cancelled: number;
  total: number;            // £ all statuses
  liveTotal: number;        // £ excluding cancelled
  deals: number;            // SUM(no_of_deals) excluding cancelled/clawback
  weeks: number;            // weeks in the period with any data for this seller
  avgPerWeek: number;       // liveTotal / weeks
  avgPerDeal: number;       // liveTotal / deals
  cancelRate: number;       // cancelled £ / total £ (0-1)
  teamShare: number;        // seller total £ / whole-team total £ (0-1)
}

export interface SellerPerformanceResult {
  year: number;
  adviser: TrackerAdviser;
  advisers: TrackerAdviser[];  // for the picker
  months: SellerPeriodRow[];   // only months with data
  quarters: SellerPeriodRow[];
  ytd: SellerPeriodRow;
}

function quarterBinForWeek(week: number): number {
  if (week <= 13) return 1;
  if (week <= 26) return 2;
  if (week <= 39) return 3;
  return 4;
}

export async function sellerPerformance(year: number, adviserId: number): Promise<SellerPerformanceResult> {
  const [allDeals, advisers] = await Promise.all([fetchYearDeals(year), fetchActiveAdvisers()]);
  const adviser = advisers.find((a) => a.id === adviserId) ?? { id: adviserId, name: "Unknown" };

  interface Acc {
    paid: number; on_risk_nyp: number; in_processing: number;
    not_yet_submitted: number; cancelled: number;
    deals: number; weeks: Set<number>; teamTotal: number;
  }
  const blank = (): Acc => ({
    paid: 0, on_risk_nyp: 0, in_processing: 0, not_yet_submitted: 0,
    cancelled: 0, deals: 0, weeks: new Set(), teamTotal: 0,
  });
  const monthAcc = new Map<number, Acc>();
  const quarterAcc = new Map<number, Acc>();
  const ytdAcc = blank();

  const addTo = (acc: Acc, d: DealRow, mine: boolean) => {
    const c = Number(d.commission ?? 0) || 0;
    acc.teamTotal += c;
    if (!mine) return;
    if (d.status === "paid") acc.paid += c;
    else if (d.status === "on_risk_nyp") acc.on_risk_nyp += c;
    else if (d.status === "in_processing") acc.in_processing += c;
    else if (d.status === "not_yet_submitted") acc.not_yet_submitted += c;
    else if (d.status === "cancelled" || d.status === "clawback") acc.cancelled += c;
    if (d.status !== "cancelled" && d.status !== "clawback") {
      acc.deals += Number(d.no_of_deals ?? 0) || 0;
    }
    acc.weeks.add(d.week);
  };

  for (const d of allDeals) {
    const m = monthForWeek(year, d.week);
    const q = quarterBinForWeek(d.week);
    const mine = d.adviser_id === adviserId;
    for (const [map, k] of [[monthAcc, m], [quarterAcc, q]] as const) {
      let a = map.get(k);
      if (!a) { a = blank(); map.set(k, a); }
      addTo(a, d, mine);
    }
    addTo(ytdAcc, d, mine);
  }

  const toRow = (key: string, label: string, a: Acc): SellerPeriodRow => {
    const total = a.paid + a.on_risk_nyp + a.in_processing + a.not_yet_submitted + a.cancelled;
    const live = total - a.cancelled;
    return {
      key, label,
      paid: a.paid, on_risk_nyp: a.on_risk_nyp, in_processing: a.in_processing,
      not_yet_submitted: a.not_yet_submitted, cancelled: a.cancelled,
      total, liveTotal: live,
      deals: a.deals,
      weeks: a.weeks.size,
      avgPerWeek: a.weeks.size > 0 ? live / a.weeks.size : 0,
      avgPerDeal: a.deals > 0 ? live / a.deals : 0,
      cancelRate: total > 0 ? a.cancelled / total : 0,
      teamShare: a.teamTotal > 0 ? total / a.teamTotal : 0,
    };
  };

  const months = Array.from(monthAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([m, a]) => toRow(`m${m}`, MONTH_NAMES[m - 1], a))
    .filter((r) => r.total > 0 || r.deals > 0);
  const quarters = Array.from(quarterAcc.entries())
    .sort((a, b) => a[0] - b[0])
    .map(([q, a]) => toRow(`q${q}`, `Q${q}`, a))
    .filter((r) => r.total > 0 || r.deals > 0);

  return {
    year, adviser, advisers,
    months, quarters,
    ytd: toRow("ytd", "Year to date", ytdAcc),
  };
}
