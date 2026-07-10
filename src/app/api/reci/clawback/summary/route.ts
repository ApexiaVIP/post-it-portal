/**
 * GET /api/reci/clawback/summary
 *
 * Executive summary for Guy. Six headline tiles:
 *
 *   - On the books:    every case, every status, sum of effective CB
 *   - Lost:            status='dead' (the LOST status; clawback went through)
 *   - Resolved:        status in (saved, resold, reinstated)
 *                      Broken down by saved_amount / resold_amount totals
 *   - Urgent:          source='new_ow' AND still active (open/reinstated)
 *   - Pending action:  status='open' AND no human action ever logged
 *                      (no note / contact / money_off / status_change row)
 *   - Actively worked: status='open' AND at least one human action logged
 *
 * Net exposure = on_books - (saved + resold).
 *
 * Scoped seller users see only their own caseload (same gate as the
 * dashboard).  Admins + senior sellers + Guy see everything.
 *
 * Auth: any clawback user.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scope = await clawbackAdviserScope(session.username);
  if (scope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scopeWhere = typeof scope === "number" ? `AND c.adviser_id = ${scope}` : "";

  // Single query: pull every case + a left-joined "has any human action"
  // flag from clawback_history. FILTER (WHERE ...) lets us aggregate
  // each tile from the same scan.
  const r = await sql.query<{
    total_amount: string; total_cases: string;
    lost_amount: string; lost_cases: string;
    resolved_amount: string; resolved_cases: string;
    saved_amount_total: string; resold_amount_total: string;
    reinstated_cases: string;
    urgent_amount: string; urgent_cases: string;
    pending_amount: string; pending_cases: string;
    active_amount: string; active_cases: string;
    historic_ow_amount: string; historic_ow_cases: string;
    redraw_amount: string; redraw_cases: string;
    redraw_off_total: string; redraw_on_total: string;
  }>(
    `WITH effective AS (
       SELECT c.id, c.status, c.source, c.ow_actualised_at,
              COALESCE(c.final_clawback_due, c.clawback_due)::numeric AS effective_cb,
              c.saved_amount, c.resold_amount,
              c.redraw_off_amount, c.redraw_on_amount,
              -- Historic Old OW = old_ow source that Poz hasn't actualised
              -- yet. Excluded from current at-risk buckets so Guy's
              -- headline figures aren't inflated by exposure that
              -- statistically never lands.
              (c.source = 'old_ow' AND c.ow_actualised_at IS NULL) AS is_historic_ow
       FROM clawback_cases c
       WHERE c.deleted_at IS NULL ${scopeWhere}
     ),
     activity AS (
       SELECT h.case_id, COUNT(*) FILTER (
         WHERE h.event_type IN ('note','contact_attempt','money_off','status_change')
       ) AS action_n
       FROM clawback_history h
       GROUP BY h.case_id
     )
     SELECT
       COALESCE(SUM(e.effective_cb), 0)::text                          AS total_amount,
       COUNT(*)::text                                                  AS total_cases,

       -- Negatives (Off statuses) = lost. Positives (On statuses) =
       -- resolved. V2 taxonomy, 10 Jul 2026.
       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.status IN ('lost_cfo','lost_lapse','resold_off','redraw_off','dd_cancelled','bp_off','dead_client','post_completion')), 0)::text AS lost_amount,
       COUNT(*) FILTER (WHERE e.status IN ('lost_cfo','lost_lapse','resold_off','redraw_off','dd_cancelled','bp_off','dead_client','post_completion'))::text AS lost_cases,

       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.status IN ('saved_cfo','saved_lapse','resold_on','redraw_on','dd_reinstated','bp_saved')), 0)::text  AS resolved_amount,
       COUNT(*) FILTER (WHERE e.status IN ('saved_cfo','saved_lapse','resold_on','redraw_on','dd_reinstated','bp_saved'))::text AS resolved_cases,
       COALESCE(SUM(e.saved_amount), 0)::text                          AS saved_amount_total,
       COALESCE(SUM(e.resold_amount), 0)::text                         AS resold_amount_total,
       COUNT(*) FILTER (WHERE e.status = 'dd_reinstated')::text        AS reinstated_cases,

       -- Urgent, Pending, Active all exclude historic OW so they
       -- reflect the current book we're actually working.
       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.source = 'new_ow'
                   AND e.status = 'open'
                   AND NOT e.is_historic_ow), 0)::text                  AS urgent_amount,
       COUNT(*) FILTER (WHERE e.source = 'new_ow'
                          AND e.status = 'open'
                          AND NOT e.is_historic_ow)::text               AS urgent_cases,

       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.status = 'open'
                   AND COALESCE(a.action_n, 0) = 0
                   AND NOT e.is_historic_ow), 0)::text                  AS pending_amount,
       COUNT(*) FILTER (WHERE e.status = 'open'
                          AND COALESCE(a.action_n, 0) = 0
                          AND NOT e.is_historic_ow)::text               AS pending_cases,

       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.status = 'open'
                   AND COALESCE(a.action_n, 0) > 0
                   AND NOT e.is_historic_ow), 0)::text                  AS active_amount,
       COUNT(*) FILTER (WHERE e.status = 'open'
                          AND COALESCE(a.action_n, 0) > 0
                          AND NOT e.is_historic_ow)::text               AS active_cases,

       -- Historic OW: Old OW cases Poz hasn't marked actualised.
       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.is_historic_ow), 0)::text                      AS historic_ow_amount,
       COUNT(*) FILTER (WHERE e.is_historic_ow)::text                   AS historic_ow_cases,

       -- Redraw: net = on - off across all cases in either redraw status.
       COALESCE(SUM(e.effective_cb)
         FILTER (WHERE e.status IN ('redraw_on','redraw_off')), 0)::text AS redraw_amount,
       COUNT(*) FILTER (WHERE e.status IN ('redraw_on','redraw_off'))::text AS redraw_cases,
       COALESCE(SUM(e.redraw_off_amount)
         FILTER (WHERE e.status IN ('redraw_on','redraw_off')), 0)::text AS redraw_off_total,
       COALESCE(SUM(e.redraw_on_amount)
         FILTER (WHERE e.status IN ('redraw_on','redraw_off')), 0)::text AS redraw_on_total

     FROM effective e
     LEFT JOIN activity a ON a.case_id = e.id`,
    [],
  );

  const row = r.rows[0];
  const num = (v: string) => Number(v) || 0;
  const int = (v: string) => Math.trunc(num(v));

  const totalAmount    = num(row.total_amount);
  const savedAmount    = num(row.saved_amount_total);
  const resoldAmount   = num(row.resold_amount_total);
  const netExposure    = Math.max(0, totalAmount - savedAmount - resoldAmount);
  const redrawOff      = num(row.redraw_off_total);
  const redrawOn       = num(row.redraw_on_total);

  return NextResponse.json({
    scoped: typeof scope === "number",
    onBooks:    { amount: totalAmount,                    cases: int(row.total_cases) },
    netExposure,
    lost:       { amount: num(row.lost_amount),           cases: int(row.lost_cases) },
    resolved:   {
      amount: num(row.resolved_amount),
      cases: int(row.resolved_cases),
      savedAmount,
      resoldAmount,
      reinstatedCases: int(row.reinstated_cases),
    },
    urgent:     { amount: num(row.urgent_amount),         cases: int(row.urgent_cases) },
    pending:    { amount: num(row.pending_amount),        cases: int(row.pending_cases) },
    active:     { amount: num(row.active_amount),         cases: int(row.active_cases) },
    historicOw: { amount: num(row.historic_ow_amount),    cases: int(row.historic_ow_cases) },
    redraw:     {
      amount: num(row.redraw_amount),
      cases: int(row.redraw_cases),
      offTotal: redrawOff,
      onTotal:  redrawOn,
      netTotal: redrawOn - redrawOff,
    },
  });
}
