import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { updateDeal, deleteDeal } from "@/lib/reci/db";
import { DEAL_STATUSES } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
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
  const deal = await updateDeal(id, patch, session.username);
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true, deal });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const ok = await deleteDeal(Number(params.id), session.username);
  if (!ok) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
