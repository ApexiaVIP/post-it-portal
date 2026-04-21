/**
 * Vercel KV wrapper, date-keyed.
 */
import { kv } from "@vercel/kv";
import {
  ManualData, emptyManualData, kvKeyForDate, londonDateIso,
} from "./schema";

const memoryStore: Map<string, unknown> = new Map();
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export async function loadManualDataFor(isoDate: string): Promise<ManualData> {
  const key = kvKeyForDate(isoDate);
  try {
    const raw = hasKv
      ? await kv.get<ManualData>(key)
      : (memoryStore.get(key) as ManualData | undefined);
    return raw ?? emptyManualData();
  } catch {
    return emptyManualData();
  }
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
