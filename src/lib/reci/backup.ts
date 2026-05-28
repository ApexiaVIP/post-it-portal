/**
 * RECI backup helpers — used by /api/cron (nightly) and by the standalone
 * scripts under scripts/.
 *
 * Backup format (stored in Vercel KV under key reci-backup:YYYY-MM-DD):
 *   {
 *     captured_at: ISO timestamp,
 *     version: 1,
 *     counts: { deals, deal_history, advisers },
 *     tables: { deals: [...], deal_history: [...], advisers: [...] }
 *   }
 *
 * An index set at key `reci-backup:index` tracks all backup dates so the
 * list/restore scripts can enumerate without scanning all KV keys.
 *
 * Retention: keep the last 90 days of nightly backups, plus first-of-month
 * forever. Anything older gets pruned to stay well within KV size limits.
 */
import { sql } from "@vercel/postgres";
import { kv } from "@vercel/kv";

export const BACKUP_VERSION = 1;
export const BACKUP_KEY_PREFIX = "reci-backup:";
export const BACKUP_INDEX_KEY  = "reci-backup:index";
export const DAILY_RETENTION_DAYS = 90;

export interface BackupCounts {
  deals: number;
  deal_history: number;
  advisers: number;
}

export interface BackupBundle {
  captured_at: string;
  version: number;
  counts: BackupCounts;
  tables: {
    deals: unknown[];
    deal_history: unknown[];
    advisers: unknown[];
  };
}

export function backupKey(date: string): string {
  return `${BACKUP_KEY_PREFIX}${date}`;
}

/** Build a backup snapshot of the three RECI tables. */
export async function buildBackup(): Promise<BackupBundle> {
  const [deals, dealHistory, advisers] = await Promise.all([
    sql`SELECT * FROM deals ORDER BY id ASC`,
    sql`SELECT * FROM deal_history ORDER BY id ASC`,
    sql`SELECT * FROM advisers ORDER BY id ASC`,
  ]);
  return {
    captured_at: new Date().toISOString(),
    version: BACKUP_VERSION,
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
}

/** Save the backup under reci-backup:<date> and add to the index. */
export async function storeBackup(date: string, bundle: BackupBundle): Promise<void> {
  await kv.set(backupKey(date), bundle);
  await kv.sadd(BACKUP_INDEX_KEY, date);
}

/** Read a backup back. Returns null if not found. */
export async function loadBackup(date: string): Promise<BackupBundle | null> {
  const bundle = await kv.get<BackupBundle>(backupKey(date));
  return bundle ?? null;
}

/** List dates we have backups for, newest first. */
export async function listBackupDates(): Promise<string[]> {
  const dates = (await kv.smembers(BACKUP_INDEX_KEY)) ?? [];
  return [...dates].sort().reverse();
}

/**
 * Prune anything older than DAILY_RETENTION_DAYS, except keep first-of-month
 * snapshots forever (so we always have at least a coarse history).
 */
export async function pruneOldBackups(today: Date = new Date()): Promise<string[]> {
  const cutoff = new Date(today);
  cutoff.setUTCDate(cutoff.getUTCDate() - DAILY_RETENTION_DAYS);
  const cutoffIso = cutoff.toISOString().slice(0, 10);

  const dates = await listBackupDates();
  const removed: string[] = [];
  for (const d of dates) {
    if (d >= cutoffIso) continue;
    if (d.endsWith("-01")) continue; // keep first-of-month forever
    await kv.del(backupKey(d));
    await kv.srem(BACKUP_INDEX_KEY, d);
    removed.push(d);
  }
  return removed;
}

/** Run the full nightly job: build, store, prune. Returns a summary. */
export async function runNightlyBackup(): Promise<{
  date: string;
  counts: BackupCounts;
  pruned: string[];
}> {
  const date = new Date().toISOString().slice(0, 10);
  const bundle = await buildBackup();
  await storeBackup(date, bundle);
  const pruned = await pruneOldBackups();
  return { date, counts: bundle.counts, pruned };
}
