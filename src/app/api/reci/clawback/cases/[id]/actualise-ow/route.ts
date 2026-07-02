/**
 * PUT  /api/reci/clawback/cases/[id]/actualise-ow
 * DELETE /api/reci/clawback/cases/[id]/actualise-ow
 *
 * Per Poz 1 Jul 2026. Old Openwork cases rarely actually claw back
 * through the OW bank statement, so they sit in a "Historic Old OW
 * exposure" bucket, excluded from the current-month at-risk figures.
 *
 * When Poz reconciles the OW statement and sees one has actually been
 * clawed back, she promotes it to Actualised: PUT stamps
 * ow_actualised_at + ow_actualised_by and the case moves into the
 * current-month at-risk reporting. DELETE reverts it back to historic
 * for the odd wrong flag.
 *
 * Admin only (Pauline / Poz / Jimmy).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

async function requireAdmin() {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !isClawbackAdmin(session.username)) {
    return { error: NextResponse.json({ error: "forbidden" }, { status: 403 }), session: null };
  }
  return { error: null, session };
}

export async function PUT(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const r = await sql`
    UPDATE clawback_cases
       SET ow_actualised_at = COALESCE(ow_actualised_at, now()),
           ow_actualised_by = COALESCE(ow_actualised_by, ${session!.username}),
           updated_at = now()
     WHERE id = ${id} AND source = 'old_ow' AND deleted_at IS NULL
     RETURNING id
  `;
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "case not found or not Old OW" }, { status: 404 });
  }
  await sql`
    INSERT INTO clawback_history (case_id, event_type, field, old_value, new_value, actor)
    VALUES (${id}, 'ebah_change', 'ow_actualised_at', NULL, 'now', ${session!.username})
  `;
  return NextResponse.json({ ok: true });
}

export async function DELETE(
  _req: Request,
  { params }: { params: { id: string } },
) {
  const { error, session } = await requireAdmin();
  if (error) return error;
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const r = await sql`
    UPDATE clawback_cases
       SET ow_actualised_at = NULL,
           ow_actualised_by = NULL,
           updated_at = now()
     WHERE id = ${id} AND ow_actualised_at IS NOT NULL
     RETURNING id
  `;
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "case not found or not actualised" }, { status: 404 });
  }
  await sql`
    INSERT INTO clawback_history (case_id, event_type, field, old_value, new_value, actor)
    VALUES (${id}, 'ebah_change', 'ow_actualised_at', 'now', NULL, ${session!.username})
  `;
  return NextResponse.json({ ok: true });
}
