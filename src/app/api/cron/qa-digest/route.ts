/**
 * Morning (Vercel cron): email what was transcribed and checked overnight.
 * Sends nothing when nothing happened.
 */
import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/qa/cron-auth";
import { buildMorningDigest } from "@/lib/qa/nightly";
import { sendQaMorningDigest } from "@/lib/reci/email";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  const d = await buildMorningDigest();
  if (d.cases.length === 0 && d.transcribed === 0 && d.not_sales === 0 && d.stuck === 0) {
    return NextResponse.json({ ok: true, sent: false, reason: "nothing overnight" });
  }
  const r = await sendQaMorningDigest(d);
  return NextResponse.json({ ok: true, ...r, cases: d.cases.length });
}
