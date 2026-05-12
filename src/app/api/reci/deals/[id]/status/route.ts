import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { changeDealStatus } from "@/lib/reci/db";
import { CANCELLATION_REASONS, DEAL_STATUSES, type CancellationReason } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const body = (await req.json().catch(() => null)) as any;
  if (!body?.status || !DEAL_STATUSES.includes(body.status)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  let reason: CancellationReason | undefined = undefined;
  let notes: string | null = null;
  if (body.status === "cancelled") {
    if (!body.reason || !CANCELLATION_REASONS.includes(body.reason)) {
      return NextResponse.json({ error: "cancellation reason required" }, { status: 400 });
    }
    reason = body.reason as CancellationReason;
    notes = body.notes != null ? String(body.notes).slice(0, 1000) : null;
  }
  try {
    const deal = await changeDealStatus(
      Number(params.id),
      body.status,
      session.username,
      { reason, notes, position: Number(body.position ?? 0) },
    );
    if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true, deal });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "status change failed" },
      { status: 400 },
    );
  }
}
