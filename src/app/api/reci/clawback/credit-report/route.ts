/**
 * GET /api/reci/clawback/credit-report
 *
 * Case-level Credit Control report, built to Guy's mock-up (6 Jul 2026).
 * The Reports page gives him per-seller totals; this gives the detail
 * evidence behind them: every case, grouped by the month its clawback
 * lands (clawback_date), split into
 *
 *   - forecast months (current month onwards, includes unscheduled)
 *   - completed months (past)
 *
 * Each case row carries client, policy, seller, trigger (L&G warning),
 * monthly premium, CB £, status, the latest human note, and a stale
 * flag: an OPEN case with no note / contact / £ / status action in the
 * last `stale_days` days (query param, default 3) is "not worked" and
 * the UI paints it red.
 *
 * Historic Old OW cases (source=old_ow, not actualised) are excluded,
 * consistent with the executive summary: they'd inflate every historic
 * month with exposure that statistically never lands.
 *
 * Query params:
 *   stale_days  integer, default 3
 *
 * Auth: any clawback user; junior sellers see only their own cases.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

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
  stale: boolean;
  clawback_date: string | null;
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
    created_at: string;
    clawback_date: string | null;
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
        c.created_at::text                            AS created_at,
        c.clawback_date::text                         AS clawback_date
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
       SELECT MAX(h.created_at) AS last_action_at
       FROM clawback_history h
       WHERE h.case_id = c.id
         AND h.event_type IN ('note','contact_attempt','money_off','status_change')
     ) la ON true
     WHERE c.deleted_at IS NULL
       AND NOT (c.source = 'old_ow' AND c.ow_actualised_at IS NULL)
       ${scopeWhere}
     ORDER BY c.clawback_date ASC NULLS LAST`,
    [],
  );

  const now = Date.now();
  const staleMs = staleDays * 24 * 60 * 60 * 1000;
  const num = (v: string | null) => (v === null ? null : Number(v) || 0);

  const cases: CaseRow[] = r.rows.map((row) => {
    const lastTouch = row.last_action_at ?? row.created_at;
    const stale = row.status === "open"
      && (now - new Date(lastTouch).getTime()) > staleMs;
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
      status: row.status,
      lost_reason: row.lost_reason,
      redraw_off: num(row.redraw_off) ?? 0,
      redraw_on: num(row.redraw_on) ?? 0,
      saved_amount: num(row.saved_amount) ?? 0,
      resold_amount: num(row.resold_amount) ?? 0,
      latest_note: row.latest_note,
      last_action_at: row.last_action_at,
      stale,
      clawback_date: row.clawback_date,
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

  function totalsFor(rows: CaseRow[]) {
    const t = {
      exposure: 0, outstanding: 0, reinstated: 0, resold: 0,
      saved: 0, redrawNet: 0, lost: 0, staleCount: 0, cases: rows.length,
    };
    for (const c of rows) {
      t.exposure += c.clawback;
      if (c.status === "open") t.outstanding += c.clawback;
      if (c.status === "reinstated") t.reinstated += c.clawback;
      if (c.status === "resold") t.resold += c.resold_amount || c.clawback;
      if (c.status === "saved") t.saved += c.saved_amount || c.clawback;
      if (c.status === "redraw") t.redrawNet += c.redraw_on - c.redraw_off;
      if (c.status === "dead") t.lost += c.clawback;
      if (c.stale) t.staleCount++;
    }
    return t;
  }

  // Sort within each month: seller asc, clawback desc (Guy's ordering).
  const sortRows = (rows: CaseRow[]) =>
    rows.slice().sort((a, b) =>
      a.seller.localeCompare(b.seller) || b.clawback - a.clawback);

  const forecast: { key: string; label: string; cases: CaseRow[]; totals: ReturnType<typeof totalsFor> }[] = [];
  const completed: typeof forecast = [];
  const keys = Array.from(monthsMap.keys()).sort();
  for (const key of keys) {
    const rows = sortRows(monthsMap.get(key)!);
    const block = { key, label: monthLabel(key), cases: rows, totals: totalsFor(rows) };
    if (key === "unscheduled" || key >= currentMonthKey) forecast.push(block);
    else completed.push(block);
  }
  // Completed months newest first; forecast oldest (nearest) first with
  // unscheduled at the end.
  completed.reverse();
  forecast.sort((a, b) => {
    if (a.key === "unscheduled") return 1;
    if (b.key === "unscheduled") return -1;
    return a.key.localeCompare(b.key);
  });

  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    staleDays,
    scoped: typeof scope === "number",
    forecast,
    completed,
  });
}
