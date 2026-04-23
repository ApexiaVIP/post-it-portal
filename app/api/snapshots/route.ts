/**
 * GET /api/snapshots?date=YYYY-MM-DD — list all snapshot targets available for that date.
 * Requires session.
 */
import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listSnapshotTargets, listDatesWithSnapshots } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  if (date) {
    const targets = await listSnapshotTargets(date);
    return NextResponse.json({ date, targets });
  }
  const dates = await listDatesWithSnapshots();
  return NextResponse.json({ dates });
}
