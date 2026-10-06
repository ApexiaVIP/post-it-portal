/**
 * PATCH  /api/qa/calls/[id] -> { call_type?, call_date?, adviser_speaker? }
 * DELETE /api/qa/calls/[id] -> soft delete (and drop any held audio)
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const CALL_TYPES = ["fact_find", "advice", "one_call", "other"];

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const callId = Number(params.id);
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const cur = await sql<{ call_type: string; call_date: string | null; adviser_speaker: string | null }>`
    SELECT call_type, call_date::text AS call_date, adviser_speaker FROM qa_calls WHERE id = ${callId} AND deleted_at IS NULL`;
  if (cur.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const c = cur.rows[0];
  const callType = CALL_TYPES.includes(String(body.call_type)) ? String(body.call_type) : c.call_type;
  const callDate = "call_date" in body
    ? (typeof body.call_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.call_date) ? body.call_date : null)
    : c.call_date;
  const adviser = typeof body.adviser_speaker === "string" && /^S\d{1,2}$/.test(body.adviser_speaker)
    ? body.adviser_speaker : c.adviser_speaker;
  await sql`
    UPDATE qa_calls SET call_type = ${callType}, call_date = ${callDate}, adviser_speaker = ${adviser}, updated_at = now()
     WHERE id = ${callId}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const callId = Number(params.id);
  await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${callId}`;
  await sql`UPDATE qa_calls SET deleted_at = now(), utterances = NULL WHERE id = ${callId}`;
  return NextResponse.json({ ok: true });
}
