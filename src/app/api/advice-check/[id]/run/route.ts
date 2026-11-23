/**
 * POST /api/advice-check/[id]/run
 * Runs the check in the background (a new draft, or one that failed) and
 * returns at once; the check's page polls until it is done.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { waitUntil } from "@vercel/functions";
import { requireAdviceCheck, getCheck, canSee } from "@/lib/advice/db";
import { runAdviceCheck } from "@/lib/advice/run";
import { ukStatus, ukModel } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 800;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  const c = await getCheck(Number(params.id));
  if (!c || !canSee(u, c)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.status === "running") return NextResponse.json({ error: "Already running" }, { status: 409 });
  if (c.status === "done") return NextResponse.json({ error: "Already done. Run it again from the check's page." }, { status: 409 });

  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });
  const pages = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM advice_check_pages WHERE check_id = ${c.id}`;
  if (!c.sheet_text && !c.sheet_typed && (pages.rows[0]?.n ?? 0) === 0) {
    return NextResponse.json({ error: "Upload the pages of the sheet, or type it in." }, { status: 400 });
  }

  const started = await sql`
    UPDATE advice_checks SET status = 'running', model = ${ukModel()}, error = NULL, started_at = now(), finished_at = NULL
     WHERE id = ${c.id} AND status IN ('draft', 'failed') RETURNING id`;
  if (started.rows.length === 0) return NextResponse.json({ error: "Already running" }, { status: 409 });
  waitUntil(runAdviceCheck(c.id));
  return NextResponse.json({ ok: true }, { status: 202 });
}
