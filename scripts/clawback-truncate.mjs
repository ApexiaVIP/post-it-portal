#!/usr/bin/env node
/**
 * Wipe the Clawback Dashboard tables so a fresh EBAH can be uploaded.
 *
 * Affected:
 *   clawback_cases        TRUNCATEd (cascades to clawback_history via FK)
 *   clawback_uploads      TRUNCATEd (audit log of who uploaded what)
 *   clawback_agent_map    LEFT INTACT (Pauline's canonical EBAH agent
 *                                      string -> bucket mappings)
 *
 * Untouched: deals, deal_history, advisers, POST IT data, anything
 * outside the clawback_* namespace.
 *
 * Before the truncate runs we dump every clawback_* row to Vercel KV at
 *   clawback-backup:<today>
 * so we have an undo path if something goes wrong. Pass --skip-backup
 * to skip the snapshot (not recommended).
 *
 *   node --env-file=.env.local scripts/clawback-truncate.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { sql } from "@vercel/postgres";

const args = process.argv.slice(2);
const skipBackup = args.includes("--skip-backup");
const date = new Date().toISOString().slice(0, 10);

// 1. Backup to a local JSON file ---------------------------------------
// Lives outside the repo to keep it out of git but in a known spot for
// the operator. Path printed at the end so it's easy to find.
if (!skipBackup) {
  const backupDir = path.join(os.homedir(), "Documents", "post-it-portal-backups");
  fs.mkdirSync(backupDir, { recursive: true });
  const backupPath = path.join(backupDir, `clawback-backup-${date}.json`);
  console.log(`Snapshotting clawback_* to ${backupPath}...`);

  const [cases, history, uploads, agentMap] = await Promise.all([
    sql`SELECT * FROM clawback_cases ORDER BY id ASC`,
    sql`SELECT * FROM clawback_history ORDER BY id ASC`,
    sql`SELECT * FROM clawback_uploads ORDER BY id ASC`,
    sql`SELECT * FROM clawback_agent_map ORDER BY ebah_agent_name ASC`,
  ]);

  const bundle = {
    captured_at: new Date().toISOString(),
    version: 1,
    counts: {
      clawback_cases:     cases.rows.length,
      clawback_history:   history.rows.length,
      clawback_uploads:   uploads.rows.length,
      clawback_agent_map: agentMap.rows.length,
    },
    tables: {
      clawback_cases:     cases.rows,
      clawback_history:   history.rows,
      clawback_uploads:   uploads.rows,
      clawback_agent_map: agentMap.rows,
    },
  };

  console.log(
    `  cases=${bundle.counts.clawback_cases}  history=${bundle.counts.clawback_history}  ` +
    `uploads=${bundle.counts.clawback_uploads}  agent_map=${bundle.counts.clawback_agent_map}`,
  );

  fs.writeFileSync(backupPath, JSON.stringify(bundle, null, 2));
  const sizeMb = (fs.statSync(backupPath).size / (1024 * 1024)).toFixed(2);
  console.log(`  Snapshot written (${sizeMb} MB).`);
} else {
  console.log("Skipping backup (--skip-backup).");
}

// 2. Truncate -----------------------------------------------------------
// Order: cases CASCADEs into history (FK on case_id ON DELETE CASCADE);
// uploads has no inbound FKs after cases are gone.
console.log("\nTruncating clawback_cases (cascades to clawback_history)...");
await sql`TRUNCATE TABLE clawback_cases CASCADE`;
console.log("Truncating clawback_uploads...");
await sql`TRUNCATE TABLE clawback_uploads RESTART IDENTITY CASCADE`;

// 3. Verify -------------------------------------------------------------
const after = await sql`
  SELECT
    (SELECT COUNT(*)::int FROM clawback_cases)     AS cases,
    (SELECT COUNT(*)::int FROM clawback_history)   AS history,
    (SELECT COUNT(*)::int FROM clawback_uploads)   AS uploads,
    (SELECT COUNT(*)::int FROM clawback_agent_map) AS agent_map
`;
console.log("\nPost-truncate counts:");
console.log(`  cases=${after.rows[0].cases}  history=${after.rows[0].history}  uploads=${after.rows[0].uploads}  agent_map=${after.rows[0].agent_map}`);
console.log("\nDone. Upload the fresh EBAH via /reci/clawback.");
