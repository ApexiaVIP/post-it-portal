/**
 * POST /api/qa/cases/[id]/calls -> start a call upload
 *   { call_type, call_date, filename, mime_type, size_bytes } -> { id }
 * The audio itself follows in chunks (PUT /api/qa/calls/[id]/chunk).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const MAX_BYTES = 250 * 1024 * 1024;
const CALL_TYPES = ["fact_find", "advice", "one_call", "other"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  if (!(await getCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });

  const body = await req.json().catch(() => null) as {
    call_type?: string; call_date?: string; filename?: string; mime_type?: string; size_bytes?: number;
  } | null;
  const callType = CALL_TYPES.includes(body?.call_type ?? "") ? body!.call_type! : "other";
  const callDate = typeof body?.call_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.call_date) ? body.call_date : null;
  const size = Number(body?.size_bytes) || 0;
  if (size <= 0) return NextResponse.json({ error: "Empty file" }, { status: 400 });
  if (size > MAX_BYTES) return NextResponse.json({ error: "Recording is larger than 250MB" }, { status: 413 });

  const next = await sql<{ n: number }>`
    SELECT COALESCE(MAX(call_number), 0)::int + 1 AS n FROM qa_calls
     WHERE case_id = ${caseId} AND deleted_at IS NULL`;
  const r = await sql<{ id: number }>`
    INSERT INTO qa_calls (case_id, call_number, call_type, call_date, filename, mime_type, size_bytes, created_by)
    VALUES (${caseId}, ${next.rows[0].n}, ${callType}, ${callDate},
            ${(body?.filename ?? "").slice(0, 200) || null}, ${(body?.mime_type ?? "").slice(0, 100) || null},
            ${size}, ${auth.username})
    RETURNING id`;
  return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
}
