/**
 * GET  /api/qa/cases  -> cases (newest first) with call counts and the
 *                        latest Gate 1 / Gate 2 status, plus advisers.
 * POST /api/qa/cases  -> create a case { client_name, adviser_id, case_type, notes }
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET() {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;

  const [cases, advisers] = await Promise.all([
    sql`
      SELECT c.id, c.client_name, c.case_type, c.created_by, c.created_at::text AS created_at, c.outcome,
             a.name AS adviser_name,
             (SELECT COUNT(*)::int FROM qa_calls k WHERE k.case_id = c.id AND k.deleted_at IS NULL) AS calls,
             (SELECT COUNT(*)::int FROM qa_calls k WHERE k.case_id = c.id AND k.deleted_at IS NULL AND k.status = 'ready') AS calls_ready,
             (SELECT r.status FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 1 ORDER BY r.started_at DESC LIMIT 1) AS gate1_status,
             (SELECT r.status FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 2 ORDER BY r.started_at DESC LIMIT 1) AS gate2_status
        FROM qa_cases c LEFT JOIN advisers a ON a.id = c.adviser_id
       WHERE c.deleted_at IS NULL
       ORDER BY c.created_at DESC
       LIMIT 500`,
    sql`SELECT id, name FROM advisers WHERE active = true ORDER BY sort_order, name`,
  ]);
  return NextResponse.json({ cases: cases.rows, advisers: advisers.rows });
}

export async function POST(req: Request) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const body = await req.json().catch(() => null) as {
    client_name?: string; adviser_id?: number | null; case_type?: string; notes?: string;
  } | null;
  const clientName = (body?.client_name ?? "").trim().slice(0, 200);
  if (!clientName) return NextResponse.json({ error: "Client name is required" }, { status: 400 });
  const caseType = body?.case_type === "one_call" ? "one_call" : "two_call";
  const adviserId = Number(body?.adviser_id) > 0 ? Number(body?.adviser_id) : null;
  const notes = (body?.notes ?? "").trim().slice(0, 2000) || null;
  const r = await sql<{ id: number }>`
    INSERT INTO qa_cases (client_name, adviser_id, case_type, notes, created_by)
    VALUES (${clientName}, ${adviserId}, ${caseType}, ${notes}, ${auth.username})
    RETURNING id`;
  return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
}
