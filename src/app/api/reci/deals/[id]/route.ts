import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { getDealById, updateDeal, deleteDeal } from "@/lib/reci/db";
import { CANCELLATION_REASONS, DEAL_STATUSES } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  if (!Number.isFinite(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const deal = await getDealById(id);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ deal });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const id = Number(params.id);
  const body = (await req.json().catch(() => null)) as any;
  if (!body) return NextResponse.json({ error: "bad body" }, { status: 400 });
  const patch: any = {};
  const stringFields = ["client","postcode","provider","confirmed_date","poz_listened",
    "miscellaneous","submitted","acc_ref","notes","gl_sp","gl_txt","trust_done","trust_sent"];
  for (const f of stringFields) if (f in body) patch[f] = body[f] != null ? String(body[f]).slice(0, 500) : null;
  if ("no_of_deals" in body) patch.no_of_deals = Number(body.no_of_deals) || 0;
  if ("premium" in body) patch.premium = body.premium != null ? Number(body.premium) : null;
  if ("commission" in body) patch.commission = Number(body.commission) || 0;
  if ("week" in body) patch.week = Number(body.week);
  if ("year" in body) patch.year = Number(body.year);
  if ("status" in body && DEAL_STATUSES.includes(body.status)) patch.status = body.status;
  if ("position" in body) patch.position = Number(body.position) || 0;
  if ("cancellation_reason" in body) {
    if (body.cancellation_reason == null || body.cancellation_reason === "") {
      patch.cancellation_reason = null;
    } else if (CANCELLATION_REASONS.includes(body.cancellation_reason)) {
      patch.cancellation_reason = body.cancellation_reason;
    }
  }
  if ("cancellation_notes" in body) {
    patch.cancellation_notes = body.cancellation_notes != null ? String(body.cancellation_notes).slice(0, 1000) : null;
  }
  const deal = await updateDeal(id, patch, session.username);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deal });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const ok = await deleteDeal(Number(params.id), session.username);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
