import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { listAdvisers } from "@/lib/reci/db";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const advisers = await listAdvisers();
  return NextResponse.json({ advisers });
}
