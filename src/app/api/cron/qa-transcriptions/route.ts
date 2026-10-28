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
import { autoCheckNext, casesReadyForAutoCheck } from "@/lib/qa/autocheck";
import { sql } from "@vercel/postgres";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  if (!ukStatus().ready) return NextResponse.json({ skipped: "UK processing not set up" });
  await advanceTranscriptions();
  // TEMP diagnostic (28 Oct 2026): daytime retries are being skipped.
  const diag = await sql`SELECT now() AS db_now, clock_timestamp() AS wall, txid_current_if_assigned() AS txid,
                                (SELECT count(*) FROM pg_stat_activity WHERE pid = pg_backend_pid() AND state = 'idle in transaction') AS idle_tx`;
  const due = await casesReadyForAutoCheck(5);
  const checked = await autoCheckNext();
  console.log(`[qa-cron] ${JSON.stringify({ diag: diag.rows[0], due: due.map((d) => d.id), checked })}`);
  return NextResponse.json({ ok: true, checked });
}
