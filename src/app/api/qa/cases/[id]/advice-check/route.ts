/**
 * PUT /api/qa/cases/[id]/advice-check  { check_id: number | null }
 *
 * Links the seller's advice check to this sale (or unlinks it). The check's
 * later repeats come with it. Once linked, the draft suitability report is
 * written from the calls and the seller's sheet together, and if the calls
 * have already been checked, the advice check is tested against them
 * straight away (Gate 4).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { waitUntil } from "@vercel/functions";
import { requireCallQA, getCase } from "@/lib/qa/db";
import { ukStatus } from "@/lib/qa/uk";
import { startStatements } from "@/lib/qa/notes-run";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 800;

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  if (!(await getCase(caseId))) return NextResponse.json({ error: "case not found" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as { check_id?: number | null };

  await sql`
    UPDATE advice_checks SET qa_case_id = NULL, linked_by = NULL, linked_at = NULL
     WHERE qa_case_id = ${caseId}`;
  if (body.check_id == null) return NextResponse.json({ ok: true, linked: null });

  const checkId = Number(body.check_id);
  const k = await sql<{ id: number; qa_case_id: number | null }>`
    SELECT id, qa_case_id FROM advice_checks WHERE id = ${checkId} AND deleted_at IS NULL`;
  if (!k.rows[0]) return NextResponse.json({ error: "Advice check not found." }, { status: 404 });
  if (k.rows[0].qa_case_id && k.rows[0].qa_case_id !== caseId) {
    return NextResponse.json({ error: `That check is linked to case ${k.rows[0].qa_case_id}. Unlink it there first.` }, { status: 409 });
  }
  // The check and every later repeat of it.
  await sql`
    WITH RECURSIVE chain AS (
      SELECT id FROM advice_checks WHERE id = ${checkId}
      UNION
      SELECT a.id FROM advice_checks a JOIN chain ON a.previous_id = chain.id WHERE a.deleted_at IS NULL
    )
    UPDATE advice_checks SET qa_case_id = ${caseId}, linked_by = ${auth.username}, linked_at = now()
     WHERE id IN (SELECT id FROM chain) AND (qa_case_id IS NULL OR qa_case_id = ${caseId})`;

  // Test it against the calls now if they have been checked.
  let started = false;
  const g1 = await sql<{ status: string }>`
    SELECT status FROM qa_runs WHERE case_id = ${caseId} AND gate = 1 ORDER BY started_at DESC LIMIT 1`;
  if (g1.rows[0]?.status === "done" && ukStatus().ready) {
    const s = await startStatements(caseId, auth.username);
    if (!("error" in s)) {
      waitUntil(s.run());
      started = true;
    }
  }
  return NextResponse.json({ ok: true, linked: checkId, started });
}
