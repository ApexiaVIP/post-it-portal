/**
 * GET /api/reci/clawback/cases/[id]/history
 *
 * Full timeline for one case: every history row newest first. Used by the
 * case-detail drawer.
 *
 * Auth: jimmy / pauline / poz only.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scope = await clawbackAdviserScope(session.username);
  if (scope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  // Sellers can only see history of their own cases.
  if (typeof scope === "number") {
    const c = await sql<{ adviser_id: number | null }>`
      SELECT adviser_id FROM clawback_cases WHERE id = ${id}
    `;
    if (c.rowCount === 0) {
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    if (c.rows[0].adviser_id !== scope) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
  }
  const r = await sql`
    SELECT id, event_type, field, old_value, new_value,
           amount::float AS amount, money_kind, note, actor,
           created_at AT TIME ZONE 'Europe/London' AS created_at
    FROM clawback_history
    WHERE case_id = ${id}
    ORDER BY created_at DESC, id DESC
  `;
  return NextResponse.json({ history: r.rows });
}
