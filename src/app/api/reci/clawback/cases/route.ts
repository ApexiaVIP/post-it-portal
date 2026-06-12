/**
 * GET /api/reci/clawback/cases
 *
 * Returns the case list + summary tiles for the dashboard.
 * Auth-gated to jimmy / pauline / poz.
 *
 * Query params (all optional):
 *   status        one of open|saved|resold|dead|reinstated|closed
 *   bucket        one of adviser|xstaff|legacy|needs_review
 *   adviser_id    integer (only meaningful when bucket=adviser)
 *   q             free-text match on client_name / postcode / policy_number
 *   limit         default 1000
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const status     = searchParams.get("status");
  const bucket     = searchParams.get("bucket");
  const adviserId  = searchParams.get("adviser_id");
  const q          = searchParams.get("q");
  const limit      = Math.min(Number(searchParams.get("limit") || 1000), 5000);

  // Build a parameterised WHERE clause from the optional filters.
  const where: string[] = [];
  const params: (string | number)[] = [];
  function add(clause: string, value: string | number) {
    params.push(value);
    where.push(clause.replace("$$", `$${params.length}`));
  }
  if (status)    add("c.status = $$",       status);
  if (bucket)    add("c.agent_bucket = $$", bucket);
  if (adviserId) add("c.adviser_id = $$",   Number(adviserId));
  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    where.push(
      `(c.client_name ILIKE $${p} OR c.postcode ILIKE $${p} OR c.policy_number ILIKE $${p} ` +
      ` OR c.master_agent_no ILIKE $${p} OR c.agent_no ILIKE $${p})`,
    );
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  const limitParam = `$${params.length}`;

  const casesQ = await sql.query(
    `SELECT
        c.id,
        c.policy_number,
        c.provider,
        c.client_name,
        c.client_first_name,
        c.client_last_name,
        c.postcode,
        c.policy_type,
        c.net_premium,
        c.premium_outstanding,
        c.clawback_due,
        c.clawback_date::text AS clawback_date,
        c.policy_start_date::text AS policy_start_date,
        c.off_risk_date::text AS off_risk_date,
        c.ebah_agent_name,
        c.master_agent_no,
        c.agent_no,
        c.ebah_warning,
        c.status,
        c.status_note,
        c.saved_amount,
        c.resold_amount,
        c.net_at_risk,
        c.notification_week,
        c.notification_year,
        c.adviser_id,
        a.name AS adviser_name,
        c.agent_bucket,
        c.updated_at
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     ${whereSql}
     ORDER BY c.clawback_due DESC NULLS LAST, c.id ASC
     LIMIT ${limitParam}`,
    params,
  );

  // Summary tiles -- same filter set, so the tiles reflect the visible view.
  const tilesQ = await sql.query(
    `SELECT
        COUNT(*)::int                        AS total_cases,
        COALESCE(SUM(c.clawback_due), 0)::float    AS total_clawback_due,
        COALESCE(SUM(c.saved_amount), 0)::float    AS total_saved,
        COALESCE(SUM(c.resold_amount), 0)::float   AS total_resold,
        COALESCE(SUM(c.net_at_risk), 0)::float     AS total_net_at_risk
     FROM clawback_cases c
     ${whereSql}`,
    params.slice(0, params.length - 1), // drop the trailing limit param
  );

  // Group tiles by bucket so we can render Tan / Hayder / Xstaff / Legacy
  // exposure side by side without a second round-trip.
  const buckets = await sql.query(
    `SELECT
        c.agent_bucket,
        a.name AS adviser_name,
        c.adviser_id,
        COUNT(*)::int                        AS cases,
        COALESCE(SUM(c.clawback_due), 0)::float    AS clawback_due,
        COALESCE(SUM(c.net_at_risk), 0)::float     AS net_at_risk
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     GROUP BY c.agent_bucket, a.name, c.adviser_id
     ORDER BY clawback_due DESC NULLS LAST`,
    [],
  );

  // Pull recent uploads (last 10) so the dashboard can show last-ingested state.
  const uploads = await sql.query(
    `SELECT id, filename, uploaded_by,
            uploaded_at AT TIME ZONE 'Europe/London' AS uploaded_at,
            report_date::text AS report_date,
            rows_total, rows_inserted, rows_updated,
            rows_unchanged, rows_unmatched
     FROM clawback_uploads
     ORDER BY uploaded_at DESC
     LIMIT 10`,
    [],
  );

  return NextResponse.json({
    cases: casesQ.rows,
    summary: tilesQ.rows[0] ?? null,
    buckets: buckets.rows,
    recentUploads: uploads.rows,
  });
}
