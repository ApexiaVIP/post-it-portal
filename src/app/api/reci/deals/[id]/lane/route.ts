import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { setCallRecordingsLane } from "@/lib/reci/db";

export const dynamic = "force-dynamic";

/** Drag a Not Yet Submitted sale into or out of the Call recordings column. */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as { call_recordings?: unknown } | null;
  if (typeof body?.call_recordings !== "boolean") {
    return NextResponse.json({ error: "call_recordings must be true or false" }, { status: 400 });
  }
  const deal = await setCallRecordingsLane(Number(params.id), body.call_recordings, session.username);
  if (!deal) return NextResponse.json({ error: "Only Not Yet Submitted sales can move between these columns" }, { status: 409 });
  return NextResponse.json({ ok: true, deal });
}
