/**
 * Weekly Deals report — every deal in scope, grouped by week then by agent.
 *
 * Same Year / Quarter / Month / Week scope as the Deal Tracker, but instead
 * of weekly rollups it returns the underlying deal rows, sorted by week then
 * by the adviser's sort_order. Designed for line-by-line printing.
 */
import { sql } from "@vercel/postgres";
import { Deal, DealStatus, CancellationReason, InProcessingStage } from "./schema";

export type Scope =
  | { kind: "year" }
  | { kind: "quarter"; q: 1 | 2 | 3 | 4 }
  | { kind: "month";   month: number }    // 1-12
  | { kind: "week";    week: number };    // 1-53

export interface WeeklyDealRow {
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

export interface AgentGroup {
  adviser_id: number;
  adviser_name: string;
  deals: WeeklyDealRow[];
  subtotal: { count: number; commission: number };
}

export interface WeekGroup {
  week: number;
  monthName: string;
  quarter: number;
  agents: AgentGroup[];
  total: { count: number; commission: number };
}

export interface WeeklyReportResult {
  year: number;
  scope: Scope;
  weeks: WeekGroup[];
  grand: { count: number; commission: number };
}

const MONTH_NAMES = [
  "January","February","March","April","May","June",
  "July","August","September","October","November","December",
];

// ----- ISO week -> calendar month/quarter (same logic as tracker.ts) -----
function isoWeekMonday(year: number, week: number): Date {
  const jan4 = new Date(Date.UTC(year, 0, 4));
  const jan4Day = jan4.getUTCDay() || 7;
  const week1Mon = new Date(jan4);
  week1Mon.setUTCDate(jan4.getUTCDate() - (jan4Day - 1));
  const target = new Date(week1Mon);
  target.setUTCDate(week1Mon.getUTCDate() + (week - 1) * 7);
  return target;
}
function monthForWeek(year: number, week: number): number {
  return isoWeekMonday(year, week).getUTCMonth() + 1;
}
function quarterForMonth(m: number): number {
  return Math.ceil(m / 3);
}

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

function weeksInScope(year: number, scope: Scope): number[] {
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
}

function toRow(d: DealRow): WeeklyDealRow {
  return {
    id: d.id,
    adviser_id: d.adviser_id,
    adviser_name: d.adviser_name,
    adviser_sort: d.adviser_sort,
    week: d.week,
    client: d.client,
    postcode: d.postcode,
    no_of_deals: d.no_of_deals,
    provider: d.provider,
    premium: d.premium != null ? Number(d.premium) : null,
    confirmed_date: d.confirmed_date,
    poz_listened: d.poz_listened,
    submitted: d.submitted,
    acc_ref: d.acc_ref,
    status: d.status,
    in_processing_stage: d.in_processing_stage,
    reason: d.status === "cancelled" ? d.cancellation_reason : null,
    notes: d.status === "cancelled" ? d.cancellation_notes : d.notes,
    commission: Number(d.commission) || 0,
  };
}

export async function weeklyReport(year: number, scope: Scope): Promise<WeeklyReportResult> {
  const all = await fetchYearDeals(year);
  const weeks = weeksInScope(year, scope);
  const weekSet = new Set(weeks);

  const byWeek = new Map<number, DealRow[]>();
  for (const d of all) {
    if (!weekSet.has(d.week)) continue;
    const arr = byWeek.get(d.week) ?? [];
    arr.push(d);
    byWeek.set(d.week, arr);
  }

  const weekGroups: WeekGroup[] = [];
  let grandCount = 0;
  let grandCommission = 0;

  for (const week of weeks.sort((a, b) => a - b)) {
    const deals = byWeek.get(week) ?? [];
    if (deals.length === 0) continue;

    // Group by adviser, ordered by sort_order ASC then name ASC.
    const byAdv = new Map<number, DealRow[]>();
    for (const d of deals) {
      const arr = byAdv.get(d.adviser_id) ?? [];
      arr.push(d);
      byAdv.set(d.adviser_id, arr);
    }
    const agents: AgentGroup[] = Array.from(byAdv.entries())
      .map(([adviser_id, list]) => {
        list.sort((a, b) => a.id - b.id);  // stable order within an agent's deals
        const subtotal = list.reduce(
          (acc, d) => ({
            count: acc.count + 1,
            commission: acc.commission + (Number(d.commission) || 0),
          }),
          { count: 0, commission: 0 },
        );
        return {
          adviser_id,
          adviser_name: list[0].adviser_name,
          deals: list.map(toRow),
          subtotal,
          _sort: list[0].adviser_sort,
        };
      })
      .sort((a, b) => a._sort - b._sort || a.adviser_name.localeCompare(b.adviser_name))
      .map(({ _sort, ...rest }) => rest);

    const total = agents.reduce(
      (acc, ag) => ({
        count: acc.count + ag.subtotal.count,
        commission: acc.commission + ag.subtotal.commission,
      }),
      { count: 0, commission: 0 },
    );
    grandCount += total.count;
    grandCommission += total.commission;

    const m = monthForWeek(year, week);
    weekGroups.push({
      week,
      monthName: MONTH_NAMES[m - 1],
      quarter: quarterForMonth(m),
      agents,
      total,
    });
  }

  return {
    year,
    scope,
    weeks: weekGroups,
    grand: { count: grandCount, commission: grandCommission },
  };
}

export function parseScopeFromParams(p: URLSearchParams): Scope {
  const kind = (p.get("scope") ?? "month") as Scope["kind"];
  if (kind === "year")    return { kind: "year" };
  if (kind === "quarter") {
    const q = Math.max(1, Math.min(4, Number(p.get("q") ?? 1))) as 1 | 2 | 3 | 4;
    return { kind: "quarter", q };
  }
  if (kind === "week") {
    const w = Math.max(1, Math.min(53, Number(p.get("week") ?? 1)));
    return { kind: "week", week: w };
  }
  const m = Math.max(1, Math.min(12, Number(p.get("month") ?? (new Date().getMonth() + 1))));
  return { kind: "month", month: m };
}
