/**
 * POST /api/advice-check/form/[id]/check
 * Checks the form as it was last saved, in the background. A repeat stays
 * with the same sale in Call QA.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { waitUntil } from "@vercel/functions";
import { requireAdviceCheck, canSee } from "@/lib/advice/db";
import { canUseForms, getForm } from "@/lib/factfind/db";
import { sheetFor } from "@/lib/factfind";
import { sheetText } from "@/lib/factfind/view";
import { runAdviceCheck } from "@/lib/advice/run";
import { ukStatus, ukModel } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 800;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  if (!canUseForms(u)) return NextResponse.json({ error: "The online form isn't open to sellers yet." }, { status: 403 });
  const f = await getForm(Number(params.id));
  if (!f || !canSee(u, f)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (f.purged_at) return NextResponse.json({ error: "This form's answers have been cleared." }, { status: 410 });
  const b = await req.json().catch(() => ({})) as { rev?: number; notes_anyway?: boolean };
  if (b.rev !== f.rev) return NextResponse.json({ error: "Save the form first.", conflict: true }, { status: 409 });

  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });
  const running = await sql`SELECT 1 FROM advice_checks WHERE fact_find_id = ${f.id} AND status = 'running' AND deleted_at IS NULL`;
  if (running.rows.length > 0) return NextResponse.json({ error: "Already checking this form." }, { status: 409 });

  const prev = (await sql<{ id: number; qa_case_id: number | null; linked_by: string | null; linked_at: string | null }>`
    SELECT id, qa_case_id, linked_by, linked_at::text AS linked_at FROM advice_checks
     WHERE fact_find_id = ${f.id} AND status = 'done' AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`).rows[0];
  const text = sheetText(sheetFor(f.sheet_version), f.data);
  const r = await sql<{ id: number }>`
    INSERT INTO advice_checks (adviser_id, created_by, client_label, case_type, fact_find_date, recommendation, presented, notes_anyway,
                               sheet_typed, previous_id, qa_case_id, linked_by, linked_at, fact_find_id, status, model, started_at)
    VALUES (${f.adviser_id}, ${u.username}, ${f.client_label}, ${f.case_type}, ${f.fact_find_date}, '', ${f.presented}, ${b.notes_anyway === true},
            ${text}, ${prev?.id ?? null}, ${prev?.qa_case_id ?? null}, ${prev?.linked_by ?? null}, ${prev?.linked_at ?? null},
            ${f.id}, 'running', ${ukModel()}, now())
    RETURNING id`;
  waitUntil(runAdviceCheck(r.rows[0].id));
  return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 202 });
}
