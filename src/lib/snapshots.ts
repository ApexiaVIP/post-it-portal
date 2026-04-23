/**
 * Full POST IT snapshot — written by the GitHub Actions scraper after
 * each run, read by the dashboard.
 */
import { kv } from "@vercel/kv";
import { ADVISERS, ADVISER_FIELDS, RIC_FIELDS } from "./schema";

const hasKv = Boolean(process.env.KV_REST_API_URL && process.env.KV_REST_API_TOKEN);
const memStore: Map<string, unknown> = new Map();

export interface AutoStats {
  talk_time_mmss: number;
  total_calls: number;
  hellos: number;
}
export interface AutoSourceStats {
  talk_seconds: number;
  total_calls: number;
  hellos: number;
  display?: string;
}

export interface Snapshot {
  capturedAt: string;
  date: string;
  target: string;
  daily_auto: Record<string, AutoStats>;
  daily_manual: Record<string, Record<string, number>>;
  weekly_auto: Record<string, AutoStats>;
  weekly_manual: Record<string, Record<string, number>>;
  ric_daily_auto: AutoStats;
  ric_manual: Record<string, number>;
  ric_comments: string;
  clearvolt_sources: Record<string, AutoSourceStats>;
  cloudtalk_sources: Record<string, AutoSourceStats>;
  cloudtalk_unmapped: string[];
  portal_updated_at: string;
  portal_updated_by: string;
}

function snapshotKey(date: string, target: string): string {
  return `post-it:snap:v1:${date}:${target}`;
}
function latestKey(): string { return "post-it:snap:v1:latest"; }
function datesIndexKey(): string { return "post-it:snap:v1:dates"; }
function targetsIndexKey(date: string): string {
  return `post-it:snap:v1:targets:${date}`;
}

export async function saveSnapshot(s: Snapshot): Promise<void> {
  const key = snapshotKey(s.date, s.target);
  if (hasKv) {
    await kv.set(key, s);
    await kv.set(latestKey(), { date: s.date, target: s.target, capturedAt: s.capturedAt });
    await kv.sadd(datesIndexKey(), s.date);
    await kv.sadd(targetsIndexKey(s.date), s.target);
  } else {
    memStore.set(key, s);
    memStore.set(latestKey(), { date: s.date, target: s.target, capturedAt: s.capturedAt });
  }
}

export async function getSnapshot(date: string, target: string): Promise<Snapshot | null> {
  const key = snapshotKey(date, target);
  if (hasKv) return (await kv.get<Snapshot>(key)) ?? null;
  return (memStore.get(key) as Snapshot | undefined) ?? null;
}

export async function getLatestSnapshot(): Promise<Snapshot | null> {
  let pointer: { date: string; target: string } | null;
  if (hasKv) {
    pointer = (await kv.get<{ date: string; target: string }>(latestKey())) ?? null;
  } else {
    pointer = (memStore.get(latestKey()) as { date: string; target: string } | undefined) ?? null;
  }
  if (!pointer) return null;
  return getSnapshot(pointer.date, pointer.target);
}

export async function listSnapshotTargets(date: string): Promise<string[]> {
  if (hasKv) {
    const members = (await kv.smembers(targetsIndexKey(date))) || [];
    return (members as string[]).sort();
  }
  const prefix = `post-it:snap:v1:${date}:`;
  const out: string[] = [];
  for (const k of memStore.keys()) {
    if (typeof k === "string" && k.startsWith(prefix)) out.push(k.slice(prefix.length));
  }
  return out.sort();
}

export async function listDatesWithSnapshots(): Promise<string[]> {
  if (hasKv) {
    const members = (await kv.smembers(datesIndexKey())) || [];
    return (members as string[]).sort().reverse();
  }
  return [];
}

export { ADVISERS, ADVISER_FIELDS, RIC_FIELDS };
