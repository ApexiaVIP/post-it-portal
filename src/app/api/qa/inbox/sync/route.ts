/**
 * POST /api/qa/inbox/sync -> look in SharePoint for new recordings now.
 */
import { NextResponse } from "next/server";
import { requireCallQA } from "@/lib/qa/db";
import { sharepointConfigured } from "@/lib/qa/sharepoint";
import { syncInbox } from "@/lib/qa/inbox";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function POST() {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  if (!sharepointConfigured()) {
    return NextResponse.json({ error: "The SharePoint connection is not set up yet." }, { status: 503 });
  }
  try {
    return NextResponse.json({ ok: true, ...(await syncInbox()) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 502 });
  }
}
