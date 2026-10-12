/**
 * Evening (Vercel cron): list the day's new recordings from SharePoint.
 */
import { NextResponse } from "next/server";
import { cronDenied } from "@/lib/qa/cron-auth";
import { sharepointConfigured } from "@/lib/qa/sharepoint";
import { syncInbox } from "@/lib/qa/inbox";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function GET(req: Request) {
  const denied = cronDenied(req);
  if (denied) return denied;
  if (!sharepointConfigured()) return NextResponse.json({ skipped: "SharePoint not configured" });
  try {
    return NextResponse.json({ ok: true, ...(await syncInbox()) });
  } catch (e) {
    console.error("[qa-sync]", e);
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
