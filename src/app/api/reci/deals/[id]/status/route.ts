import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { changeDealStatus } from "@/lib/reci/db";
import { DEAL_STATUSES } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as any;
  if (!body?.status || !DEAL_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  const deal = await changeDealStatus(Number(params.id), body.status, session.username, Number(body.position ?? 0));
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deal });
}
