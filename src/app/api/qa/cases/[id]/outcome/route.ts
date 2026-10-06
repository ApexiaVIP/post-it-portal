/**
 * PUT /api/qa/cases/[id]/outcome  { outcome: "approved" | "approved_with_actions" | "returned" | null, notes }
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const OUTCOMES = ["approved", "approved_with_actions", "returned"];

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  if (!(await getCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as { outcome?: string | null; notes?: string };
  const outcome = body.outcome && OUTCOMES.includes(body.outcome) ? body.outcome : null;
  const notes = (body.notes ?? "").toString().trim().slice(0, 2000) || null;
  if (outcome === null) {
    await sql`UPDATE qa_cases SET outcome = NULL, outcome_notes = NULL, outcome_by = NULL, outcome_at = NULL WHERE id = ${caseId}`;
  } else {
    await sql`
      UPDATE qa_cases SET outcome = ${outcome}, outcome_notes = ${notes},
             outcome_by = ${auth.username}, outcome_at = now(), updated_at = now()
       WHERE id = ${caseId}`;
  }
  return NextResponse.json({ ok: true });
}
