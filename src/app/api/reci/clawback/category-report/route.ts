/**
 * GET /api/reci/clawback/category-report
 *
 * Monthly clawback breakdown by category for Guy's exec view. Each case
 * lands in exactly one of seven buckets, derived from the L&G warning,
 * the case status, and the lost_reason sub-flag:
 *
 *   CFO          - warning ILIKE 'cancelled from outset' AND status active
 *                  (case is still being worked; L&G is treating it as CFO)
 *   Lapsed       - warning ILIKE 'lapse' AND status NOT IN
 *                  (resold / reinstated / dead)
 *   Reinstated   - status = 'reinstated'
 *   Resold       - status = 'resold'
 *   Dead client  - status = 'dead' AND lost_reason = 'dead_client'
 *   Dead contact - status = 'dead' AND lost_reason = 'dead_contact'
 *   Lost         - status = 'dead' AND lost_reason = 'pitched_missed'
 *                  (and legacy dead cases with no lost_reason set yet)
 *   Other        - catch-all for anything that doesn't slot in (e.g.
 *                  'saved' status, or weird warnings); shown only when
 *                  count > 0.
 *
 * Bucketing happens once in SQL, then we aggregate by clawback_date
 * month so the report is one row per (month x category) with £ totals
 * and case counts.
 *
 * Query params:
 *   year   integer (default current calendar year)
 *
 * Honors the read scope for junior sellers.
 *
 * Auth: any clawback user.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Category =
  | "CFO" | "Lapsed" | "Reinstated" | "Resold"
  | "Dead client" | "Dead contact" | "Lost" | "Other";

const CATEGORY_ORDER: Category[] = [
  "CFO", "Lapsed", "Reinstated", "Resold",
  "Dead client", "Dead contact", "Lost", "Other",
];

interface MonthRow {
  key: string;        // "2026-07"
  label: string;      // "Jul 2026"
  start: string;
  end: string;
  byCategory: Record<Category, { amount: number; cases: number }>;
  total: { amount: number; cases: number };
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scope = await clawbackAdviserScope(session.username);
  if (scope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scopeWhere = typeof scope === "number" ? ` AND c.adviser_id = ${scope}` : "";

  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getUTCFullYear());
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "bad year" }, { status: 400 });
  }

  // Per-row categorisation done in SQL so the totals roll up cleanly.
  // "Active" warning-derived buckets (CFO, Lapsed) only apply when the
  // case is still on the active queue; once the lads resolve it the
  // status-derived bucket wins.
  const rowsR = await sql.query<{
    clawback_date: string | null;
    category: Category;
    effective_cb: string;
    cases: string;
  }>(
    `WITH effective AS (
       SELECT
         c.clawback_date,
         COALESCE(c.final_clawback_due, c.clawback_due)::numeric AS effective_cb,
         CASE
           WHEN c.status = 'resold'         THEN 'Resold'
           WHEN c.status = 'reinstated'     THEN 'Reinstated'
           WHEN c.status = 'dead' AND c.lost_reason = 'dead_client'    THEN 'Dead client'
           WHEN c.status = 'dead' AND c.lost_reason = 'dead_contact'   THEN 'Dead contact'
           WHEN c.status = 'dead' AND c.lost_reason = 'pitched_missed' THEN 'Lost'
           WHEN c.status = 'dead'           THEN 'Lost'
           WHEN c.ebah_warning ILIKE '%cancelled from outset%' THEN 'CFO'
           WHEN c.ebah_warning ILIKE '%lapse%'                 THEN 'Lapsed'
           ELSE 'Other'
         END AS category
       FROM clawback_cases c
       WHERE c.deleted_at IS NULL
         AND (c.clawback_date IS NULL OR EXTRACT(YEAR FROM c.clawback_date) = ${year})
         ${scopeWhere}
     )
     SELECT
       clawback_date::text AS clawback_date,
       category::text      AS category,
       COALESCE(SUM(effective_cb), 0)::text AS effective_cb,
       COUNT(*)::text                       AS cases
     FROM effective
     GROUP BY clawback_date, category`,
    [],
  );

  // Build 12 months Jan..Dec for the year, plus an "Unscheduled" bucket
  // for cases with no clawback_date.
  const monthsMap = new Map<string, MonthRow>();
  function emptyByCategory(): Record<Category, { amount: number; cases: number }> {
    const out = {} as Record<Category, { amount: number; cases: number }>;
    for (const c of CATEGORY_ORDER) out[c] = { amount: 0, cases: 0 };
    return out;
  }
  for (let m = 1; m <= 12; m++) {
    const start = `${year}-${pad2(m)}-01`;
    const lastDay = new Date(Date.UTC(year, m, 0)).getUTCDate();
    const end = `${year}-${pad2(m)}-${pad2(lastDay)}`;
    monthsMap.set(`${year}-${pad2(m)}`, {
      key: `${year}-${pad2(m)}`,
      label: `${monthShort(m)} ${year}`,
      start, end,
      byCategory: emptyByCategory(),
      total: { amount: 0, cases: 0 },
    });
  }
  const unscheduled: MonthRow = {
    key: "unscheduled",
    label: "Unscheduled (no CB date)",
    start: "", end: "",
    byCategory: emptyByCategory(),
    total: { amount: 0, cases: 0 },
  };

  // Roll up rows into the right month bucket.
  for (const r of rowsR.rows) {
    const monthKey = r.clawback_date ? r.clawback_date.slice(0, 7) : null;
    const bucket = monthKey ? monthsMap.get(monthKey) : unscheduled;
    if (!bucket) continue;
    const amount = Number(r.effective_cb) || 0;
    const cases  = Number(r.cases) || 0;
    bucket.byCategory[r.category].amount += amount;
    bucket.byCategory[r.category].cases  += cases;
    bucket.total.amount += amount;
    bucket.total.cases  += cases;
  }

  // Overall totals across the scope.
  const overallByCategory = emptyByCategory();
  const overallTotal = { amount: 0, cases: 0 };
  for (const m of Array.from(monthsMap.values()).concat([unscheduled])) {
    for (const c of CATEGORY_ORDER) {
      overallByCategory[c].amount += m.byCategory[c].amount;
      overallByCategory[c].cases  += m.byCategory[c].cases;
    }
    overallTotal.amount += m.total.amount;
    overallTotal.cases  += m.total.cases;
  }

  return NextResponse.json({
    year,
    scoped: typeof scope === "number",
    categories: CATEGORY_ORDER,
    months: Array.from(monthsMap.values()),
    unscheduled: unscheduled.total.cases > 0 ? unscheduled : null,
    overall: { byCategory: overallByCategory, total: overallTotal },
  });
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function monthShort(m: number) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
}
