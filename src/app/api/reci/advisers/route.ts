import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { listAdvisers } from "@/lib/reci/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const advisers = await listAdvisers();
  return NextResponse.json({ advisers });
}
