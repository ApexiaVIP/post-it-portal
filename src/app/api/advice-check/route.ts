/**
 * GET  /api/advice-check  -> the checks this user may see (a seller's own,
 *                            or everyone's for Call QA users), newest first
 * POST /api/advice-check  -> start a new check as a draft; the pages are
 *                            uploaded next, then it is run
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdviceCheck, getCheck, canSee } from "@/lib/advice/db";
import { expireStaleChecks } from "@/lib/advice/run";
import { summarise, type AdviceCheckResult } from "@/lib/advice/shared";
import { ukStatus } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET() {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  await expireStaleChecks();
  const r = await sql.query<{
    id: number; adviser_id: number | null; adviser_name: string | null; created_by: string; client_label: string;
    case_type: string; fact_find_date: string; status: string; presented: boolean; previous_id: number | null;
    qa_case_id: number | null; created_at: string; finished_at: string | null; result: AdviceCheckResult | null;
  }>(
    `SELECT k.id, k.adviser_id, a.name AS adviser_name, k.created_by, k.client_label, k.case_type,
            k.fact_find_date::text AS fact_find_date, k.status, k.presented, k.previous_id, k.qa_case_id,
            k.created_at::text AS created_at, k.finished_at::text AS finished_at, k.result
       FROM advice_checks k LEFT JOIN advisers a ON a.id = k.adviser_id
      WHERE k.deleted_at IS NULL
        AND ($1::boolean OR k.created_by = $2 OR ($3::int IS NOT NULL AND k.adviser_id = $3))
      ORDER BY k.created_at DESC
      LIMIT 300`,
    [u.reviewer, u.username, u.adviserId],
  );
  const advisers = u.reviewer
    ? (await sql<{ id: number; name: string }>`
        SELECT id, name FROM advisers WHERE username IS NOT NULL AND active ORDER BY name`).rows
    : [];
  const uk = ukStatus();
  return NextResponse.json({
    checks: r.rows.map(({ result, ...k }) => ({ ...k, summary: k.status === "done" ? summarise(result) : null })),
    me: { username: u.username, reviewer: u.reviewer, adviser_id: u.adviserId },
    advisers,
    uk: uk.ready ? { ready: true } : { ready: false, reason: uk.reason },
  });
}

const MAX_TEXT = 30000;

export async function POST(req: Request) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");

  const clientLabel = str(b.client_label).slice(0, 80);
  if (!clientLabel) return NextResponse.json({ error: "Give the client's first name(s)." }, { status: 400 });
  const caseType = b.case_type === "one_call" ? "one_call" : b.case_type === "two_call" ? "two_call" : null;
  if (!caseType) return NextResponse.json({ error: "Say whether it is one call or two." }, { status: 400 });
  const date = str(b.fact_find_date);
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < "2026-01-01") {
    return NextResponse.json({ error: "Give the date of the fact find call." }, { status: 400 });
  }
  // Optional: the recommendation is normally on the sheet's policy pages.
  const recommendation = str(b.recommendation);
  if (recommendation.length > 6000) return NextResponse.json({ error: "The recommendation is too long." }, { status: 400 });
  const typed = str(b.sheet_typed);
  if (typed.length > MAX_TEXT) return NextResponse.json({ error: "The typed sheet is too long." }, { status: 400 });

  // A repeat after a callback stays with the same sale and seller.
  let previous: Awaited<ReturnType<typeof getCheck>> = null;
  if (b.previous_id != null) {
    previous = await getCheck(Number(b.previous_id));
    if (!previous || !canSee(u, previous)) return NextResponse.json({ error: "Earlier check not found." }, { status: 404 });
  }

  // Sellers check their own cases; a reviewer says whose case it is.
  let adviserId: number | null;
  if (previous) {
    adviserId = previous.adviser_id;
  } else if (u.reviewer) {
    adviserId = Number(b.adviser_id) > 0 ? Number(b.adviser_id) : null;
    if (adviserId === null) return NextResponse.json({ error: "Choose the seller." }, { status: 400 });
  } else {
    adviserId = u.adviserId;
    if (adviserId === null) {
      return NextResponse.json({ error: "Your login isn't linked to your adviser record yet. Ask Poz to link it." }, { status: 400 });
    }
  }

  const r = await sql<{ id: number }>`
    INSERT INTO advice_checks (adviser_id, created_by, client_label, case_type, fact_find_date, recommendation,
                               presented, notes_anyway, sheet_typed, previous_id, qa_case_id, linked_by, linked_at)
    VALUES (${adviserId}, ${u.username}, ${clientLabel}, ${caseType}, ${date}, ${recommendation},
            ${b.presented === true}, ${b.notes_anyway === true}, ${typed || null}, ${previous?.id ?? null},
            ${previous?.qa_case_id ?? null}, ${previous?.qa_case_id ? previous.linked_by : null},
            ${previous?.qa_case_id ? previous.linked_at : null})
    RETURNING id`;
  return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
}
