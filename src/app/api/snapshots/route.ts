import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { listSnapshotTargets, listDatesWithSnapshots } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
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
