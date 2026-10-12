/**
 * Overnight (Vercel cron, every 10 minutes in the early hours): transcribe
 * and sort waiting recordings, then check completed sales.
 */
import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/qa/cron-auth";
import { sharepointConfigured } from "@/lib/qa/sharepoint";
import { processNight } from "@/lib/qa/nightly";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  if (!sharepointConfigured() || !process.env.DEEPGRAM_API_KEY || !process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ skipped: "Call QA keys not configured" });
  }
  const result = await processNight();
  console.log("[qa-process]", JSON.stringify(result));
  return NextResponse.json({ ok: true, ...result });
}
