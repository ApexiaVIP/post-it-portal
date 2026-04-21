/**
 * Vercel KV wrapper. Falls back to an in-process Map when KV env vars aren't set
 * (useful for local `next dev` without a KV attached).
 */
import { kv } from "@vercel/kv";
import { KV_KEY, ManualData, emptyManualData } from "./schema";

const memoryStore: Map<string, unknown> = new Map();
const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);

export async function loadManualData(): Promise<ManualData> {
  try {
    const raw = hasKv ? await kv.get<ManualData>(KV_KEY) : (memoryStore.get(KV_KEY) as ManualData | undefined);
    return raw ?? emptyManualData();
  } catch {
    return emptyManualData();
  }
}

export async function saveManualData(data: ManualData): Promise<void> {
  if (hasKv) {
    await kv.set(KV_KEY, data);
  } else {
    memoryStore.set(KV_KEY, data);
  }
}
