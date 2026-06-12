/**
 * Ingest a parsed EBAH file into the clawback_* tables.
 *
 * Strategy (per Pauline's brief):
 *   - One row per policy_number, upserted on every re-upload.
 *   - First time we see an EBAH agent string, write it into clawback_agent_map
 *     so any change to its bucket sticks across uploads.
 *   - Each upload is a single transaction so a parse error halfway through
 *     can't leave the dashboard in a torn state.
 *   - Field changes on re-upload write per-field rows into clawback_history
 *     ('ebah_change') so the case audit log is meaningful when L&G flips
 *     state on a policy.
 *   - Workflow fields the user owns (status, status_note, saved_amount,
 *     resold_amount) are NEVER touched by the upload -- L&G only owns the
 *     EBAH fields.
 */
import { sql, db } from "@vercel/postgres";
import {
  parseEbahXlsx,
  bucketAgentString,
  type EbahRow,
} from "./clawback-parser";

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

    // 1. Load active adviser roster (used for matching new agent strings).
    const advisers = await client.query<{ id: number; name: string }>(
      `SELECT id, name FROM advisers ORDER BY id`,
    );
    const adviserList = advisers.rows;

    // 2. Insert the upload row first so we can reference its id on history.
    const upload = await client.query<{ id: number }>(
      `INSERT INTO clawback_uploads
         (filename, provider, uploaded_by, report_date, rows_total)
       VALUES ($1, 'l&g', $2, $3, $4)
       RETURNING id`,
      [filename, uploadedBy, parsed.reportDate, rows.length],
    );
    const uploadId = upload.rows[0].id;

    // 3. Resolve agent buckets, persisting unseen strings into agent_map.
    const agentResolver = new AgentResolver(adviserList);
    await agentResolver.preload(client);

    let inserted = 0, updated = 0, unchanged = 0, unmatched = 0;

    for (const r of rows) {
      const mapping = await agentResolver.resolve(client, r.ebah_agent_name);
      if (mapping.bucket === "needs_review") unmatched++;

      // Look up existing case by policy number
      const existing = await client.query<ExistingCaseRow>(
        `SELECT
            id, ebah_warning, net_premium, premium_outstanding, clawback_due,
            clawback_date::text AS clawback_date,
            policy_start_date::text AS policy_start_date,
            off_risk_date::text AS off_risk_date,
            client_name, postcode, address, policy_type,
            ebah_agent_name, adviser_id, agent_bucket
         FROM clawback_cases WHERE policy_number = $1`,
        [r.policy_number],
      );

      if (existing.rowCount === 0) {
        // Brand new case
        const nowYear = parsed.reportDate ? Number(parsed.reportDate.slice(0, 4)) : new Date().getUTCFullYear();
        const week = parsed.reportDate ? isoWeek(parsed.reportDate) : null;
        const ins = await client.query<{ id: number }>(
          `INSERT INTO clawback_cases (
              policy_number, provider, client_name, client_first_name,
              client_last_name, client_dob, client_email, client_phone,
              postcode, address, policy_type, net_premium,
              premium_outstanding, policy_start_date, off_risk_date,
              clawback_due, clawback_date, ebah_agent_name, adviser_id,
              agent_bucket, ebah_warning, status,
              first_seen_upload_id, last_seen_upload_id,
              notification_week, notification_year
           )
           VALUES (
             $1,'l&g',$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
             $17,$18,$19,$20,'open',$21,$21,$22,$23
           )
           RETURNING id`,
          [
            r.policy_number, r.client_name, r.client_first_name, r.client_last_name,
            r.client_dob, r.client_email, r.client_phone, r.postcode, r.address,
            r.policy_type, r.net_premium, r.premium_outstanding,
            r.policy_start_date, r.off_risk_date, r.clawback_due, r.clawback_date,
            r.ebah_agent_name, mapping.adviser_id, mapping.bucket,
            r.warning,
            uploadId, week, nowYear,
          ],
        );
        await client.query(
          `INSERT INTO clawback_history (case_id, upload_id, event_type, actor, note)
           VALUES ($1, $2, 'created', 'ebah-upload', $3)`,
          [ins.rows[0].id, uploadId, `New case from upload ${filename}`],
        );
        inserted++;
      } else {
        // Compare EBAH fields; update changed ones; write history per diff.
        const e = existing.rows[0];
        const diffs: { field: string; oldV: string | null; newV: string | null }[] = [];

        function check(field: string, oldV: unknown, newV: unknown) {
          const a = oldV === null || oldV === undefined ? null : String(oldV);
          const b = newV === null || newV === undefined ? null : String(newV);
          if (a !== b) diffs.push({ field, oldV: a, newV: b });
        }

        check("ebah_warning", e.ebah_warning, r.warning);
        check("clawback_due", Number(e.clawback_due ?? 0).toFixed(2), Number(r.clawback_due ?? 0).toFixed(2));
        check("clawback_date", e.clawback_date, r.clawback_date);
        check("net_premium", e.net_premium === null ? null : Number(e.net_premium).toFixed(2), r.net_premium === null ? null : Number(r.net_premium).toFixed(2));
        check("premium_outstanding", e.premium_outstanding === null ? null : Number(e.premium_outstanding).toFixed(2), r.premium_outstanding === null ? null : Number(r.premium_outstanding).toFixed(2));
        check("policy_start_date", e.policy_start_date, r.policy_start_date);
        check("off_risk_date", e.off_risk_date, r.off_risk_date);
        check("client_name", e.client_name, r.client_name);
        check("postcode", e.postcode, r.postcode);
        check("address", e.address, r.address);
        check("policy_type", e.policy_type, r.policy_type);
        check("ebah_agent_name", e.ebah_agent_name, r.ebah_agent_name);
        // Re-bucket if the agent map has changed since last time
        check("adviser_id", e.adviser_id, mapping.adviser_id);
        check("agent_bucket", e.agent_bucket, mapping.bucket);

        if (diffs.length === 0) {
          await client.query(
            `UPDATE clawback_cases SET last_seen_upload_id = $1, updated_at = now() WHERE id = $2`,
            [uploadId, e.id],
          );
          unchanged++;
        } else {
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
              mapping.adviser_id, mapping.bucket, uploadId, e.id,
            ],
          );
          for (const d of diffs) {
            await client.query(
              `INSERT INTO clawback_history
                 (case_id, upload_id, event_type, field, old_value, new_value, actor)
               VALUES ($1, $2, 'ebah_change', $3, $4, $5, 'ebah-upload')`,
              [e.id, uploadId, d.field, d.oldV, d.newV],
            );
          }
          updated++;
        }
      }
    }

    // 4. Finalise the upload audit row.
    await client.query(
      `UPDATE clawback_uploads
       SET rows_inserted = $1, rows_updated = $2,
           rows_unchanged = $3, rows_unmatched = $4
       WHERE id = $5`,
      [inserted, updated, unchanged, unmatched, uploadId],
    );

    await client.query("COMMIT");

    return {
      uploadId,
      reportDate: parsed.reportDate,
      rowsTotal: rows.length,
      rowsInserted: inserted,
      rowsUpdated: updated,
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

interface ExistingCaseRow {
  id: number;
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

class AgentResolver {
  private cache = new Map<string, { bucket: "adviser" | "xstaff" | "legacy" | "needs_review"; adviser_id: number | null }>();
  constructor(private advisers: { id: number; name: string }[]) {}

  async preload(client: { query: typeof sql.query }) {
    const r = await client.query<{ ebah_agent_name: string; adviser_id: number | null; bucket: string }>(
      `SELECT ebah_agent_name, adviser_id, bucket FROM clawback_agent_map`,
    );
    for (const row of r.rows) {
      this.cache.set(row.ebah_agent_name, {
        bucket: row.bucket as "adviser" | "xstaff" | "legacy" | "needs_review",
        adviser_id: row.adviser_id,
      });
    }
  }

  async resolve(
    client: { query: typeof sql.query },
    canonical: string,
  ) {
    const cached = this.cache.get(canonical);
    if (cached) return cached;
    const bucketed = bucketAgentString(canonical, this.advisers);
    this.cache.set(canonical, bucketed);
    await client.query(
      `INSERT INTO clawback_agent_map (ebah_agent_name, adviser_id, bucket)
       VALUES ($1, $2, $3)
       ON CONFLICT (ebah_agent_name) DO NOTHING`,
      [canonical, bucketed.adviser_id, bucketed.bucket],
    );
    return bucketed;
  }
}

function isoWeek(yyyymmdd: string): number {
  // 2026-06-12 -> ISO week number
  const [y, m, d] = yyyymmdd.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  return Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}

// Re-export EbahRow so callers don't need a second import
export type { EbahRow };
