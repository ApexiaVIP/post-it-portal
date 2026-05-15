import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { dealTracker, parseScopeFromParams } from "@/lib/reci/tracker";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const scope = parseScopeFromParams(searchParams);
  const result = await dealTracker(year, scope);
  return NextResponse.json(result);
}
