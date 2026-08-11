/**
 * Vercel KV wrapper, date-keyed.
 */
import { kv } from "@vercel/kv";
import {
  ManualData, emptyManualData, kvKeyForDate, londonDateIso,
} from "./schema";

const memoryStore: Map<string, unknown> = new Map();
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

/**
 * Read a day's manual data with retries. A transient KV failure used to
 * be swallowed silently and returned as an empty day — which is how the
 * 10 Aug 2026 POST IT emails showed 0 deals / quotes / fact finds in the
 * daily rows while the weekly rows (a second read moments later) were
 * correct. Now: up to 3 attempts with a short backoff, and every failure
 * is logged via console.error so Vercel keeps the evidence.
 */
export async function loadManualDataFor(isoDate: string): Promise<ManualData> {
  const key = kvKeyForDate(isoDate);
  if (!hasKv) {
    return (memoryStore.get(key) as ManualData | undefined) ?? emptyManualData();
  }
  let lastErr: unknown = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const raw = await kv.get<ManualData>(key);
      return raw ?? emptyManualData();
    } catch (e) {
      lastErr = e;
      console.error(`[store] kv.get failed (attempt ${attempt}/3)`, { key, error: e instanceof Error ? e.message : String(e) });
      if (attempt < 3) await new Promise((r) => setTimeout(r, 150 * attempt));
    }
  }
  console.error(`[store] kv.get gave up after 3 attempts, returning EMPTY day`, { key, error: lastErr instanceof Error ? lastErr.message : String(lastErr) });
  return emptyManualData();
}

export async function saveManualDataFor(isoDate: string, data: ManualData): Promise<void> {
  const key = kvKeyForDate(isoDate);
  if (hasKv) {
    await kv.set(key, data);
  } else {
    memoryStore.set(key, data);
  }
}

// Convenience: today's London date.
export async function loadManualData(): Promise<ManualData> {
  return loadManualDataFor(londonDateIso());
}
export async function saveManualData(data: ManualData): Promise<void> {
  return saveManualDataFor(londonDateIso(), data);
}
