/**
 * GET    /api/advice-check/[id]  -> the check, what changed since the check it
 *                                   repeats, and (once the sale's calls are in)
 *                                   its statements tested against the calls
 * DELETE /api/advice-check/[id]  -> remove it, and any pages still held
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdviceCheck, getCheck, canSee } from "@/lib/advice/db";
import { expireStaleChecks } from "@/lib/advice/run";
import { runCostUsd } from "@/lib/qa/cost";
import type { AdviceCheckResult } from "@/lib/advice/shared";
import type { StatementsRunResult } from "@/lib/qa/schemas";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  await expireStaleChecks();
  const c = await getCheck(Number(params.id));
  if (!c || !canSee(u, c)) return NextResponse.json({ error: "not found" }, { status: 404 });

  const pages = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM advice_check_pages WHERE check_id = ${c.id}`;
  const prev = c.previous_id
    ? (await sql<{ id: number; created_at: string; result: AdviceCheckResult | null }>`
        SELECT id, created_at::text AS created_at, result FROM advice_checks WHERE id = ${c.previous_id}`).rows[0] ?? null
    : null;
  const next = await sql<{ id: number }>`
    SELECT id FROM advice_checks WHERE previous_id = ${c.id} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1`;

  // The check against the calls, run on the sale in Call QA (Gate 4).
  const stmts = c.qa_case_id
    ? (await sql<{ id: number; status: string; result: StatementsRunResult | null; error: string | null; finished_at: string | null }>`
        SELECT id, status, result, error, finished_at::text AS finished_at FROM qa_runs
         WHERE case_id = ${c.qa_case_id} AND gate = 4 AND (status <> 'done' OR (result->>'from_check')::int = ${c.id})
         ORDER BY started_at DESC LIMIT 1`).rows[0] ?? null
    : null;

  const { usage, standards, ...check } = c;
  return NextResponse.json({
    check,
    pages: pages.rows[0]?.n ?? 0,
    previous: prev ? { id: prev.id, created_at: prev.created_at, gaps: prev.result?.gaps ?? [] } : null,
    next_id: next.rows[0]?.id ?? null,
    against_calls: stmts && (stmts.status !== "done" || stmts.result?.from_check === c.id) ? stmts : null,
    me: { reviewer: u.reviewer },
    ...(u.reviewer ? { cost_usd: runCostUsd(usage), standards } : {}),
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  const c = await getCheck(Number(params.id));
  if (!c || !canSee(u, c)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.status === "running") return NextResponse.json({ error: "Wait for the check to finish first." }, { status: 409 });
  await sql`DELETE FROM advice_check_pages WHERE check_id = ${c.id}`;
  await sql`UPDATE advice_checks SET deleted_at = now() WHERE id = ${c.id}`;
  return NextResponse.json({ ok: true });
}
