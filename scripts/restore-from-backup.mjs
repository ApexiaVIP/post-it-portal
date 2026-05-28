#!/usr/bin/env node
/**
 * Restore the RECI tables (deals, deal_history) from a Vercel KV backup.
 * Same safety as the original import script: snapshots the CURRENT live
 * tables into deals_restored_YYYYMMDDHHMMSS / deal_history_restored_…
 * before truncating, so the live data right before the restore is also
 * recoverable.
 *
 *   node --env-file=.env.local scripts/restore-from-backup.mjs <date>
 *   node --env-file=.env.local scripts/restore-from-backup.mjs <date> --i-have-the-backup
 *
 * The first invocation backs up + stops, asking for the confirmation flag.
 * The second invocation actually truncates and restores.
 *
 * Advisers are NOT touched on restore by default (they almost never change
 * and we want stable IDs). Pass --restore-advisers to overwrite them too.
 */
import { sql } from "@vercel/postgres";
import { kv } from "@vercel/kv";

const BACKUP_KEY = (date) => `reci-backup:${date}`;

const args = process.argv.slice(2);
const date = args.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a));
const confirm = args.includes("--i-have-the-backup");
const restoreAdvisers = args.includes("--restore-advisers");

if (!date) {
  console.error("Usage: node scripts/restore-from-backup.mjs <YYYY-MM-DD> [--i-have-the-backup] [--restore-advisers]");
  process.exit(1);
}

console.log(`Loading backup reci-backup:${date}...`);
const bundle = await kv.get(BACKUP_KEY(date));
if (!bundle) {
  console.error(`No backup found for ${date}. Run list-backups.mjs to see what's available.`);
  process.exit(1);
}

const c = bundle.counts || {};
console.log(`  Backup captured: ${bundle.captured_at}`);
console.log(`  Contains: deals=${c.deals}  deal_history=${c.deal_history}  advisers=${c.advisers}`);

// Snapshot the current live state into restore-prefixed backup tables.
const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
const safeDeals   = `deals_restored_${stamp}`;
const safeHistory = `deal_history_restored_${stamp}`;
console.log(`\nSnapshotting current live state into ${safeDeals} / ${safeHistory} (safety net)...`);
await sql.query(`CREATE TABLE IF NOT EXISTS ${safeDeals} AS SELECT * FROM deals WHERE FALSE`);
await sql.query(`CREATE TABLE IF NOT EXISTS ${safeHistory} AS SELECT * FROM deal_history WHERE FALSE`);
await sql.query(`INSERT INTO ${safeDeals}   SELECT * FROM deals`);
await sql.query(`INSERT INTO ${safeHistory} SELECT * FROM deal_history`);
const { rows: snDeals } = await sql.query(`SELECT COUNT(*)::int AS n FROM ${safeDeals}`);
const { rows: snHist  } = await sql.query(`SELECT COUNT(*)::int AS n FROM ${safeHistory}`);
console.log(`  ${safeDeals}: ${snDeals[0].n} rows`);
console.log(`  ${safeHistory}: ${snHist[0].n} rows`);

if (!confirm) {
  console.log(`\nSafety snapshot taken. To proceed with destructive restore:`);
  console.log(`  node --env-file=.env.local scripts/restore-from-backup.mjs ${date} --i-have-the-backup` +
              (restoreAdvisers ? " --restore-advisers" : ""));
  process.exit(0);
}

// Disable foreign-key checks while we wipe + reinsert. deal_history.deal_id
// references deals.id, so order matters.
console.log("\nTRUNCATE deals, deal_history...");
await sql.query(`TRUNCATE deals, deal_history RESTART IDENTITY CASCADE`);

const deals     = bundle.tables?.deals     ?? [];
const history   = bundle.tables?.deal_history ?? [];
const advisers  = bundle.tables?.advisers  ?? [];

const dealColumns = deals.length > 0 ? Object.keys(deals[0]) : [];
const histColumns = history.length > 0 ? Object.keys(history[0]) : [];

console.log(`\nRestoring ${deals.length} deals...`);
for (const row of deals) {
  const cols = dealColumns;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const values = cols.map((k) => row[k]);
  await sql.query(
    `INSERT INTO deals (${cols.join(",")}) VALUES (${placeholders})`,
    values,
  );
}

// Re-sync the id sequence so future INSERTs don't collide with restored ids.
await sql.query(`SELECT setval(pg_get_serial_sequence('deals','id'),
  COALESCE((SELECT MAX(id) FROM deals), 1), (SELECT MAX(id) FROM deals) IS NOT NULL)`);

console.log(`Restoring ${history.length} deal_history rows...`);
for (const row of history) {
  const cols = histColumns;
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(",");
  const values = cols.map((k) => row[k]);
  await sql.query(
    `INSERT INTO deal_history (${cols.join(",")}) VALUES (${placeholders})`,
    values,
  );
}
await sql.query(`SELECT setval(pg_get_serial_sequence('deal_history','id'),
  COALESCE((SELECT MAX(id) FROM deal_history), 1), (SELECT MAX(id) FROM deal_history) IS NOT NULL)`);

if (restoreAdvisers && advisers.length > 0) {
  console.log(`Restoring ${advisers.length} advisers (overwriting current)...`);
  await sql.query(`TRUNCATE advisers CASCADE`);
  const advColumns = Object.keys(advisers[0]);
  for (const row of advisers) {
    const placeholders = advColumns.map((_, i) => `$${i + 1}`).join(",");
    const values = advColumns.map((k) => row[k]);
    await sql.query(
      `INSERT INTO advisers (${advColumns.join(",")}) VALUES (${placeholders})`,
      values,
    );
  }
}

// Verify
const { rows: liveDeals }   = await sql.query(`SELECT COUNT(*)::int AS n FROM deals`);
const { rows: liveHistory } = await sql.query(`SELECT COUNT(*)::int AS n FROM deal_history`);
console.log(`\nRestore complete:`);
console.log(`  deals:        live=${liveDeals[0].n}  expected=${deals.length}  ${liveDeals[0].n === deals.length ? "OK" : "MISMATCH"}`);
console.log(`  deal_history: live=${liveHistory[0].n}  expected=${history.length}  ${liveHistory[0].n === history.length ? "OK" : "MISMATCH"}`);
console.log(`\nSafety snapshot of pre-restore state is preserved in ${safeDeals} / ${safeHistory}.`);
