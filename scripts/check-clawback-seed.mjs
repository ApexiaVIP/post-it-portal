#!/usr/bin/env node
/**
 * Verify the Clawback ingest landed correctly. Read-only.
 *
 *   node --env-file=.env.local scripts/check-clawback-seed.mjs
 */
import { sql } from "@vercel/postgres";

const upload = await sql`
  SELECT id, filename, uploaded_by, report_date, rows_total,
         rows_inserted, rows_updated, rows_unchanged, rows_unmatched,
         uploaded_at
  FROM clawback_uploads
  ORDER BY uploaded_at DESC
  LIMIT 5
`;
console.log("Recent uploads:");
for (const u of upload.rows) {
  console.log(` #${u.id} ${u.filename} by ${u.uploaded_by} report=${u.report_date} rows=${u.rows_total} new=${u.rows_inserted} upd=${u.rows_updated} unc=${u.rows_unchanged} unmatched=${u.rows_unmatched}`);
}

const cases = await sql`
  SELECT COUNT(*)::int AS n,
         COALESCE(SUM(clawback_due), 0)::float AS total_cb,
         COUNT(*) FILTER (WHERE clawback_due > 0)::int AS cb_rows,
         COUNT(*) FILTER (WHERE master_agent_no IS NOT NULL)::int AS with_master,
         COUNT(*) FILTER (WHERE agent_no IS NOT NULL)::int AS with_agent,
         COUNT(*) FILTER (WHERE agent_bucket = 'adviser')::int AS bucket_adviser,
         COUNT(*) FILTER (WHERE agent_bucket = 'xstaff')::int AS bucket_xstaff,
         COUNT(*) FILTER (WHERE agent_bucket = 'legacy')::int AS bucket_legacy,
         COUNT(*) FILTER (WHERE agent_bucket = 'needs_review')::int AS bucket_needs_review
  FROM clawback_cases
`;
console.log("\nclawback_cases totals:");
console.log(" ", cases.rows[0]);

const buckets = await sql`
  SELECT c.agent_bucket, a.name AS adviser_name, COUNT(*)::int AS cases,
         COALESCE(SUM(c.clawback_due), 0)::float AS clawback_due
  FROM clawback_cases c
  LEFT JOIN advisers a ON a.id = c.adviser_id
  GROUP BY c.agent_bucket, a.name
  ORDER BY clawback_due DESC NULLS LAST
`;
console.log("\nBuckets:");
for (const b of buckets.rows) {
  console.log(`  ${(b.adviser_name || b.agent_bucket).padEnd(15)} ${b.agent_bucket.padEnd(14)} cases=${String(b.cases).padStart(4)} cb=£${b.clawback_due.toFixed(2)}`);
}

const sample = await sql`
  SELECT policy_number, master_agent_no, agent_no, client_name, ebah_warning,
         ebah_agent_name, clawback_due, agent_bucket
  FROM clawback_cases
  ORDER BY clawback_due DESC NULLS LAST
  LIMIT 3
`;
console.log("\nTop 3 cases with master/agent ids:");
for (const r of sample.rows) {
  console.log(`  master=${r.master_agent_no || '(none)'.padEnd(7)}  agent=${r.agent_no || '(none)'.padEnd(7)}  £${Number(r.clawback_due).toFixed(2).padStart(10)}  ${r.client_name} (${r.ebah_warning})`);
}

const agentMap = await sql`
  SELECT bucket, COUNT(*)::int AS strings
  FROM clawback_agent_map
  GROUP BY bucket
  ORDER BY strings DESC
`;
console.log("\nclawback_agent_map:");
for (const r of agentMap.rows) console.log(`  ${r.bucket.padEnd(14)} ${r.strings}`);
