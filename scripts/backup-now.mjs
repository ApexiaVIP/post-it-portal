#!/usr/bin/env node
/**
 * Trigger a one-off RECI backup right now. Useful before any risky operation.
 *
 *   node --env-file=.env.local scripts/backup-now.mjs
 *
 * Writes deals + deal_history + advisers to Vercel KV at key:
 *   reci-backup:<today>     (manual override: pass a date arg)
 *
 * Requires POSTGRES_URL and the KV env vars (KV_URL or KV_REST_API_URL +
 * KV_REST_API_TOKEN) in .env.local.
 */
import { sql } from "@vercel/postgres";
import { kv } from "@vercel/kv";

const BACKUP_INDEX_KEY = "reci-backup:index";
const BACKUP_KEY = (date) => `reci-backup:${date}`;

const dateArg = process.argv[2];
const date = dateArg || new Date().toISOString().slice(0, 10);
if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
  console.error("Usage: node scripts/backup-now.mjs [YYYY-MM-DD]");
  process.exit(1);
}

console.log(`Building backup for ${date}...`);
const [deals, dealHistory, advisers] = await Promise.all([
  sql`SELECT * FROM deals ORDER BY id ASC`,
  sql`SELECT * FROM deal_history ORDER BY id ASC`,
  sql`SELECT * FROM advisers ORDER BY id ASC`,
]);

const bundle = {
  captured_at: new Date().toISOString(),
  version: 1,
  counts: {
    deals:        deals.rows.length,
    deal_history: dealHistory.rows.length,
    advisers:     advisers.rows.length,
  },
  tables: {
    deals:        deals.rows,
    deal_history: dealHistory.rows,
    advisers:     advisers.rows,
  },
};

console.log(`  deals=${bundle.counts.deals}  deal_history=${bundle.counts.deal_history}  advisers=${bundle.counts.advisers}`);

const existing = await kv.get(BACKUP_KEY(date));
if (existing) {
  console.log(`  Overwriting existing backup for ${date}.`);
}

await kv.set(BACKUP_KEY(date), bundle);
await kv.sadd(BACKUP_INDEX_KEY, date);

console.log(`\nBackup stored at KV key: ${BACKUP_KEY(date)}`);
console.log(`To restore: node --env-file=.env.local scripts/restore-from-backup.mjs ${date}`);
