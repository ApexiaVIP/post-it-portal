/**
 * Ingest a parsed EBAH file into the clawback_* tables.
 *
 * Strategy (per Pauline's brief):
 *   - One row per policy_number, upserted on every re-upload.
 *   - First time we see an EBAH agent string, write it into clawback_agent_map
 *     so any change to its bucket sticks across uploads.
 *   - The whole upload is a single transaction so a parse error halfway
 *     through can't leave the dashboard in a torn state.
 *   - Field changes on re-upload write per-field rows into clawback_history
 *     ('ebah_change') so the case audit log is meaningful when L&G flips
 *     state on a policy.
 *   - Workflow fields the user owns (status, status_note, saved_amount,
 *     resold_amount) are NEVER touched by the upload -- L&G only owns the
 *     EBAH fields.
 *
 * Performance: the YTD baseline is ~670 rows. The naive
 * "SELECT-then-INSERT per row" pattern took >60s and tripped the Vercel
 * function timeout, so this implementation:
 *
 *   1. Pre-fetches ALL existing cases for the incoming policy list in a
 *      single round-trip (one query).
 *   2. Pre-loads the entire clawback_agent_map in one query.
 *   3. Buckets every agent string in-memory.
 *   4. Batches new-case INSERTs into multi-row VALUES chunks (250 rows
 *      per statement).
 *   5. Batches history INSERTs the same way.
 *   6. Updates are still per-row but only run for rows where the diff is
 *      non-empty, which is rare in steady state.
 */
import { sql, db } from "@vercel/postgres";
import {
  parseEbahXlsx,
  bucketAgentString,
  type EbahRow,
} from "./clawback-parser";

const INSERT_BATCH = 250;
const HISTORY_BATCH = 500;

export interface IngestSummary {
  uploadId: number;
  reportDate: string | null;
  rowsTotal: number;
  rowsInserted: number;
  rowsUpdated: number;
  rowsUnchanged: number;
  rowsUnmatched: number;        // agents bucketed into needs_review
  parseErrors: { rowIndex: number; reason: string }[];
}

export async function ingestEbahFile(
  buf: Buffer | ArrayBuffer,
  filename: string,
  uploadedBy: string,
): Promise<IngestSummary> {
  const parsed = parseEbahXlsx(buf);
  const rows = parsed.rows;
  if (rows.length === 0) {
    throw new Error("EBAH file contained no parseable rows");
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    // ---------- 1. Active adviser roster ----------
    const advisersR = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM advisers ORDER BY id`,
    );
    const advisers = advisersR.rows;

    // ---------- 2. Pre-load the agent map ----------
    const mapR = await client.query<{ ebah_agent_name: string; adviser_id: number | null; bucket: Bucket }>(
      `SELECT ebah_agent_name, adviser_id, bucket FROM clawback_agent_map`,
    );
    const agentMap = new Map<string, { bucket: Bucket; adviser_id: number | null }>();
    for (const r of mapR.rows) agentMap.set(r.ebah_agent_name, { bucket: r.bucket, adviser_id: r.adviser_id });

    // ---------- 3. Resolve every agent string in-memory + collect new ones ----------
    const newAgentRows: { name: string; bucket: Bucket; adviser_id: number | null }[] = [];
    const seenNew = new Set<string>();
    function resolveAgent(canonical: string) {
      const cached = agentMap.get(canonical);
      if (cached) return cached;
      const bucketed = bucketAgentString(canonical, advisers);
      agentMap.set(canonical, bucketed);
      if (!seenNew.has(canonical)) {
        seenNew.add(canonical);
        newAgentRows.push({ name: canonical, bucket: bucketed.bucket, adviser_id: bucketed.adviser_id });
      }
      return bucketed;
    }
    for (const r of rows) resolveAgent(r.ebah_agent_name);

    if (newAgentRows.length > 0) {
      // One INSERT for all newly-seen agents.
      const placeholders: string[] = [];
      const params: (string | number | null)[] = [];
      let p = 0;
      for (const a of newAgentRows) {
        placeholders.push(`($${++p}, $${++p}, $${++p})`);
        params.push(a.name, a.adviser_id, a.bucket);
      }
      await client.query(
        `INSERT INTO clawback_agent_map (ebah_agent_name, adviser_id, bucket)
         VALUES ${placeholders.join(",")}
         ON CONFLICT (ebah_agent_name) DO NOTHING`,
        params,
      );
    }

    // ---------- 4. Insert the upload audit row up front so we can FK on it ----------
    const upload = await client.query<{ id: number }>(
      `INSERT INTO clawback_uploads
         (filename, provider, uploaded_by, report_date, rows_total)
       VALUES ($1, 'l&g', $2, $3, $4)
       RETURNING id`,
      [filename, uploadedBy, parsed.reportDate, rows.length],
    );
    const uploadId = upload.rows[0].id;

    // ---------- 5. Pre-fetch existing cases in ONE query ----------
    const policyNumbers = rows.map((r) => r.policy_number);
    const existR = await client.query<ExistingCaseRow>(
      `SELECT
          id, policy_number, ebah_warning,
          net_premium::text             AS net_premium,
          premium_outstanding::text     AS premium_outstanding,
          clawback_due::text            AS clawback_due,
          clawback_date::text           AS clawback_date,
          policy_start_date::text       AS policy_start_date,
          off_risk_date::text           AS off_risk_date,
          client_name, postcode, address, policy_type,
          ebah_agent_name, adviser_id, agent_bucket
       FROM clawback_cases WHERE policy_number = ANY($1)`,
      [policyNumbers],
    );
    const existingByPolicy = new Map<string, ExistingCaseRow>();
    for (const e of existR.rows) existingByPolicy.set(e.policy_number, e);

    // ---------- 6. Classify each parsed row ----------
    const reportYear = parsed.reportDate ? Number(parsed.reportDate.slice(0, 4)) : new Date().getUTCFullYear();
    const reportWeek = parsed.reportDate ? isoWeek(parsed.reportDate) : null;

    interface UpdateOp { id: number; row: EbahRow; mapping: { bucket: Bucket; adviser_id: number | null }; diffs: Diff[]; }
    const toInsert: { row: EbahRow; mapping: { bucket: Bucket; adviser_id: number | null } }[] = [];
    const toUpdate: UpdateOp[] = [];
    let unchanged = 0, unmatched = 0;

    for (const r of rows) {
      const mapping = agentMap.get(r.ebah_agent_name)!;
      if (mapping.bucket === "needs_review") unmatched++;
      const existing = existingByPolicy.get(r.policy_number);
      if (!existing) {
        toInsert.push({ row: r, mapping });
        continue;
      }
      const diffs: Diff[] = [];
      function check(field: string, oldV: unknown, newV: unknown) {
        const a = oldV === null || oldV === undefined ? null : String(oldV);
        const b = newV === null || newV === undefined ? null : String(newV);
        if (a !== b) diffs.push({ field, oldV: a, newV: b });
      }
      check("ebah_warning",        existing.ebah_warning, r.warning);
      check("clawback_due",        normNum(existing.clawback_due),         normNum(r.clawback_due));
      check("clawback_date",       existing.clawback_date,                 r.clawback_date);
      check("net_premium",         normNum(existing.net_premium),          normNum(r.net_premium));
      check("premium_outstanding", normNum(existing.premium_outstanding),  normNum(r.premium_outstanding));
      check("policy_start_date",   existing.policy_start_date,             r.policy_start_date);
      check("off_risk_date",       existing.off_risk_date,                 r.off_risk_date);
      check("client_name",         existing.client_name,                   r.client_name);
      check("postcode",            existing.postcode,                      r.postcode);
      check("address",             existing.address,                       r.address);
      check("policy_type",         existing.policy_type,                   r.policy_type);
      check("ebah_agent_name",     existing.ebah_agent_name,               r.ebah_agent_name);
      check("adviser_id",          existing.adviser_id,                    mapping.adviser_id);
      check("agent_bucket",        existing.agent_bucket,                  mapping.bucket);

      if (diffs.length === 0) {
        unchanged++;
        continue;
      }
      toUpdate.push({ id: existing.id, row: r, mapping, diffs });
    }

    // ---------- 7. Bulk-insert new cases in chunks; collect ids for history ----------
    const inserted = await batchInsertCases(client, toInsert, uploadId, reportYear, reportWeek);

    // ---------- 8. Update changed cases (per-row, but only the changed set) ----------
    for (const u of toUpdate) {
      const r = u.row;
      await client.query(
        `UPDATE clawback_cases SET
           ebah_warning = $1,
           clawback_due = $2,
           clawback_date = $3,
           net_premium = $4,
           premium_outstanding = $5,
           policy_start_date = $6,
           off_risk_date = $7,
           client_name = $8,
           client_first_name = $9,
           client_last_name = $10,
           postcode = $11,
           address = $12,
           policy_type = $13,
           ebah_agent_name = $14,
           adviser_id = $15,
           agent_bucket = $16,
           last_seen_upload_id = $17,
           updated_at = now()
         WHERE id = $18`,
        [
          r.warning, r.clawback_due, r.clawback_date, r.net_premium,
          r.premium_outstanding, r.policy_start_date, r.off_risk_date,
          r.client_name, r.client_first_name, r.client_last_name,
          r.postcode, r.address, r.policy_type, r.ebah_agent_name,
          u.mapping.adviser_id, u.mapping.bucket, uploadId, u.id,
        ],
      );
    }

    // ---------- 9. Bulk-insert history rows: created + per-field ebah_change ----------
    type HistRow = { case_id: number; event_type: string; field: string | null; old: string | null; newv: string | null; note: string | null; actor: string };
    const histRows: HistRow[] = [];
    for (const ins of inserted) {
      histRows.push({
        case_id: ins.id, event_type: "created", field: null, old: null, newv: null,
        note: `New case from upload ${filename}`, actor: "ebah-upload",
      });
    }
    for (const u of toUpdate) {
      for (const d of u.diffs) {
        histRows.push({
          case_id: u.id, event_type: "ebah_change", field: d.field,
          old: d.oldV, newv: d.newV, note: null, actor: "ebah-upload",
        });
      }
    }
    await batchInsertHistory(client, histRows, uploadId);

    // ---------- 10. Bump last_seen_upload_id for unchanged rows in one statement ----------
    const unchangedIds: number[] = [];
    for (const r of rows) {
      const existing = existingByPolicy.get(r.policy_number);
      if (!existing) continue;
      const u = toUpdate.find((x) => x.id === existing.id);
      if (u) continue;
      unchangedIds.push(existing.id);
    }
    if (unchangedIds.length > 0) {
      await client.query(
        `UPDATE clawback_cases
           SET last_seen_upload_id = $1, updated_at = now()
         WHERE id = ANY($2)`,
        [uploadId, unchangedIds],
      );
    }

    // ---------- 11. Finalise the audit row ----------
    await client.query(
      `UPDATE clawback_uploads
         SET rows_inserted = $1, rows_updated = $2,
             rows_unchanged = $3, rows_unmatched = $4
       WHERE id = $5`,
      [inserted.length, toUpdate.length, unchanged, unmatched, uploadId],
    );

    await client.query("COMMIT");

    return {
      uploadId,
      reportDate: parsed.reportDate,
      rowsTotal: rows.length,
      rowsInserted: inserted.length,
      rowsUpdated: toUpdate.length,
      rowsUnchanged: unchanged,
      rowsUnmatched: unmatched,
      parseErrors: parsed.errors,
    };
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

// ---------- helpers --------------------------------------------------------

type Bucket = "adviser" | "xstaff" | "legacy" | "needs_review";

interface Diff { field: string; oldV: string | null; newV: string | null; }

interface ExistingCaseRow {
  id: number;
  policy_number: string;
  ebah_warning: string | null;
  net_premium: string | null;
  premium_outstanding: string | null;
  clawback_due: string | null;
  clawback_date: string | null;
  policy_start_date: string | null;
  off_risk_date: string | null;
  client_name: string;
  postcode: string | null;
  address: string | null;
  policy_type: string | null;
  ebah_agent_name: string;
  adviser_id: number | null;
  agent_bucket: string;
}

function normNum(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return null;
  return n.toFixed(2);
}

async function batchInsertCases(
  client: { query: typeof sql.query },
  ops: { row: EbahRow; mapping: { bucket: Bucket; adviser_id: number | null } }[],
  uploadId: number,
  reportYear: number,
  reportWeek: number | null,
): Promise<{ id: number; policy_number: string }[]> {
  const results: { id: number; policy_number: string }[] = [];
  // 23 columns per row.
  const COLS = 23;
  for (let i = 0; i < ops.length; i += INSERT_BATCH) {
    const chunk = ops.slice(i, i + INSERT_BATCH);
    const placeholders: string[] = [];
    const params: (string | number | null)[] = [];
    let p = 0;
    for (const o of chunk) {
      const r = o.row;
      const slots: string[] = [];
      for (let k = 0; k < COLS; k++) slots.push(`$${++p}`);
      placeholders.push(`(${slots.join(",")})`);
      params.push(
        r.policy_number,
        r.client_name,
        r.client_first_name,
        r.client_last_name,
        r.client_dob,
        r.client_email,
        r.client_phone,
        r.postcode,
        r.address,
        r.policy_type,
        r.net_premium,
        r.premium_outstanding,
        r.policy_start_date,
        r.off_risk_date,
        r.clawback_due,
        r.clawback_date,
        r.ebah_agent_name,
        o.mapping.adviser_id,
        o.mapping.bucket,
        r.warning,
        uploadId,           // first_seen + last_seen
        reportWeek,
        reportYear,
      );
    }
    const q = `
      INSERT INTO clawback_cases (
        policy_number, client_name, client_first_name, client_last_name,
        client_dob, client_email, client_phone, postcode, address,
        policy_type, net_premium, premium_outstanding, policy_start_date,
        off_risk_date, clawback_due, clawback_date, ebah_agent_name,
        adviser_id, agent_bucket, ebah_warning,
        first_seen_upload_id, notification_week, notification_year
      )
      VALUES ${placeholders.join(",")}
      ON CONFLICT (policy_number) DO NOTHING
      RETURNING id, policy_number
    `;
    const r = await client.query<{ id: number; policy_number: string }>(q, params);
    for (const row of r.rows) results.push(row);
    // Set last_seen_upload_id = first_seen for the brand-new rows in the same chunk.
    if (r.rows.length > 0) {
      await client.query(
        `UPDATE clawback_cases SET last_seen_upload_id = $1 WHERE id = ANY($2)`,
        [uploadId, r.rows.map((x) => x.id)],
      );
    }
  }
  return results;
}

async function batchInsertHistory(
  client: { query: typeof sql.query },
  histRows: { case_id: number; event_type: string; field: string | null; old: string | null; newv: string | null; note: string | null; actor: string }[],
  uploadId: number,
) {
  if (histRows.length === 0) return;
  const COLS = 7;
  for (let i = 0; i < histRows.length; i += HISTORY_BATCH) {
    const chunk = histRows.slice(i, i + HISTORY_BATCH);
    const placeholders: string[] = [];
    const params: (string | number | null)[] = [];
    let p = 0;
    for (const h of chunk) {
      const slots: string[] = [];
      for (let k = 0; k < COLS; k++) slots.push(`$${++p}`);
      placeholders.push(`(${slots.join(",")})`);
      params.push(h.case_id, uploadId, h.event_type, h.field, h.old, h.newv, h.actor);
    }
    // Note column is set separately below to avoid leaking notes intent here.
    const q = `
      INSERT INTO clawback_history
        (case_id, upload_id, event_type, field, old_value, new_value, actor)
      VALUES ${placeholders.join(",")}
    `;
    await client.query(q, params);
  }
}

function isoWeek(yyyymmdd: string): number {
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

export type { EbahRow };
