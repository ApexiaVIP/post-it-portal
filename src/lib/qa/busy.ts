/**
 * "Call QA has work in flight" flag, kept in KV rather than Postgres (8 Nov
 * 2026). The 5-minute transcription cron reads it first: when nothing is
 * waiting it returns without touching the database, so Neon can sleep
 * through the working day instead of being woken every 5 minutes. The cron
 * still looks at the database once an hour regardless, as a safety net for
 * anything that didn't set the flag (e.g. the hourly AWS retries).
 */
import { kv } from "@vercel/kv";

const KEY = "qa:busy";
const TTL_SECONDS = 2 * 60 * 60;
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export async function markQaBusy(): Promise<void> {
  if (!hasKv) return;
  try {
    await kv.set(KEY, Date.now(), { ex: TTL_SECONDS });
  } catch (e) {
    console.error("[qa] could not set busy flag", e instanceof Error ? e.message : e);
  }
}

/** True when work may be waiting. Without KV, or if KV fails, assume yes. */
export async function isQaBusy(): Promise<boolean> {
  if (!hasKv) return true;
  try {
    return (await kv.get(KEY)) !== null;
  } catch {
    return true;
  }
}
