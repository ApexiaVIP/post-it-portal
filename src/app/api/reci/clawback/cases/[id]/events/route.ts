/**
 * POST /api/reci/clawback/cases/[id]/events
 *
 * Append a workflow event to a case. Covers:
 *
 *   { kind: "note", note }
 *     A free-text note. Just lands in history.
 *
 *   { kind: "contact_attempt", note, outcome? }
 *     A call/voicemail/text log. `outcome` is freeform but typically
 *     "spoke to client", "left voicemail", etc. Lands in history.
 *
 *   { kind: "money_off", amount, money_kind: "saved" | "resold" | "reinstated_cancelled", note? }
 *     Records a £ amount against the case. saved/resold bump the matching
 *     running total on clawback_cases (which feeds net_at_risk).
 *
 * Auth: jimmy / pauline / poz only.
 */
import { NextResponse } from "next/server";
import { db, sql } from "@vercel/postgres";
import { getSession, isClawbackUser, getEditableAdviserId } from "@/lib/auth";
import { sendClawbackResolvedEmail } from "@/lib/reci/email";

export const dynamic = "force-dynamic";

const KINDS = ["note","contact_attempt","money_off"] as const;
type Kind = typeof KINDS[number];
const MONEY_KINDS = ["saved","resold","reinstated_cancelled"] as const;
type MoneyKind = typeof MONEY_KINDS[number];

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // null = edit any case; number = edit only own; undefined = no edit.
  const editable = await getEditableAdviserId(session.username);
  if (editable === undefined) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as {
    kind?: unknown; note?: unknown; outcome?: unknown;
    amount?: unknown; money_kind?: unknown;
    also_apply_to?: unknown;
  };
  const kind = body.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const k = kind as Kind;

  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  const outcomeRaw = typeof body.outcome === "string" ? body.outcome.trim() : "";

  // Multi-policy sync (per Poz, 30 Jun 2026): notes and contact_attempts
  // can be echoed to sibling case IDs for the same client. Sanitised
  // below inside the transaction (existence + edit-scope check).
  // Not allowed for money_off -- each policy has its own £ figures.
  const alsoApplyToRaw = Array.isArray(body.also_apply_to)
    ? body.also_apply_to.filter((v): v is number => typeof v === "number" && Number.isFinite(v) && v > 0)
    : [];
  const alsoApplyTo = (k === "note" || k === "contact_attempt")
    ? Array.from(new Set(alsoApplyToRaw)).filter((x) => x !== id)
    : [];

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    // Pull enough state up front to drive the auto-status-flip on
    // money_off (saved/resold) and to feed the Resolved email if the
    // case transitions out of an active state.
    const existsR = await client.query<{
      id: number; adviser_id: number | null; agent_bucket: string;
      status: string; client_name: string; policy_number: string;
      postcode: string | null; ebah_agent_name: string;
    }>(
      `SELECT id, adviser_id, agent_bucket, status, client_name, policy_number,
              postcode, ebah_agent_name
         FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (existsR.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const prev = existsR.rows[0];
    if (typeof editable === "number" && prev.adviser_id !== editable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }

    // If the caller passed also_apply_to, resolve which of those IDs
    // this user is actually allowed to touch. Skip missing / deleted /
    // wrong-adviser cases silently. Result: sanitised list of case IDs
    // we can safely also-write to.
    let siblings: number[] = [];
    if (alsoApplyTo.length > 0) {
      const sibR = await client.query<{ id: number; adviser_id: number | null }>(
        `SELECT id, adviser_id FROM clawback_cases
           WHERE id = ANY($1::int[]) AND deleted_at IS NULL`,
        [alsoApplyTo],
      );
      siblings = sibR.rows
        .filter((r) => typeof editable !== "number" || r.adviser_id === editable)
        .map((r) => r.id);
    }

    if (k === "note") {
      if (noteRaw.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "note required" }, { status: 400 });
      }
      // Insert the note on the primary case + any allowed siblings in
      // one round trip via unnest.
      const targets = [id, ...siblings];
      await client.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
           SELECT case_id, 'note', $2, $3 FROM unnest($1::int[]) AS case_id`,
        [targets, noteRaw, session.username],
      );
    } else if (k === "contact_attempt") {
      // Combine outcome + note so the timeline shows both in one row.
      const composed = outcomeRaw && noteRaw
        ? `${outcomeRaw} -- ${noteRaw}`
        : (outcomeRaw || noteRaw);
      if (!composed) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "outcome or note required" }, { status: 400 });
      }
      const targets = [id, ...siblings];
      await client.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
           SELECT case_id, 'contact_attempt', $2, $3 FROM unnest($1::int[]) AS case_id`,
        [targets, composed, session.username],
      );
    }

    // When the money_off path auto-flips status, hold onto enough
    // info to fire the Resolved email after COMMIT.
    let autoStatusChange: { from: string; to: string } | null = null;

    if (k === "money_off") {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "amount must be > 0" }, { status: 400 });
      }
      const mk = body.money_kind;
      if (typeof mk !== "string" || !(MONEY_KINDS as readonly string[]).includes(mk)) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "bad money_kind" }, { status: 400 });
      }
      const moneyKind = mk as MoneyKind;
      const sumCol = moneyKind === "saved" ? "saved_amount"
                  : moneyKind === "resold" ? "resold_amount"
                  : null;
      if (sumCol) {
        await client.query(
          `UPDATE clawback_cases SET
             ${sumCol} = ${sumCol} + $1::numeric,
             updated_at = now()
           WHERE id = $2`,
          [amount, id],
        );
      }
      await client.query(
        `INSERT INTO clawback_history
           (case_id, event_type, amount, money_kind, note, actor)
         VALUES ($1, 'money_off', $2, $3, $4, $5)`,
        [id, amount, moneyKind, noteRaw || null, session.username],
      );

      // Per Pauline: logging £ saved or £ resold should flip the
      // case status to match, so the assigned CAM sees the case is
      // off their active queue without needing a second click. Only
      // flips from active states (open / reinstated). Doesn't touch
      // lost / closed / already-saved / already-resold cases.
      const ACTIVE = new Set(["open", "reinstated"]);
      const targetStatus = moneyKind === "saved" ? "saved"
                         : moneyKind === "resold" ? "resold"
                         : null;
      if (targetStatus && ACTIVE.has(prev.status)) {
        await client.query(
          `UPDATE clawback_cases SET
             status = $1,
             resolved_at = COALESCE(resolved_at, now()),
             updated_at = now()
           WHERE id = $2`,
          [targetStatus, id],
        );
        await client.query(
          `INSERT INTO clawback_history
             (case_id, event_type, field, old_value, new_value, note, actor)
           VALUES ($1, 'status_change', 'status', $2, $3, $4, $5)`,
          [id, prev.status, targetStatus, `Auto-flipped from £${moneyKind} entry`, session.username],
        );
        autoStatusChange = { from: prev.status, to: targetStatus };
      }
    }

    await client.query("COMMIT");

    // Fire the Resolved email AFTER commit so the case is durably in
    // its new state before the CAM gets notified. Failures are logged
    // but don't fail the request.
    if (autoStatusChange) {
      try {
        const emailResult = await sendClawbackResolvedEmail({
          caseId: id,
          clientName: prev.client_name,
          policyNumber: prev.policy_number,
          postcode: prev.postcode,
          newStatus: autoStatusChange.to,
          oldStatus: autoStatusChange.from,
          note: noteRaw || null,
          actor: session.username!,
          ebahAgentName: prev.ebah_agent_name,
          adviserId: prev.adviser_id,
          agentBucket: prev.agent_bucket,
        });
        if (emailResult.sent) {
          await sql`
            INSERT INTO clawback_history (case_id, event_type, note, actor)
            VALUES (${id}, 'email_sent', ${'Resolved email sent (auto, status ' + autoStatusChange.to + ')'}, ${session.username})
          `;
        }
      } catch (e) {
        console.error(`[events] resolved-email exception for case ${id}:`, e instanceof Error ? e.message : String(e));
      }
    }

    return NextResponse.json({ ok: true, autoStatusChange });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
