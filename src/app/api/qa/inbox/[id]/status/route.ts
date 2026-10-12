/**
 * PUT /api/qa/inbox/[id]/status { status: "ignored" | "new" } -> ignore / restore a recording.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => ({})) as { status?: string };
  const status = body.status === "ignored" ? "ignored" : body.status === "new" ? "new" : null;
  if (!status) return NextResponse.json({ error: "bad status" }, { status: 400 });
  await sql`
    UPDATE qa_inbox SET status = ${status}, handled_by = ${auth.username}, handled_at = now()
     WHERE id = ${Number(params.id)} AND status <> 'assigned'`;
  return NextResponse.json({ ok: true });
}
