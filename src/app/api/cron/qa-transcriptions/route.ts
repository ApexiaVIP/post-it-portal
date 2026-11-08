/**
 * Every 5 minutes in UK working hours, hourly otherwise (Vercel cron, see
 * vercel.json; the off-hours slowdown lets the Neon database sleep): collect finished transcriptions from
 * Amazon Transcribe in London, then run the call check on the next sale
 * whose calls are all transcribed. Only recordings Poz pressed Transcribe
 * on ever get here. Between the hourly runs it skips the database entirely
 * unless the KV busy flag says work is in flight (see lib/qa/busy.ts).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { ukStatus } from "@/lib/qa/uk";
import { advanceTranscriptions } from "@/lib/qa/calls";
import { autoCheckNext } from "@/lib/qa/autocheck";
import { isQaBusy, markQaBusy } from "@/lib/qa/busy";

export const dynamic = "force-dynamic";
// @vercel/postgres sends each query as a fetch, and in a GET route that
// never reads cookies Next.js caches those fetches. A warm instance then
// replayed the first run's answers all day (28 Oct 2026): retries and
// inserts silently did nothing between 06:00 and 20:00.
export const fetchCache = "force-no-store";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  if (!ukStatus().ready) return NextResponse.json({ skipped: "UK processing not set up" });
  const hourly = new Date().getUTCMinutes() < 5;
  if (!hourly && !(await isQaBusy())) return NextResponse.json({ ok: true, idle: true });
  await advanceTranscriptions();
  const checked = await autoCheckNext();
  const waiting = await sql`
    SELECT 1 FROM qa_calls WHERE status = 'transcribing' AND deleted_at IS NULL LIMIT 1`;
  if (checked || waiting.rows.length > 0) await markQaBusy();
  return NextResponse.json({ ok: true, checked });
}
