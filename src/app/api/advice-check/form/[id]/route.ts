/**
 * GET    /api/advice-check/form/[id]  -> the form and its checks
 * PUT    /api/advice-check/form/[id]  -> save the answers (with the version they were edited from)
 * DELETE /api/advice-check/form/[id]  -> remove the form and clear its answers
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdviceCheck, canSee, type AdviceUser } from "@/lib/advice/db";
import { canUseForms, cleanData, getForm, type FormRow } from "@/lib/factfind/db";
import { expireStaleChecks } from "@/lib/advice/run";
import { summarise, type AdviceCheckResult } from "@/lib/advice/shared";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

async function open(id: string): Promise<{ u: AdviceUser; f: FormRow } | NextResponse> {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  if (!canUseForms(u)) return NextResponse.json({ error: "The online form isn't open to sellers yet." }, { status: 403 });
  const f = await getForm(Number(id));
  if (!f || !canSee(u, f)) return NextResponse.json({ error: "not found" }, { status: 404 });
  return { u, f };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const o = await open(params.id);
  if (o instanceof NextResponse) return o;
  await expireStaleChecks();
  const checks = await sql<{ id: number; status: string; presented: boolean; created_at: string; result: AdviceCheckResult | null }>`
    SELECT id, status, presented, created_at::text AS created_at, result FROM advice_checks
     WHERE fact_find_id = ${o.f.id} AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 20`;
  return NextResponse.json({
    form: o.f,
    checks: checks.rows.map(({ result, ...k }) => ({ ...k, stage: result?.stage ?? null, summary: k.status === "done" ? summarise(result) : null })),
    me: { reviewer: o.u.reviewer },
  });
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const o = await open(params.id);
  if (o instanceof NextResponse) return o;
  if (o.f.purged_at) return NextResponse.json({ error: "This form's answers have been cleared." }, { status: 410 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const data = cleanData(b.data);
  const rev = Number(b.rev);
  if (!data || !Number.isInteger(rev)) return NextResponse.json({ error: "Nothing to save." }, { status: 400 });
  const label = typeof b.client_label === "string" && b.client_label.trim() ? b.client_label.trim().slice(0, 80) : o.f.client_label;
  const caseType = b.case_type === "one_call" || b.case_type === "two_call" ? b.case_type : o.f.case_type;
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  const date = typeof b.fact_find_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(b.fact_find_date) && b.fact_find_date <= today && b.fact_find_date >= "2026-01-01"
    ? b.fact_find_date : o.f.fact_find_date;
  const presented = typeof b.presented === "boolean" ? b.presented : o.f.presented;
  const r = await sql<{ rev: number; updated_at: string }>`
    UPDATE fact_finds SET data = ${JSON.stringify(data)}::jsonb, client_label = ${label}, case_type = ${caseType},
           fact_find_date = ${date}, presented = ${presented}, rev = rev + 1, updated_at = now()
     WHERE id = ${o.f.id} AND rev = ${rev} AND deleted_at IS NULL RETURNING rev, updated_at::text AS updated_at`;
  if (r.rows.length === 0) {
    return NextResponse.json({ error: "This form was changed somewhere else. Reload the page to get the latest.", conflict: true }, { status: 409 });
  }
  return NextResponse.json({ ok: true, rev: r.rows[0].rev, updated_at: r.rows[0].updated_at });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const o = await open(params.id);
  if (o instanceof NextResponse) return o;
  const running = await sql`SELECT 1 FROM advice_checks WHERE fact_find_id = ${o.f.id} AND status = 'running' AND deleted_at IS NULL`;
  if (running.rows.length > 0) return NextResponse.json({ error: "Wait for the check to finish first." }, { status: 409 });
  await sql`UPDATE fact_finds SET deleted_at = now(), data = '{}'::jsonb WHERE id = ${o.f.id}`;
  await sql`UPDATE advice_checks SET sheet_typed = NULL, sheet_text = NULL, deleted_at = now() WHERE fact_find_id = ${o.f.id} AND qa_case_id IS NULL AND deleted_at IS NULL`;
  return NextResponse.json({ ok: true });
}
