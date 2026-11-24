/**
 * GET  /api/advice-check/form  -> the Fact Find forms this user may see
 * POST /api/advice-check/form  -> start a new one
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdviceCheck } from "@/lib/advice/db";
import { canUseForms, keepDays } from "@/lib/factfind/db";
import { CURRENT_SHEET } from "@/lib/factfind";
import { summarise, type AdviceCheckResult } from "@/lib/advice/shared";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET() {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  if (!canUseForms(u)) return NextResponse.json({ allowed: false, forms: [] });
  const r = await sql.query<{
    id: number; adviser_id: number | null; adviser_name: string | null; created_by: string; client_label: string; case_type: string;
    fact_find_date: string; presented: boolean; updated_at: string; purged_at: string | null;
    check_id: number | null; check_status: string | null; check_result: AdviceCheckResult | null;
  }>(
    `SELECT f.id, f.adviser_id, a.name AS adviser_name, f.created_by, f.client_label, f.case_type,
            f.fact_find_date::text AS fact_find_date, f.presented, f.updated_at::text AS updated_at, f.purged_at::text AS purged_at,
            k.id AS check_id, k.status AS check_status, k.result AS check_result
       FROM fact_finds f LEFT JOIN advisers a ON a.id = f.adviser_id
       LEFT JOIN LATERAL (
         SELECT id, status, result FROM advice_checks
          WHERE fact_find_id = f.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) k ON true
      WHERE f.deleted_at IS NULL
        AND ($1::boolean OR f.created_by = $2 OR ($3::int IS NOT NULL AND f.adviser_id = $3))
      ORDER BY f.updated_at DESC LIMIT 200`,
    [u.reviewer, u.username, u.adviserId],
  );
  return NextResponse.json({
    allowed: true,
    sellers_open: keepDays() !== null,
    forms: r.rows.map(({ check_result, ...f }) => ({ ...f, summary: f.check_status === "done" ? summarise(check_result) : null })),
  });
}

export async function POST(req: Request) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  if (!canUseForms(u)) return NextResponse.json({ error: "The online form isn't open to sellers yet." }, { status: 403 });
  const b = await req.json().catch(() => ({})) as Record<string, unknown>;
  const label = typeof b.client_label === "string" ? b.client_label.trim().slice(0, 80) : "";
  if (!label) return NextResponse.json({ error: "Give the client's first name(s)." }, { status: 400 });
  const caseType = b.case_type === "one_call" ? "one_call" : "two_call";
  const date = typeof b.fact_find_date === "string" ? b.fact_find_date : "";
  const today = new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date > today || date < "2026-01-01") {
    return NextResponse.json({ error: "Give the date of the fact find call." }, { status: 400 });
  }
  // Sellers fill in their own; Guy, Poz and Jimmy may leave it unassigned to try it out.
  const adviserId = u.reviewer ? (Number(b.adviser_id) > 0 ? Number(b.adviser_id) : null) : u.adviserId;
  if (!u.reviewer && adviserId === null) {
    return NextResponse.json({ error: "Your login isn't linked to your adviser record yet. Ask Poz to link it." }, { status: 400 });
  }
  const r = await sql<{ id: number }>`
    INSERT INTO fact_finds (adviser_id, created_by, client_label, case_type, fact_find_date, sheet_version)
    VALUES (${adviserId}, ${u.username}, ${label}, ${caseType}, ${date}, ${CURRENT_SHEET.version}) RETURNING id`;
  return NextResponse.json({ ok: true, id: r.rows[0].id }, { status: 201 });
}
