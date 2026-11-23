/**
 * GET    /api/qa/cases/[id]  -> case, calls (with transcripts), the
 *                               suitability report's details and the
 *                               latest run per gate, and whether UK
 *                               processing is set up. Checks on any
 *                               transcription still running.
 * PATCH  /api/qa/cases/[id]  -> edit client_name / adviser_id / case_type / notes
 * DELETE /api/qa/cases/[id]  -> soft delete (and drop any held audio)
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase, getCalls } from "@/lib/qa/db";
import { ukStatus } from "@/lib/qa/uk";
import { advanceTranscriptions, dropHeldAudio } from "@/lib/qa/calls";
import { runCostUsd } from "@/lib/qa/cost";
import { summarise, type AdviceCheckResult } from "@/lib/advice/shared";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

// A run still "running" after this long was cut off by the platform's
// time limit; report it as failed rather than spinning forever.
const STALE_RUN_MINUTES = 15;

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  const qaCase = await getCase(id);
  if (!qaCase) return NextResponse.json({ error: "not found" }, { status: 404 });

  await sql`
    UPDATE qa_runs SET status = 'failed', error = 'Timed out: the check took longer than the server allows.',
           finished_at = now()
     WHERE case_id = ${id} AND status = 'running'
       AND started_at < now() - make_interval(mins => ${STALE_RUN_MINUTES})`;
  await advanceTranscriptions(id);

  const [calls, doc, runs] = await Promise.all([
    getCalls(id),
    sql`SELECT id, filename, mime_type, octet_length(data)::int AS size_bytes,
               uploaded_by, uploaded_at::text AS uploaded_at
          FROM qa_documents WHERE case_id = ${id} AND deleted_at IS NULL
         ORDER BY uploaded_at DESC LIMIT 1`,
    sql`SELECT DISTINCT ON (gate) id, gate, status, model, result, error, usage, standards, started_by,
               started_at::text AS started_at, finished_at::text AS finished_at
          FROM qa_runs WHERE case_id = ${id}
         ORDER BY gate, started_at DESC`,
  ]);
  const runIds = runs.rows.map((r) => r.id as number);
  // Every run on the sale counts towards its cost, retries included.
  const allUsage = await sql`SELECT usage FROM qa_runs WHERE case_id = ${id}`;
  const costUsd = allUsage.rows.reduce((sum, r) => sum + (runCostUsd(r.usage) ?? 0), 0);
  const reviews = runIds.length
    ? await sql.query(
        `SELECT run_id, item_key, confirmed_result, note, reviewed_by, reviewed_at::text AS reviewed_at
           FROM qa_review_items WHERE run_id = ANY($1::int[])`, [runIds])
    : { rows: [] };
  const uk = ukStatus();
  return NextResponse.json({
    case: qaCase,
    calls,
    document: doc.rows[0] ?? null,
    runs: runs.rows.map((r) => ({ ...r, cost_usd: runCostUsd(r.usage) })),
    cost_usd: costUsd,
    reviews: reviews.rows,
    uk: uk.ready ? { ready: true } : { ready: false, reason: uk.reason },
    advice: await adviceForCase(id, qaCase.adviser_id, qaCase.client_name),
  });
}

/**
 * The seller's advice check (23 Nov 2026): the one linked to this sale (the
 * latest, and the latest finished one, whose notes Gate 4 tests), or the
 * seller's recent checks to choose from, closest name first.
 */
async function adviceForCase(caseId: number, adviserId: number | null, clientName: string) {
  type Row = {
    id: number; client_label: string; adviser_name: string | null; created_by: string; created_at: string;
    finished_at: string | null; status: string; qa_case_id: number | null; linked_by: string | null;
    linked_at: string | null; result: AdviceCheckResult | null;
  };
  const cols = `k.id, k.client_label, a.name AS adviser_name, k.created_by, k.created_at::text AS created_at,
                k.finished_at::text AS finished_at, k.status, k.qa_case_id, k.linked_by, k.linked_at::text AS linked_at, k.result`;
  const linked = await sql.query<Row>(
    `SELECT ${cols} FROM advice_checks k LEFT JOIN advisers a ON a.id = k.adviser_id
      WHERE k.qa_case_id = $1 AND k.deleted_at IS NULL ORDER BY k.created_at DESC`, [caseId]);
  const brief = (r: Row) => {
    const { result, ...rest } = r;
    return { ...rest, summary: r.status === "done" ? summarise(result) : null };
  };
  if (linked.rows.length > 0) {
    const latest = linked.rows[0];
    const done = linked.rows.find((r) => r.status === "done" && r.result) ?? null;
    return {
      linked: brief(latest),
      tested: done ? { id: done.id, finished_at: done.finished_at, statements: done.result?.statements ?? [] } : null,
      candidates: [],
    };
  }
  // The seller's checks from the last 60 days not linked to another sale, latest of each repeat only.
  const c = await sql.query<Row>(
    `SELECT ${cols} FROM advice_checks k LEFT JOIN advisers a ON a.id = k.adviser_id
      WHERE k.deleted_at IS NULL AND k.qa_case_id IS NULL AND k.created_at > now() - interval '60 days'
        AND ($1::int IS NULL OR k.adviser_id = $1)
        AND NOT EXISTS (SELECT 1 FROM advice_checks n WHERE n.previous_id = k.id AND n.deleted_at IS NULL)
      ORDER BY k.created_at DESC LIMIT 30`, [adviserId]);
  const words = new Set(clientName.toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 1));
  const score = (r: Row) => r.client_label.toLowerCase().split(/[^a-z]+/).filter((w) => words.has(w)).length;
  const candidates = c.rows
    .map((r) => ({ ...brief(r), name_match: score(r) > 0 }))
    .sort((a, b) => Number(b.name_match) - Number(a.name_match));
  return { linked: null, tested: null, candidates };
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
  const calls = await sql<{ id: number }>`SELECT id FROM qa_calls WHERE case_id = ${id}`;
  await dropHeldAudio(calls.rows.map((r) => r.id));
  await sql`UPDATE qa_cases SET deleted_at = now() WHERE id = ${id}`;
  return NextResponse.json({ ok: true });
}
