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
import { db } from "@vercel/postgres";
import { getSession, isClawbackUser, getEditableAdviserId } from "@/lib/auth";

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
  };
  const kind = body.kind;
  if (typeof kind !== "string" || !(KINDS as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: "bad kind" }, { status: 400 });
  }
  const k = kind as Kind;

  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  const outcomeRaw = typeof body.outcome === "string" ? body.outcome.trim() : "";

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const existsR = await client.query<{ id: number; adviser_id: number | null }>(
      `SELECT id, adviser_id FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (existsR.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    if (typeof editable === "number" && existsR.rows[0].adviser_id !== editable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }

    if (k === "note") {
      if (noteRaw.length === 0) {
        await client.query("ROLLBACK");
        return NextResponse.json({ error: "note required" }, { status: 400 });
      }
      await client.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
         VALUES ($1, 'note', $2, $3)`,
        [id, noteRaw, session.username],
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
      await client.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
         VALUES ($1, 'contact_attempt', $2, $3)`,
        [id, composed, session.username],
      );
    } else if (k === "money_off") {
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
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
