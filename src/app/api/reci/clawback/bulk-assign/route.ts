/**
 * POST /api/reci/clawback/bulk-assign
 *
 * Reassign a batch of cases to a named adviser in one hit. Built for
 * Poz's Xstaff allocation workflow (15 Jul 2026): Guy periodically
 * asks for N Xstaff cases to be handed to Gurdaht / Atikur, and Poz
 * needs to do that herself without a per-case slog through the Edit
 * panel.
 *
 * Body:
 *   { case_ids: number[], adviser_id: number }
 *
 * Every reassigned case gets an ebah_change history row recording the
 * old and new adviser so the timeline shows who moved it and when.
 * Cases that are deleted or already assigned to the target adviser
 * are skipped silently and reported in the response.
 *
 * Admin only (Pauline / Poz / Jimmy).
 */
import { NextResponse } from "next/server";
import { db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const MAX_BATCH = 500;

export async function POST(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !isClawbackAdmin(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as {
    case_ids?: unknown; adviser_id?: unknown;
  };
  const caseIds = Array.isArray(body.case_ids)
    ? Array.from(new Set(body.case_ids.filter(
        (v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0,
      )))
    : [];
  const adviserId = Number(body.adviser_id);
  if (caseIds.length === 0) {
    return NextResponse.json({ error: "case_ids required" }, { status: 400 });
  }
  if (caseIds.length > MAX_BATCH) {
    return NextResponse.json({ error: `max ${MAX_BATCH} cases per batch` }, { status: 400 });
  }
  if (!Number.isFinite(adviserId) || adviserId <= 0) {
    return NextResponse.json({ error: "adviser_id required" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const advR = await client.query<{ id: number; name: string; active: boolean }>(
      `SELECT id, name, active FROM advisers WHERE id = $1`,
      [adviserId],
    );
    if (advR.rowCount === 0 || !advR.rows[0].active) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "adviser not found or inactive" }, { status: 400 });
    }
    const adviserName = advR.rows[0].name;

    // Capture the previous assignment for the history rows, and filter
    // out deleted cases + cases already with the target adviser.
    const prevR = await client.query<{
      id: number; adviser_id: number | null; agent_bucket: string; prev_name: string | null;
    }>(
      `SELECT c.id, c.adviser_id, c.agent_bucket, a.name AS prev_name
       FROM clawback_cases c
       LEFT JOIN advisers a ON a.id = c.adviser_id
       WHERE c.id = ANY($1::int[])
         AND c.deleted_at IS NULL`,
      [caseIds],
    );
    const toMove = prevR.rows.filter((r) => r.adviser_id !== adviserId);
    const skipped = caseIds.length - toMove.length;
    if (toMove.length === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, reassigned: 0, skipped });
    }
    const moveIds = toMove.map((r) => r.id);

    await client.query(
      `UPDATE clawback_cases SET
         adviser_id = $1,
         agent_bucket = 'adviser',
         updated_at = now()
       WHERE id = ANY($2::int[])`,
      [adviserId, moveIds],
    );

    // Per-case history: old assignment label -> new adviser name.
    for (const r of toMove) {
      const oldLabel = r.prev_name
        ?? (r.agent_bucket === "xstaff" ? "Xstaff"
          : r.agent_bucket === "legacy" ? "Legacy"
          : "Needs review");
      await client.query(
        `INSERT INTO clawback_history
           (case_id, event_type, field, old_value, new_value, note, actor)
         VALUES ($1, 'ebah_change', 'adviser_id', $2, $3, $4, $5)`,
        [r.id, oldLabel, adviserName, `Bulk allocation by ${session.username}`, session.username],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true, reassigned: toMove.length, skipped, adviser: adviserName });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
