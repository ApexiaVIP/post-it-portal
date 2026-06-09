import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { businessTrackerByAdviser, parseScopeFromParams, businessTrackerByAdviserDebug } from "@/lib/reci/tracker";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const scope = parseScopeFromParams(searchParams);
  const advRaw = (searchParams.get("advisers") || "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isFinite(n));
  const filter = advRaw.length > 0 ? advRaw : null;
  if (searchParams.get("debug") === "1") {
    const dbg = await businessTrackerByAdviserDebug(year, scope, filter);
    return NextResponse.json(dbg);
  }
  const result = await businessTrackerByAdviser(year, scope, filter);
  return NextResponse.json(result);
}
