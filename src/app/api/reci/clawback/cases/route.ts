/**
 * GET /api/reci/clawback/cases
 *
 * Returns the case list + summary tiles for the dashboard.
 * Auth-gated to jimmy / pauline / poz.
 *
 * Query params (all optional):
 *   status            one of open|saved|resold|dead|reinstated|closed
 *   bucket            one of adviser|xstaff|legacy|needs_review
 *   adviser_id        integer (only meaningful when bucket=adviser)
 *   warning           exact match against ebah_warning
 *   cb_due_from       ISO date (yyyy-mm-dd) >=
 *   cb_due_to         ISO date (yyyy-mm-dd) <=
 *   cb_min            number, clawback_due >=
 *   cb_max            number, clawback_due <=
 *   master_agent_no   substring match
 *   agent_no          substring match
 *   surname           substring match against client_last_name (Poz wanted
 *                     a surname-specific filter on top of the free-text q)
 *   q                 free-text against client_name / postcode / policy /
 *                     master_agent_no / agent_no
 *   sort              one of cb_desc | cb_due_asc | cb_due_desc | client_asc
 *                     (default cb_desc -- highest exposure first, Poz priority)
 *   limit             default 1000
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

const SORTS: Record<string, string> = {
  cb_desc:     "c.clawback_due DESC NULLS LAST, c.id ASC",
  cb_asc:      "c.clawback_due ASC NULLS LAST, c.id ASC",
  cb_due_asc:  "c.clawback_date ASC NULLS LAST, c.clawback_due DESC NULLS LAST",
  cb_due_desc: "c.clawback_date DESC NULLS LAST, c.clawback_due DESC NULLS LAST",
  client_asc:  "c.client_last_name ASC NULLS LAST, c.client_first_name ASC NULLS LAST",
};

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Seller scope: silently inject c.adviser_id = $scope so the rest of the
  // filter logic works on the restricted set. Admins / viewers see all.
  const scope = await clawbackAdviserScope(session.username);
  if (scope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const status         = searchParams.get("status");
  const bucket         = searchParams.get("bucket");
  const adviserId      = searchParams.get("adviser_id");
  const warning        = searchParams.get("warning");
  const cbDueFrom      = searchParams.get("cb_due_from");
  const cbDueTo        = searchParams.get("cb_due_to");
  const cbMin          = searchParams.get("cb_min");
  const cbMax          = searchParams.get("cb_max");
  const masterAgentNo  = searchParams.get("master_agent_no");
  const agentNo        = searchParams.get("agent_no");
  const surname        = searchParams.get("surname");
  const q              = searchParams.get("q");
  const sortKey        = searchParams.get("sort") || "cb_desc";
  const orderBy        = SORTS[sortKey] || SORTS.cb_desc;
  const limit          = Math.min(Number(searchParams.get("limit") || 1000), 5000);

  // Build a parameterised WHERE clause from the optional filters.
  const where: string[] = [];
  const params: (string | number)[] = [];
  function add(clause: string, value: string | number) {
    params.push(value);
    where.push(clause.replace("$$", `$${params.length}`));
  }
  if (status)        add("c.status = $$",          status);
  // Scoped sellers can't widen out of their own bucket: ignore any bucket
  // or adviser_id query they pass and pin to their adviser_id.
  if (typeof scope === "number") {
    add("c.adviser_id = $$", scope);
  } else {
    if (bucket)      add("c.agent_bucket = $$",    bucket);
    if (adviserId)   add("c.adviser_id = $$",      Number(adviserId));
  }
  if (warning)       add("c.ebah_warning = $$",    warning);
  if (cbDueFrom)     add("c.clawback_date >= $$",  cbDueFrom);
  if (cbDueTo)       add("c.clawback_date <= $$",  cbDueTo);
  if (cbMin)         add("c.clawback_due >= $$",   Number(cbMin));
  if (cbMax)         add("c.clawback_due <= $$",   Number(cbMax));
  if (masterAgentNo) {
    params.push(`%${masterAgentNo}%`);
    where.push(`c.master_agent_no ILIKE $${params.length}`);
  }
  if (agentNo) {
    params.push(`%${agentNo}%`);
    where.push(`c.agent_no ILIKE $${params.length}`);
  }
  if (surname) {
    params.push(`%${surname}%`);
    where.push(`(c.client_last_name ILIKE $${params.length} OR c.client_name ILIKE $${params.length})`);
  }
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
        c.client_dob::text AS client_dob,
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
     ORDER BY ${orderBy}
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

  // Distinct warnings + bucket breakdown for the filter dropdown and tiles.
  // Scope these too so sellers only see their own warnings / a single bucket.
  const scopeFilter = typeof scope === "number" ? `WHERE adviser_id = ${scope}` : "";
  const scopeFilterC = typeof scope === "number" ? `WHERE c.adviser_id = ${scope}` : "";
  const [warningsQ, bucketsQ] = await Promise.all([
    sql.query(
      `SELECT DISTINCT ebah_warning AS warning,
              COUNT(*)::int AS cases,
              COALESCE(SUM(clawback_due), 0)::float AS clawback_due
       FROM clawback_cases
       ${scopeFilter ? scopeFilter + " AND" : "WHERE"} ebah_warning IS NOT NULL
       GROUP BY ebah_warning
       ORDER BY clawback_due DESC NULLS LAST, ebah_warning ASC`,
      [],
    ),
    sql.query(
      `SELECT
          c.agent_bucket,
          a.name AS adviser_name,
          c.adviser_id,
          COUNT(*)::int                        AS cases,
          COALESCE(SUM(c.clawback_due), 0)::float    AS clawback_due,
          COALESCE(SUM(c.net_at_risk), 0)::float     AS net_at_risk
       FROM clawback_cases c
       LEFT JOIN advisers a ON a.id = c.adviser_id
       ${scopeFilterC}
       GROUP BY c.agent_bucket, a.name, c.adviser_id
       ORDER BY clawback_due DESC NULLS LAST`,
      [],
    ),
  ]);

  // Pull recent uploads (last 10) so the dashboard can show last-ingested
  // state. Sellers / viewers don't need to see this -- it's an internal
  // audit log of who uploaded what.
  const uploads = typeof scope === "number" ? { rows: [] } : await sql.query(
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
    buckets: bucketsQ.rows,
    warnings: warningsQ.rows,
    recentUploads: uploads.rows,
  });
}
