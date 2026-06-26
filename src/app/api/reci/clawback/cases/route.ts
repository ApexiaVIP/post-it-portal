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
import { sql, db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin, clawbackAdviserScope } from "@/lib/auth";
import { sendClawbackNotifyEmail } from "@/lib/reci/email";
import { sourceForMasterCode } from "@/lib/reci/clawback-source";

export const dynamic = "force-dynamic";

const SORTS: Record<string, string> = {
  cb_desc:      "c.clawback_due DESC NULLS LAST, c.id ASC",
  cb_asc:       "c.clawback_due ASC NULLS LAST, c.id ASC",
  cb_due_asc:   "c.clawback_date ASC NULLS LAST, c.clawback_due DESC NULLS LAST",
  cb_due_desc:  "c.clawback_date DESC NULLS LAST, c.clawback_due DESC NULLS LAST",
  client_asc:   "c.client_last_name ASC NULLS LAST, c.client_first_name ASC NULLS LAST",
  // Tidy-up sort (Pauline): clusters every case at the same postcode
  // together, then alphabetical within each postcode bucket. Lets her
  // spot duplicates / households fast when reconciling cases.
  postcode_asc: "c.postcode ASC NULLS LAST, c.client_last_name ASC NULLS LAST, c.client_first_name ASC NULLS LAST",
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
  const source         = searchParams.get("source");
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
  if (source) {
    if (source === "unset") {
      where.push("c.source IS NULL");
    } else {
      add("c.source = $$", source);
    }
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
        c.openwork_clawback_due,
        c.openwork_cb_updated_by,
        c.openwork_cb_updated_at,
        c.final_clawback_due,
        c.final_cb_updated_by,
        c.final_cb_updated_at,
        COALESCE(c.final_clawback_due, c.openwork_clawback_due, c.clawback_due) AS effective_clawback_due,
        c.clawback_date::text AS clawback_date,
        c.policy_start_date::text AS policy_start_date,
        c.off_risk_date::text AS off_risk_date,
        c.ebah_agent_name,
        c.master_agent_no,
        c.agent_no,
        c.source,
        c.source_updated_by,
        c.source_updated_at,
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
  // CB due uses the Openwork override when Pauline has set one, otherwise
  // the provider (L&G EBAH) figure. net_at_risk is a generated column that
  // already uses the same COALESCE, so they stay in sync.
  const tilesQ = await sql.query(
    `SELECT
        COUNT(*)::int                                                       AS total_cases,
        COALESCE(SUM(COALESCE(c.final_clawback_due, c.openwork_clawback_due, c.clawback_due)), 0)::float
                                                                            AS total_clawback_due,
        COALESCE(SUM(c.clawback_due), 0)::float                             AS total_clawback_due_provider,
        COALESCE(SUM(c.openwork_clawback_due), 0)::float                    AS total_clawback_due_openwork,
        COALESCE(SUM(c.saved_amount), 0)::float                             AS total_saved,
        COALESCE(SUM(c.resold_amount), 0)::float                            AS total_resold,
        COALESCE(SUM(c.net_at_risk), 0)::float                              AS total_net_at_risk
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
          COUNT(*)::int                                                       AS cases,
          COALESCE(SUM(COALESCE(c.final_clawback_due, c.openwork_clawback_due, c.clawback_due)), 0)::float
                                                                              AS clawback_due,
          COALESCE(SUM(c.net_at_risk), 0)::float                              AS net_at_risk
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

/**
 * POST /api/reci/clawback/cases
 *
 * Manually add a single clawback case to the dashboard. Used by Poz when a
 * notification arrives via a path that isn't yet wired into an automatic
 * ingest (Aviva email, LV email, Royal London spreadsheet, etc.). Admin
 * only -- sellers / viewers can't create cases.
 *
 * Body (JSON):
 *   policy_number*       string (must be unique)
 *   provider*            string (lowercase: 'l&g' | 'aviva' | 'lv' | ...)
 *   client_first_name*   string
 *   client_last_name*    string
 *   client_dob           ISO date or null
 *   client_email         string or null
 *   client_phone         string or null
 *   postcode             string or null
 *   address              string or null
 *   policy_type          string or null
 *   net_premium          number or null
 *   premium_outstanding  number or null
 *   policy_start_date    ISO date or null
 *   off_risk_date        ISO date or null
 *   clawback_due*        number (default 0)
 *   clawback_date        ISO date or null
 *   ebah_warning*        string (the Status / Warning category)
 *   adviser_id           number | null  (null => xstaff or legacy)
 *   agent_bucket*        'adviser' | 'xstaff' | 'legacy'
 *   ebah_agent_name*     string (sales agent name; required for all buckets
 *                                so the case carries a human-readable owner)
 *   master_agent_no      string or null
 *   agent_no             string or null
 *   source               'old_ow' | 'new_ow' | 'other' | null
 *   initial_note         string or null (logged to history if set)
 *
 * Returns: { ok: true, id }   on success
 *          { error: '...' }   on validation / conflict failure
 */
export async function POST(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !isClawbackAdmin(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "expected JSON body" }, { status: 400 });
  }
  type Input = Partial<{
    policy_number: string; provider: string;
    client_first_name: string; client_last_name: string;
    client_dob: string; client_email: string; client_phone: string;
    postcode: string; address: string; policy_type: string;
    net_premium: number; premium_outstanding: number;
    policy_start_date: string; off_risk_date: string;
    clawback_due: number; clawback_date: string;
    ebah_warning: string;
    adviser_id: number | null; agent_bucket: string; ebah_agent_name: string;
    master_agent_no: string; agent_no: string;
    source: string;
    initial_note: string;
  }>;
  const b = body as Input;

  // ---- Validation -------------------------------------------------------
  function str(v: unknown): string | null {
    if (typeof v !== "string") return null;
    const t = v.trim();
    return t.length === 0 ? null : t;
  }
  function num(v: unknown): number | null {
    if (v === null || v === undefined || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  function date(v: unknown): string | null {
    const s = str(v);
    if (!s) return null;
    return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
  }

  const policyNumber = str(b.policy_number);
  const provider     = (str(b.provider) || "l&g").toLowerCase();
  const firstName    = str(b.client_first_name);
  const lastName     = str(b.client_last_name);
  const warning      = str(b.ebah_warning);
  const agentBucket  = str(b.agent_bucket);
  const agentName    = str(b.ebah_agent_name);
  const adviserId    = b.adviser_id === null || b.adviser_id === undefined ? null : Number(b.adviser_id);

  const errors: string[] = [];
  if (!policyNumber)    errors.push("policy_number is required");
  if (!provider)        errors.push("provider is required");
  if (!firstName)       errors.push("client_first_name is required");
  if (!lastName)        errors.push("client_last_name is required");
  if (!warning)         errors.push("ebah_warning is required");
  if (!agentName)       errors.push("ebah_agent_name is required");
  if (!agentBucket || !["adviser","xstaff","legacy"].includes(agentBucket)) {
    errors.push("agent_bucket must be adviser | xstaff | legacy");
  }
  if (agentBucket === "adviser" && (adviserId === null || !Number.isFinite(adviserId))) {
    errors.push("adviser_id is required when agent_bucket is 'adviser'");
  }
  // Manual source override from the form (Pauline can flag old_ow / new_ow /
  // other directly). If not provided, fall back to the auto mapping from
  // master_agent_no (5930268 -> new_ow, etc).
  let source = str(b.source);
  if (source && !["old_ow","new_ow","other"].includes(source)) {
    errors.push("source must be old_ow | new_ow | other | null");
  }
  if (!source) {
    const masterCode = str(b.master_agent_no);
    source = sourceForMasterCode(masterCode);
  }
  if (errors.length > 0) {
    return NextResponse.json({ error: errors.join("; ") }, { status: 400 });
  }

  // Cross-check the adviser_id exists if provided.
  if (agentBucket === "adviser" && adviserId !== null) {
    const a = await sql<{ id: number }>`SELECT id FROM advisers WHERE id = ${adviserId} LIMIT 1`;
    if (a.rowCount === 0) {
      return NextResponse.json({ error: "adviser_id not found" }, { status: 400 });
    }
  }

  const clientName = `${firstName} ${lastName}`.trim();
  const clawbackDue = num(b.clawback_due) ?? 0;

  // ---- Insert ----------------------------------------------------------
  // Wrap insert + history in a transaction so a failure after the insert
  // doesn't leave a case without an opening history row.
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // Check for an existing case on the same policy number first so we can
    // return a clean 409 rather than a generic UNIQUE violation.
    const dup = await client.query<{ id: number }>(
      `SELECT id FROM clawback_cases WHERE policy_number = $1 LIMIT 1`,
      [policyNumber],
    );
    if ((dup.rowCount ?? 0) > 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({
        error: `Policy ${policyNumber} already exists on the dashboard`,
        existingId: dup.rows[0].id,
      }, { status: 409 });
    }

    const ins = await client.query<{ id: number }>(
      `INSERT INTO clawback_cases (
        policy_number, provider, client_name, client_first_name, client_last_name,
        client_dob, client_email, client_phone, postcode, address,
        policy_type, net_premium, premium_outstanding, policy_start_date,
        off_risk_date, clawback_due, clawback_date, ebah_agent_name,
        adviser_id, agent_bucket, ebah_warning,
        master_agent_no, agent_no, source
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, $8, $9, $10,
        $11, $12, $13, $14,
        $15, $16, $17, $18,
        $19, $20, $21,
        $22, $23, $24
      )
      RETURNING id`,
      [
        policyNumber, provider, clientName, firstName, lastName,
        date(b.client_dob), str(b.client_email), str(b.client_phone),
        str(b.postcode), str(b.address),
        str(b.policy_type), num(b.net_premium), num(b.premium_outstanding),
        date(b.policy_start_date), date(b.off_risk_date),
        clawbackDue, date(b.clawback_date), agentName,
        agentBucket === "adviser" ? adviserId : null, agentBucket, warning,
        str(b.master_agent_no), str(b.agent_no),
        source,
      ],
    );
    const newId = ins.rows[0].id;

    await client.query(
      `INSERT INTO clawback_history (case_id, event_type, actor, note)
       VALUES ($1, 'created', $2, $3)`,
      [newId, session.username, `Created manually by ${session.username}`],
    );
    const openingNote = str(b.initial_note);
    if (openingNote) {
      await client.query(
        `INSERT INTO clawback_history (case_id, event_type, actor, note)
         VALUES ($1, 'note', $2, $3)`,
        [newId, session.username, openingNote],
      );
    }

    await client.query("COMMIT");

    // ---- Auto-Notify ------------------------------------------------------
    // Same rule as the EBAH ingest auto-Notify: fire the Notify email
    // immediately if clawback_due > 0. Routes via existing helper (CAM
    // for adviser cases, Tan + Hayder for Xstaff, Guy + management for
    // Legacy). Stamps notified_at + writes an email_sent history row on
    // success. Failures are logged but don't fail the case creation --
    // Pauline can re-Notify manually from the drawer.
    let emailResult: { sent: boolean; reason?: string } | null = null;
    if (clawbackDue > 0) {
      try {
        emailResult = await sendClawbackNotifyEmail({
          caseId:         newId,
          clientName,
          clientDob:      date(b.client_dob),
          policyNumber:   policyNumber!,
          postcode:       str(b.postcode),
          provider,
          policyType:     str(b.policy_type),
          ebahWarning:    warning,
          clawbackDate:   date(b.clawback_date),
          // Manual entries don't come from an EBAH file, so no report date.
          ebahReportDate: null,
          ebahAgentName:  agentName!,
          adviserId:      agentBucket === "adviser" ? adviserId : null,
          agentBucket:    agentBucket!,
          source,         // null or auto-mapped from master_agent_no above
          pozNote:        str(b.initial_note),
          actor:          session.username!,
        });
        if (emailResult.sent) {
          await sql`
            UPDATE clawback_cases
            SET notified_at = COALESCE(notified_at, now()), updated_at = now()
            WHERE id = ${newId}
          `;
          await sql`
            INSERT INTO clawback_history (case_id, event_type, note, actor)
            VALUES (${newId}, 'email_sent', ${'Auto-notification fired on manual case create'}, ${session.username})
          `;
        } else {
          console.error(`[clawback-new-case] notify failed for case ${newId}:`, emailResult.reason);
        }
      } catch (e) {
        const reason = e instanceof Error ? e.message : String(e);
        console.error(`[clawback-new-case] notify exception for case ${newId}:`, reason);
        emailResult = { sent: false, reason };
      }
    }

    return NextResponse.json({ ok: true, id: newId, email: emailResult });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
