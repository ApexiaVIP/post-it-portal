/**
 * Every 5 minutes in UK working hours, hourly otherwise (Vercel cron, see
 * vercel.json; the off-hours slowdown lets the Neon database sleep): collect finished transcriptions from
 * Amazon Transcribe in London, then run the call check on the next sale
 * whose calls are all transcribed. Does nothing (one database query) when
 * nothing is waiting. Only recordings Poz pressed Transcribe on ever get
 * here.
 */
import { NextResponse } from "next/server";
import { ukStatus } from "@/lib/qa/uk";
import { advanceTranscriptions } from "@/lib/qa/calls";
import { autoCheckNext } from "@/lib/qa/autocheck";

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
  await advanceTranscriptions();
  const checked = await autoCheckNext();
  return NextResponse.json({ ok: true, checked });
}
