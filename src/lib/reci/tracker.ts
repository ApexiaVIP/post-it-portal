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
import { Deal } from "./schema";

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

function isoWeekMonday(year: number, week: number): Date {
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
