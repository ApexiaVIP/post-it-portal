/**
 * PUT /api/reci/clawback/cases/[id]/source
 *
 * Pauline flags a case as Old OW / New OW / Other. Admin only.
 *
 * Body:
 *   { source: "old_ow" | "new_ow" | "other" | null }
 *
 * Writes history so the audit log captures every reconciliation.
 */
import { NextResponse } from "next/server";
import { sql, db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["old_ow","new_ow","other"]);

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !isClawbackAdmin(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as { source?: unknown };
  const raw = body.source;
  let next: string | null;
  if (raw === null || raw === undefined || raw === "") {
    next = null;
  } else if (typeof raw === "string" && ALLOWED.has(raw)) {
    next = raw;
  } else {
    return NextResponse.json({ error: "source must be old_ow | new_ow | other | null" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ id: number; source: string | null }>(
      `SELECT id, source FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const prev = cur.rows[0].source;
    if (prev === next) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, unchanged: true });
    }
    await client.query(
      `UPDATE clawback_cases SET
         source = $1,
         source_updated_by = $2,
         source_updated_at = now(),
         updated_at = now()
       WHERE id = $3`,
      [next, session.username, id],
    );
    await client.query(
      `INSERT INTO clawback_history
         (case_id, event_type, field, old_value, new_value, actor)
       VALUES ($1, 'ebah_change', 'source', $2, $3, $4)`,
      [id, prev, next, session.username],
    );
    await client.query("COMMIT");
    return NextResponse.json({ ok: true, source: next });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
