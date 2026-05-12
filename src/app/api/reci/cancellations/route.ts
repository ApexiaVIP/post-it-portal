import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { cancellationsAll } from "@/lib/reci/db";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const data = await cancellationsAll(year);
  return NextResponse.json({ year, ...data });
}
