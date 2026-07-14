/**
 * GET /api/reci/clawback/credit-report
 *
 * Case-level Credit Control report, v2 statuses (Guy's spec, 10 Jul
 * 2026). Cases grouped by the month the clawback lands (clawback_date),
 * split into forecast months (current onwards + unscheduled) and
 * completed months.
 *
 * Old Openwork cases (source='old_ow', not actualised) are INCLUDED
 * per Guy's 10 Jul ask: every potential clawback visible, whoever it
 * belongs to, whenever it's due, regardless of whether it will
 * actually be debited. They render as a clearly-separated subsection
 * inside each month, same sort order, and carry a running cumulative
 * exposure total. They stay OUT of the month's worked totals so the
 * Off/On numbers still describe money that genuinely moves.
 *
 * Worked/idle rules (reworked per Poz + Guy, 14 Jul 2026):
 *   - "Not worked" = an OPEN, non-historic case with ZERO human
 *     actions ever (no note, contact, £ entry or status change).
 *     Once an adviser has attempted contact or noted the case it
 *     counts as worked even if unresolved, and a case in any worked
 *     status can never be Not Worked.
 *   - last_contact_at = the most recent contact_attempt, surfaced as
 *     "Last contacted" with Guy's bands (1-4 / 5-8 / 8+ days) applied
 *     to open cases only. Historic Old OW cases are parked: never
 *     flagged.
 *
 * Auth: any clawback user; junior sellers see only their own cases.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";
import {
  NEGATIVE_STATUSES, POSITIVE_STATUSES, type CaseStatus,
} from "@/lib/reci/status";

export const dynamic = "force-dynamic";

interface CaseRow {
  id: number;
  policy_number: string;
  provider: string;
  client_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  postcode: string | null;
  policy_type: string | null;
  seller: string;
  trigger: string | null;
  net_premium: number | null;
  clawback: number;
  status: string;
  lost_reason: string | null;
  redraw_off: number;
  redraw_on: number;
  saved_amount: number;
  resold_amount: number;
  latest_note: string | null;
  last_action_at: string | null;
  last_contact_at: string | null;
  stale: boolean;
  clawback_date: string | null;
  historic_ow: boolean;
}

/** Per-month money totals in Guy's v2 vocabulary. */
export interface MonthTotals {
  exposure: number;
  outstanding: number;
  /** £ per status key, e.g. lost_cfo, saved_lapse ... */
  byStatus: Record<string, number>;
  /** dead_client + post_completion combined ("Other" column). */
  other: number;
  neg: number;   // Total Off's
  pos: number;   // Total On's
  net: number;   // exposure - pos (Guy-confirmed formula)
  staleCount: number;
  cases: number;
}

function emptyTotals(): MonthTotals {
  const byStatus: Record<string, number> = {};
  for (const s of [...NEGATIVE_STATUSES, ...POSITIVE_STATUSES]) byStatus[s] = 0;
  return {
    exposure: 0, outstanding: 0, byStatus, other: 0,
    neg: 0, pos: 0, net: 0, staleCount: 0, cases: 0,
  };
}

function totalsFor(rows: CaseRow[]): MonthTotals {
  const t = emptyTotals();
  t.cases = rows.length;
  for (const c of rows) {
    t.exposure += c.clawback;
    if (c.status === "open") t.outstanding += c.clawback;
    if (c.status in t.byStatus) t.byStatus[c.status] += c.clawback;
    if ((NEGATIVE_STATUSES as readonly string[]).includes(c.status)) t.neg += c.clawback;
    if ((POSITIVE_STATUSES as readonly string[]).includes(c.status)) t.pos += c.clawback;
    if (c.status === "dead_client" || c.status === "post_completion") t.other += c.clawback;
    if (c.stale) t.staleCount++;
  }
  t.net = t.exposure - t.pos;
  return t;
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
  const scopeWhere = typeof scope === "number" ? `AND c.adviser_id = ${scope}` : "";

  const { searchParams } = new URL(req.url);
  const staleDays = Math.min(60, Math.max(1, Number(searchParams.get("stale_days") || 3)));

  const r = await sql.query<{
    id: number; policy_number: string; provider: string;
    client_name: string; client_first_name: string | null; client_last_name: string | null;
    postcode: string | null; policy_type: string | null;
    seller: string; trigger: string | null;
    net_premium: string | null; clawback: string | null;
    status: string; lost_reason: string | null;
    redraw_off: string; redraw_on: string;
    saved_amount: string; resold_amount: string;
    latest_note: string | null;
    last_action_at: string | null;
    last_contact_at: string | null;
    action_count: string;
    created_at: string;
    clawback_date: string | null;
    historic_ow: boolean;
  }>(
    `SELECT
        c.id, c.policy_number, c.provider,
        c.client_name, c.client_first_name, c.client_last_name,
        c.postcode, c.policy_type,
        COALESCE(a.name,
          CASE c.agent_bucket
            WHEN 'xstaff' THEN 'Xstaff'
            WHEN 'legacy' THEN 'Legacy'
            ELSE 'Needs review'
          END)                                        AS seller,
        c.ebah_warning                                AS trigger,
        c.net_premium::text                           AS net_premium,
        COALESCE(c.final_clawback_due, c.clawback_due)::text AS clawback,
        c.status, c.lost_reason,
        c.redraw_off_amount::text                     AS redraw_off,
        c.redraw_on_amount::text                      AS redraw_on,
        c.saved_amount::text                          AS saved_amount,
        c.resold_amount::text                         AS resold_amount,
        ln.note                                       AS latest_note,
        la.last_action_at::text                       AS last_action_at,
        la.action_count::text                         AS action_count,
        lc.last_contact_at::text                      AS last_contact_at,
        c.created_at::text                            AS created_at,
        c.clawback_date::text                         AS clawback_date,
        (c.source = 'old_ow' AND c.ow_actualised_at IS NULL) AS historic_ow
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     LEFT JOIN LATERAL (
       SELECT h.note
       FROM clawback_history h
       WHERE h.case_id = c.id
         AND h.event_type IN ('note','contact_attempt','status_change')
         AND h.note IS NOT NULL AND h.note <> ''
       ORDER BY h.created_at DESC
       LIMIT 1
     ) ln ON true
     LEFT JOIN LATERAL (
       SELECT MAX(h.created_at) AS last_action_at,
              COUNT(*)          AS action_count
       FROM clawback_history h
       WHERE h.case_id = c.id
         AND h.event_type IN ('note','contact_attempt','money_off','status_change')
     ) la ON true
     LEFT JOIN LATERAL (
       SELECT MAX(h.created_at) AS last_contact_at
       FROM clawback_history h
       WHERE h.case_id = c.id AND h.event_type = 'contact_attempt'
     ) lc ON true
     WHERE c.deleted_at IS NULL
       ${scopeWhere}
     ORDER BY c.clawback_date ASC NULLS LAST`,
    [],
  );

  const num = (v: string | null) => (v === null ? null : Number(v) || 0);

  const cases: CaseRow[] = r.rows.map((row) => {
    // "Not worked" = open, live book, and NOBODY has ever actioned it.
    // A contact attempt, note, £ entry or status change counts as
    // worked even while the case stays open (Poz + Guy, 14 Jul 2026).
    const stale = row.status === "open"
      && !row.historic_ow
      && (Number(row.action_count) || 0) === 0;
    return {
      id: row.id,
      policy_number: row.policy_number,
      provider: row.provider,
      client_name: row.client_name,
      client_first_name: row.client_first_name,
      client_last_name: row.client_last_name,
      postcode: row.postcode,
      policy_type: row.policy_type,
      seller: row.seller,
      trigger: row.trigger,
      net_premium: num(row.net_premium),
      clawback: num(row.clawback) ?? 0,
      status: row.status as CaseStatus,
      lost_reason: row.lost_reason,
      redraw_off: num(row.redraw_off) ?? 0,
      redraw_on: num(row.redraw_on) ?? 0,
      saved_amount: num(row.saved_amount) ?? 0,
      resold_amount: num(row.resold_amount) ?? 0,
      latest_note: row.latest_note,
      last_action_at: row.last_action_at,
      last_contact_at: row.last_contact_at,
      stale,
      clawback_date: row.clawback_date,
      historic_ow: row.historic_ow,
    };
  });

  // Group by clawback month. Cases without a clawback_date land in an
  // "Unscheduled" bucket shown with the forecast section.
  const currentMonthKey = new Date().toISOString().slice(0, 7);
  const monthsMap = new Map<string, CaseRow[]>();
  for (const c of cases) {
    const key = c.clawback_date ? c.clawback_date.slice(0, 7) : "unscheduled";
    const arr = monthsMap.get(key);
    if (arr) arr.push(c); else monthsMap.set(key, [c]);
  }

  const monthLabel = (key: string) => {
    if (key === "unscheduled") return "Unscheduled (no CB date)";
    const [y, m] = key.split("-").map(Number);
    const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
    return `${MONTHS[m - 1]} ${y}`;
  };

  // Guy's ordering: seller asc, clawback desc.
  const sortRows = (rows: CaseRow[]) =>
    rows.slice().sort((a, b) =>
      a.seller.localeCompare(b.seller) || b.clawback - a.clawback);

  interface MonthBlock {
    key: string; label: string;
    cases: CaseRow[]; totals: MonthTotals;
    oldOw: CaseRow[]; oldOwExposure: number; oldOwRunning: number;
  }
  const forecast: MonthBlock[] = [];
  const completed: MonthBlock[] = [];
  const keys = Array.from(monthsMap.keys()).sort();
  for (const key of keys) {
    const all = monthsMap.get(key)!;
    const current = sortRows(all.filter((c) => !c.historic_ow));
    const oldOw = sortRows(all.filter((c) => c.historic_ow));
    const block: MonthBlock = {
      key,
      label: monthLabel(key),
      cases: current,
      totals: totalsFor(current),
      oldOw,
      oldOwExposure: oldOw.reduce((n, c) => n + c.clawback, 0),
      oldOwRunning: 0, // filled below in chronological order
    };
    if (key === "unscheduled" || key >= currentMonthKey) forecast.push(block);
    else completed.push(block);
  }
  forecast.sort((a, b) => {
    if (a.key === "unscheduled") return 1;
    if (b.key === "unscheduled") return -1;
    return a.key.localeCompare(b.key);
  });
  // Running Old OW exposure accumulates chronologically (completed
  // first, then forecast) so each month shows the total unrecovered
  // Old OW clawback up to and including that month, UFN per Poz.
  let running = 0;
  const chronological = [...completed, ...forecast];
  for (const block of chronological) {
    running += block.oldOwExposure;
    block.oldOwRunning = running;
  }
  completed.reverse(); // newest first for display

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    staleDays,
    scoped: typeof scope === "number",
    forecast,
    completed,
    oldOwGrandTotal: running,
  });
}
