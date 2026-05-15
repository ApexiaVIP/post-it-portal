import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { analytics, parseFiltersFromParams } from "@/lib/reci/analytics";
import { listAdvisers } from "@/lib/reci/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const filters = parseFiltersFromParams(searchParams);
  const [result, advisers] = await Promise.all([analytics(filters), listAdvisers()]);
  return NextResponse.json({
    ...result,
    advisers: advisers.map((a) => ({ id: a.id, name: a.name })),
  });
}
