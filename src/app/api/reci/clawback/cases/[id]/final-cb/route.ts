/**
 * PUT /api/reci/clawback/cases/[id]/final-cb
 *
 * Pauline overrides the L&G / Openwork clawback figure with the actual
 * FINAL amount once the clawback has been settled. Sits on top of the
 * Openwork override:
 *   final_clawback_due    (when set, canonical -- what actually happened)
 *   openwork_clawback_due (when set, OW reconciled)
 *   clawback_due          (L&G EBAH forecast)
 *
 * Setting to null clears the override and reverts to the lower priority
 * value. Admin only.
 *
 * Body: { amount: number | null, note?: string }
 */
import { NextResponse } from "next/server";
import { sql, db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

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
  const body = await req.json().catch(() => ({})) as { amount?: unknown; note?: unknown };
  const raw = body.amount;
  let next: number | null;
  if (raw === null) {
    next = null;
  } else {
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) {
      return NextResponse.json({ error: "amount must be null or a non-negative number" }, { status: 400 });
    }
    next = n;
  }
  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  const note = noteRaw.length > 0 ? noteRaw : null;

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{ id: number; final_clawback_due: string | null }>(
      `SELECT id, final_clawback_due::text AS final_clawback_due
       FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const prevRaw = cur.rows[0].final_clawback_due;
    const prev = prevRaw === null ? null : Number(prevRaw);
    const same = (prev === null && next === null)
              || (prev !== null && next !== null && Math.abs(prev - next) < 0.005);
    if (same && !note) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, unchanged: true });
    }

    await client.query(
      `UPDATE clawback_cases SET
         final_clawback_due = $1::numeric,
         final_cb_updated_by = $2,
         final_cb_updated_at = now(),
         updated_at = now()
       WHERE id = $3`,
      [next, session.username, id],
    );
    await client.query(
      `INSERT INTO clawback_history
         (case_id, event_type, field, old_value, new_value, note, actor)
       VALUES ($1, 'ebah_change', 'final_clawback_due', $2, $3, $4, $5)`,
      [
        id,
        prev === null ? null : prev.toFixed(2),
        next === null ? null : next.toFixed(2),
        note, session.username,
      ],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, final_clawback_due: next });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
