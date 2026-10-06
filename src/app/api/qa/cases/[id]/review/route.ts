/**
 * PUT /api/qa/cases/[id]/review
 *   { run_id, items: [{ key, confirmed: string | null, note?: string }] }
 * Records the reviewer's confirmed result for items of a run. The item's
 * section, reference, label and AI result are taken from the stored run,
 * never from the request. confirmed: null removes a verdict.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";
import { gate1Items, gate2Items, CONFIRM_OPTIONS } from "@/lib/qa/review";
import type { Gate1Result, Gate2Result } from "@/lib/qa/schemas";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  const body = await req.json().catch(() => null) as {
    run_id?: number; items?: { key?: string; confirmed?: string | null; note?: string }[];
  } | null;
  const runId = Number(body?.run_id);
  const run = await sql<{ gate: number; status: string; result: unknown }>`
    SELECT gate, status, result FROM qa_runs WHERE id = ${runId} AND case_id = ${caseId}`;
  if (run.rows.length === 0) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const r = run.rows[0];
  const items = r.gate === 1
    ? gate1Items(r.result as Partial<Gate1Result>)
    : gate2Items(r.result as Partial<Gate2Result>);
  const byKey = new Map(items.map((i) => [i.key, i]));

  let saved = 0;
  for (const it of body?.items ?? []) {
    const item = byKey.get(String(it.key));
    if (!item) continue;
    if (it.confirmed === null) {
      await sql`DELETE FROM qa_review_items WHERE run_id = ${runId} AND item_key = ${item.key}`;
      saved++;
      continue;
    }
    if (!CONFIRM_OPTIONS[item.section].includes(String(it.confirmed))) continue;
    const note = (it.note ?? "").toString().trim().slice(0, 1000) || null;
    await sql`
      INSERT INTO qa_review_items (run_id, item_key, case_id, section, ref, label, mandatory,
                                   ai_result, confirmed_result, note, reviewed_by)
      VALUES (${runId}, ${item.key}, ${caseId}, ${item.section}, ${item.ref}, ${item.label},
              ${item.mandatory}, ${item.aiResult}, ${String(it.confirmed)}, ${note}, ${auth.username})
      ON CONFLICT (run_id, item_key) DO UPDATE SET
        confirmed_result = EXCLUDED.confirmed_result, note = EXCLUDED.note,
        reviewed_by = EXCLUDED.reviewed_by, reviewed_at = now()`;
    saved++;
  }
  return NextResponse.json({ ok: true, saved });
}
