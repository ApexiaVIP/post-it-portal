/**
 * GET    /api/qa/cases/[id]  -> case, calls (with transcripts), the
 *                               suitability report's details and the
 *                               latest run per gate.
 * PATCH  /api/qa/cases/[id]  -> edit client_name / adviser_id / case_type / notes
 * DELETE /api/qa/cases/[id]  -> soft delete (and drop any held audio)
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase, getCalls } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

// A run still "running" after this long was cut off by the platform's
// time limit; report it as failed rather than spinning forever.
const STALE_RUN_MINUTES = 6;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  const qaCase = await getCase(id);
  if (!qaCase) return NextResponse.json({ error: "not found" }, { status: 404 });

  await sql`
    UPDATE qa_runs SET status = 'failed', error = 'Timed out before finishing. Please run it again.',
           finished_at = now()
     WHERE case_id = ${id} AND status = 'running'
       AND started_at < now() - make_interval(mins => ${STALE_RUN_MINUTES})`;

  const [calls, doc, runs] = await Promise.all([
    getCalls(id),
    sql`SELECT id, filename, mime_type, octet_length(data)::int AS size_bytes,
               uploaded_by, uploaded_at::text AS uploaded_at
          FROM qa_documents WHERE case_id = ${id} AND deleted_at IS NULL
         ORDER BY uploaded_at DESC LIMIT 1`,
    sql`SELECT DISTINCT ON (gate) id, gate, status, model, result, error, usage, started_by,
               started_at::text AS started_at, finished_at::text AS finished_at
          FROM qa_runs WHERE case_id = ${id}
         ORDER BY gate, started_at DESC`,
  ]);
  const runIds = runs.rows.map((r) => r.id as number);
  const reviews = runIds.length
    ? await sql.query(
        `SELECT run_id, item_key, confirmed_result, note, reviewed_by, reviewed_at::text AS reviewed_at
           FROM qa_review_items WHERE run_id = ANY($1::int[])`, [runIds])
    : { rows: [] };
  return NextResponse.json({
    case: qaCase,
    calls,
    document: doc.rows[0] ?? null,
    runs: runs.rows,
    reviews: reviews.rows,
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  const existing = await getCase(id);
  if (!existing) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as Record<string, unknown>;
  const clientName = typeof body.client_name === "string" && body.client_name.trim()
    ? body.client_name.trim().slice(0, 200) : existing.client_name;
  const adviserId = "adviser_id" in body
    ? (Number(body.adviser_id) > 0 ? Number(body.adviser_id) : null) : existing.adviser_id;
  const caseType = body.case_type === "one_call" || body.case_type === "two_call" ? body.case_type : existing.case_type;
  const notes = "notes" in body ? (String(body.notes ?? "").trim().slice(0, 2000) || null) : existing.notes;
  const dealId = "deal_id" in body ? (Number(body.deal_id) > 0 ? Number(body.deal_id) : null) : existing.deal_id;
  await sql`
    UPDATE qa_cases SET client_name = ${clientName}, adviser_id = ${adviserId},
           case_type = ${caseType}, notes = ${notes}, deal_id = ${dealId}, updated_at = now()
     WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  await sql`DELETE FROM qa_upload_chunks WHERE call_id IN (SELECT id FROM qa_calls WHERE case_id = ${id})`;
  await sql`UPDATE qa_cases SET deleted_at = now() WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
