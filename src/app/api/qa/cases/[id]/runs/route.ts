/**
 * POST /api/qa/cases/[id]/runs  { gate: 1 | 2 }
 * Starts a check in the background and returns at once; the case page
 * polls GET /api/qa/cases/[id] until the run is done.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { waitUntil } from "@vercel/functions";
import { requireCallQA, getCase, getCalls } from "@/lib/qa/db";
import { runGate1, runGate2, QA_MODEL } from "@/lib/qa/analyse";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  if (!(await getCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({})) as { gate?: number };
  const gate = body.gate === 2 ? 2 : 1;

  if (!process.env.ANTHROPIC_API_KEY) {
    return NextResponse.json({ error: "The AI service is not configured yet." }, { status: 503 });
  }
  const running = await sql`
    SELECT 1 FROM qa_runs WHERE case_id = ${caseId} AND gate = ${gate} AND status = 'running'
       AND started_at > now() - make_interval(mins => 6)`;
  if (running.rows.length > 0) return NextResponse.json({ error: "Already running" }, { status: 409 });

  const calls = (await getCalls(caseId)).filter((c) => c.status === "ready");
  if (calls.length === 0) {
    return NextResponse.json({ error: "Upload and transcribe at least one call first." }, { status: 400 });
  }

  let pdf: Buffer | null = null;
  if (gate === 2) {
    const doc = await sql.query<{ data: Buffer }>(
      `SELECT data FROM qa_documents WHERE case_id = $1 AND deleted_at IS NULL
        ORDER BY uploaded_at DESC LIMIT 1`, [caseId],
    );
    if (doc.rows.length === 0) {
      return NextResponse.json({ error: "Upload the suitability report first." }, { status: 400 });
    }
    pdf = Buffer.from(doc.rows[0].data);
  }

  const run = await sql<{ id: number }>`
    INSERT INTO qa_runs (case_id, gate, status, model, started_by)
    VALUES (${caseId}, ${gate}, 'running', ${QA_MODEL}, ${auth.username})
    RETURNING id`;
  const runId = run.rows[0].id;
  waitUntil(gate === 1 ? runGate1(runId, calls) : runGate2(runId, calls, pdf!));
  return NextResponse.json({ ok: true, runId }, { status: 202 });
}
