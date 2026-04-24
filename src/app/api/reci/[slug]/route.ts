import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAdviserBySlug, listDealsForAdviser, businessTrackerFor, createDeal } from "@/lib/reci/db";
import { DEAL_STATUSES } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request, { params }: { params: { slug: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const adviser = await getAdviserBySlug(params.slug);
  if (!adviser) return NextResponse.json({ error: "adviser not found" }, { status: 404 });
  const [deals, tracker] = await Promise.all([
    listDealsForAdviser(adviser.id, year),
    businessTrackerFor(adviser.id, year),
  ]);
  return NextResponse.json({ adviser, deals, tracker, year });
}

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const adviser = await getAdviserBySlug(params.slug);
  if (!adviser) return NextResponse.json({ error: "adviser not found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as any;
  if (!body?.client || !body?.week) return NextResponse.json({ error: "client + week required" }, { status: 400 });
  const status = DEAL_STATUSES.includes(body.status) ? body.status : "not_yet_submitted";
  const deal = await createDeal({
    adviser_id: adviser.id,
    year: Number(body.year || new Date().getFullYear()),
    week: Number(body.week),
    client: String(body.client).slice(0, 200),
    postcode: body.postcode ? String(body.postcode).slice(0, 20) : null,
    no_of_deals: Number(body.no_of_deals ?? 1) || 1,
    provider: body.provider ? String(body.provider).slice(0, 60) : null,
    premium: body.premium != null ? Number(body.premium) : null,
    confirmed_date: body.confirmed_date ? String(body.confirmed_date).slice(0, 40) : null,
    poz_listened: body.poz_listened ? String(body.poz_listened).slice(0, 20) : null,
    miscellaneous: body.miscellaneous ? String(body.miscellaneous).slice(0, 120) : null,
    submitted: body.submitted ? String(body.submitted).slice(0, 10) : null,
    acc_ref: body.acc_ref ? String(body.acc_ref).slice(0, 10) : null,
    status,
    commission: Number(body.commission ?? 0) || 0,
    notes: body.notes ? String(body.notes).slice(0, 500) : null,
    gl_sp: body.gl_sp ? String(body.gl_sp).slice(0, 40) : null,
    gl_txt: body.gl_txt ? String(body.gl_txt).slice(0, 40) : null,
    trust_done: body.trust_done ? String(body.trust_done).slice(0, 40) : null,
    trust_sent: body.trust_sent ? String(body.trust_sent).slice(0, 40) : null,
  }, session.username);
  return NextResponse.json({ ok: true, deal }, { status: 201 });
}
