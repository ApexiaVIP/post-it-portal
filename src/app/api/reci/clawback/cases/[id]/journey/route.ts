/**
 * Nurture journey control on a single case (Guy's v2 doc, 16 Jul 2026).
 *
 *   GET    -> { active, sends, suggested, phoneConfigured }
 *   POST   -> start a journey       body: { journey: "a"|"b"|"c"|"d" }
 *   DELETE -> stop the active journey (pending sends skipped)
 *
 * Button-first by design: the person pressing Start makes the human
 * suppression checks (open complaint / bereavement / vulnerability) --
 * the UI shows the checklist before enabling the button. One active
 * journey per case, enforced by a partial unique index. Junior sellers
 * can only start/stop journeys on their own cases, same scoping as
 * every other case edit.
 */
import { NextResponse } from "next/server";
import { sql, db } from "@vercel/postgres";
import { getSession, isClawbackUser, getEditableAdviserId } from "@/lib/auth";
import { JOURNEYS, isJourneyKey, journeyForWarning } from "@/lib/reci/journeys";
import { processDueJourneySends } from "@/lib/reci/journey-engine";
import { normaliseUkMobile } from "@/lib/reci/sms";

export const dynamic = "force-dynamic";

async function authAndScope(idRaw: string) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) return { error: "forbidden", status: 403 as const };
  const editable = await getEditableAdviserId(session.username);
  if (editable === undefined) return { error: "forbidden", status: 403 as const };
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return { error: "bad id", status: 400 as const };
  return { session, editable, id };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const a = await authAndScope(params.id);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const caseR = await sql.query<{ ebah_warning: string | null }>(
    `SELECT ebah_warning FROM clawback_cases WHERE id = $1 AND deleted_at IS NULL`,
    [a.id],
  );
  if (caseR.rowCount === 0) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }

  const jr = await sql.query<{
    id: number; journey: string; status: string; started_by: string;
    started_at: string; ended_at: string | null; ended_reason: string | null;
  }>(
    `SELECT id, journey, status, started_by, started_at::text, ended_at::text, ended_reason
       FROM client_journeys
      WHERE case_id = $1
      ORDER BY (status = 'active') DESC, started_at DESC
      LIMIT 1`,
    [a.id],
  );
  const latest = jr.rows[0] ?? null;
  let sends: unknown[] = [];
  if (latest) {
    const sr = await sql.query(
      `SELECT step_key, channel, scheduled_for::text, status, sent_at::text, detail
         FROM journey_sends WHERE journey_id = $1 ORDER BY scheduled_for, id`,
      [latest.id],
    );
    sends = sr.rows;
  }
  return NextResponse.json({
    latest,
    sends,
    suggested: journeyForWarning(caseR.rows[0].ebah_warning),
    phoneConfigured: Boolean((process.env.TOPQUOTE_PHONE || "").trim()),
  });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const a = await authAndScope(params.id);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });

  const body = await req.json().catch(() => ({})) as { journey?: unknown };
  if (!isJourneyKey(body.journey)) {
    return NextResponse.json({ error: "journey must be one of a/b/c/d" }, { status: 400 });
  }
  const def = JOURNEYS[body.journey];

  if (!(process.env.TOPQUOTE_PHONE || "").trim()) {
    return NextResponse.json({
      error: "TOPQUOTE_PHONE isn't configured in Vercel yet. It's the call-us number in every message, so journeys can't start without it.",
    }, { status: 409 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      status: string; deleted_at: string | null; adviser_id: number | null;
      client_email: string | null; client_phone: string | null;
    }>(
      `SELECT status, deleted_at, adviser_id, client_email, client_phone
         FROM clawback_cases WHERE id = $1 FOR UPDATE`,
      [a.id],
    );
    if (cur.rowCount === 0 || cur.rows[0].deleted_at) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const c = cur.rows[0];
    if (typeof a.editable === "number" && c.adviser_id !== a.editable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }
    if (c.status !== "open") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "journeys can only start on open cases" }, { status: 409 });
    }
    const hasEmail = Boolean((c.client_email || "").trim().includes("@"));
    const hasMobile = Boolean(normaliseUkMobile(c.client_phone));
    if (!hasEmail && !hasMobile) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case has no email address and no usable mobile number" }, { status: 409 });
    }

    const ins = await client.query<{ id: number }>(
      `INSERT INTO client_journeys (case_id, journey, started_by)
       VALUES ($1, $2, $3)
       ON CONFLICT DO NOTHING
       RETURNING id`,
      [a.id, def.key, a.session.username],
    );
    if (ins.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "a journey is already active on this case" }, { status: 409 });
    }
    const journeyId = ins.rows[0].id;

    // Precompute every step's date, anchored to today (London): Day 0
    // is the day the button is pressed. Steps whose channel has no
    // contact on file get skipped at send time, not here, so a later
    // data fix picks them up.
    for (const step of def.steps) {
      await client.query(
        `INSERT INTO journey_sends (journey_id, case_id, step_key, channel, scheduled_for)
         VALUES ($1, $2, $3, $4, (now() AT TIME ZONE 'Europe/London')::date + $5::int)`,
        [journeyId, a.id, step.key, step.channel, step.day],
      );
    }
    const emails = def.steps.filter((s) => s.channel === "email").length;
    const smss = def.steps.filter((s) => s.channel === "sms").length;
    await client.query(
      `INSERT INTO clawback_history (case_id, event_type, note, actor)
       VALUES ($1, 'journey', $2, $3)`,
      [a.id, `Journey ${def.key.toUpperCase()} (${def.name}) started: ${emails} emails + ${smss} SMS over ${def.durationDays} days`, a.session.username],
    );
    await client.query("COMMIT");

    // Fire day-0 steps immediately (window rules still apply) so the
    // team sees the first email/SMS go out while the drawer is open.
    const tick = await processDueJourneySends();

    return NextResponse.json({
      ok: true,
      journeyId,
      steps: def.steps.length,
      warnings: [
        ...(!hasEmail ? ["No email address on the case: email steps will be skipped"] : []),
        ...(!hasMobile ? ["No usable mobile number: SMS steps will be skipped"] : []),
      ],
      tick,
    });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

export async function DELETE(
  req: Request,
  { params }: { params: { id: string } },
) {
  const a = await authAndScope(params.id);
  if ("error" in a) return NextResponse.json({ error: a.error }, { status: a.status });

  // Scope check mirrors POST: juniors only touch their own cases.
  if (typeof a.editable === "number") {
    const own = await sql.query(
      `SELECT 1 FROM clawback_cases WHERE id = $1 AND adviser_id = $2`,
      [a.id, a.editable],
    );
    if (own.rowCount === 0) {
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }
  }

  const r = await sql.query<{ id: number; journey: string }>(
    `UPDATE client_journeys
        SET status = 'stopped', ended_at = now(), ended_reason = $2
      WHERE case_id = $1 AND status = 'active'
      RETURNING id, journey`,
    [a.id, `stopped by ${a.session.username}`],
  );
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "no active journey on this case" }, { status: 404 });
  }
  await sql.query(
    `UPDATE journey_sends SET status = 'skipped', detail = 'journey stopped manually'
      WHERE journey_id = ANY($1::int[]) AND status = 'pending'`,
    [r.rows.map((row) => row.id)],
  );
  await sql.query(
    `INSERT INTO clawback_history (case_id, event_type, note, actor)
     VALUES ($1, 'journey', $2, $3)`,
    [a.id, `Journey ${r.rows[0].journey.toUpperCase()} stopped by ${a.session.username}`, a.session.username],
  );
  return NextResponse.json({ ok: true });
}
