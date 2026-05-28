#!/usr/bin/env node
/**
 * List every RECI backup currently in Vercel KV, with size and counts.
 *
 *   node --env-file=.env.local scripts/list-backups.mjs
 */
import { kv } from "@vercel/kv";

const BACKUP_INDEX_KEY = "reci-backup:index";
const BACKUP_KEY = (date) => `reci-backup:${date}`;

const dates = (await kv.smembers(BACKUP_INDEX_KEY)) ?? [];
dates.sort().reverse();

if (dates.length === 0) {
  console.log("No backups found yet.");
  process.exit(0);
}

console.log(`${dates.length} backup(s) in KV (newest first):\n`);
console.log("  date         deals  history  advisers  captured_at");
console.log("  ----------   -----  -------  --------  --------------------------");

for (const date of dates) {
  const b = await kv.get(BACKUP_KEY(date));
  if (!b) {
    console.log(`  ${date}   (in index but missing from KV)`);
    continue;
  }
  const c = b.counts || {};
  console.log(
    `  ${date}   ${String(c.deals ?? "?").padStart(5)}  ` +
    `${String(c.deal_history ?? "?").padStart(7)}  ` +
    `${String(c.advisers ?? "?").padStart(8)}  ${b.captured_at ?? "?"}`,
  );
}

console.log("\nTo restore a specific date: node --env-file=.env.local scripts/restore-from-backup.mjs <date>");
