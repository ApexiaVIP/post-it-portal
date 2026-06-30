/**
 * PATCH /api/reci/clawback/cases/[id]
 *
 * Edit a single case. Used for status changes (and the optional status_note
 * captured at the same time). Writes a 'status_change' row to history and,
 * when the new status is a resolved state (saved / resold / dead /
 * reinstated / closed), fires the resolved email to Guy and CCs management.
 *
 * Body:
 *   {
 *     status?:      "open" | "saved" | "resold" | "dead" | "reinstated" | "closed",
 *     status_note?: string,
 *   }
 *
 * Auth: jimmy / pauline / poz only.
 */
import { NextResponse } from "next/server";
import { sql, db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin, getEditableAdviserId } from "@/lib/auth";
import { sendClawbackResolvedEmail } from "@/lib/reci/email";

export const dynamic = "force-dynamic";

const STATUSES = ["open","saved","resold","dead","reinstated","closed"] as const;
type Status = typeof STATUSES[number];

function isStatus(s: unknown): s is Status {
  return typeof s === "string" && (STATUSES as readonly string[]).includes(s);
}

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  // Returns:
  //   undefined - user has no edit rights at all (viewer, anonymous)
  //   null      - user can edit ANY case (admin, senior seller)
  //   number    - user can edit ONLY cases with this adviser_id (junior
  //               seller)
  const editable = await getEditableAdviserId(session.username);
  if (editable === undefined) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as { status?: unknown; status_note?: unknown; lost_reason?: unknown };
  const newStatus = body.status;
  const noteRaw   = typeof body.status_note === "string" ? body.status_note.trim() : "";
  const note      = noteRaw.length > 0 ? noteRaw : null;
  const VALID_LOST_REASONS = new Set(["dead_client","dead_contact","pitched_missed","other"]);
  const lostReasonRaw = typeof body.lost_reason === "string" ? body.lost_reason.trim() : "";
  const lostReason = lostReasonRaw && VALID_LOST_REASONS.has(lostReasonRaw) ? lostReasonRaw : null;

  if (newStatus !== undefined && !isStatus(newStatus)) {
    return NextResponse.json({ error: "bad status" }, { status: 400 });
  }
  if (newStatus === undefined) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }
  // LOST transitions require a lost_reason category so Guy's
  // categorised report has somewhere to put the case.
  if (newStatus === "dead" && !lostReason) {
    return NextResponse.json({ error: "lost_reason required when marking as LOST" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      id: number; status: string; client_name: string;
      ebah_warning: string | null; ebah_agent_name: string;
      adviser_id: number | null; agent_bucket: string; policy_number: string;
      postcode: string | null;
    }>(
      `SELECT id, status, client_name, ebah_warning, ebah_agent_name,
              adviser_id, agent_bucket, policy_number, postcode
       FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const prev = cur.rows[0];
    // Junior sellers (editable is a number) can only touch cases they own.
    // Admins + senior sellers (editable === null) fall through to edit any.
    if (typeof editable === "number" && prev.adviser_id !== editable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }
    if (prev.status === newStatus && !note) {
      await client.query("ROLLBACK");
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // The resolved_at timestamp gets stamped the first time the case moves
    // out of 'open' into a resolved state.
    const resolvedStates = new Set(["saved","resold","dead","reinstated","closed"]);
    const becameResolved = resolvedStates.has(newStatus) && !resolvedStates.has(prev.status);
    // When marking LOST: also stamp lost_reason and clear it on any
    // other status transition so the field stays consistent.
    await client.query(
      `UPDATE clawback_cases SET
         status = $1,
         status_note = $2,
         lost_reason = CASE WHEN $1 = 'dead' THEN $3::text ELSE NULL END,
         resolved_at = CASE WHEN $4::boolean THEN now() ELSE resolved_at END,
         updated_at = now()
       WHERE id = $5`,
      [newStatus, note, lostReason, becameResolved, id],
    );

    await client.query(
      `INSERT INTO clawback_history
         (case_id, event_type, field, old_value, new_value, note, actor)
       VALUES ($1, 'status_change', 'status', $2, $3, $4, $5)`,
      [id, prev.status, newStatus, note, session.username],
    );
    if (newStatus === "dead" && lostReason) {
      await client.query(
        `INSERT INTO clawback_history
           (case_id, event_type, field, old_value, new_value, actor)
         VALUES ($1, 'ebah_change', 'lost_reason', NULL, $2, $3)`,
        [id, lostReason, session.username],
      );
    }

    await client.query("COMMIT");

    // Email Guy + Poz when the case is resolved. Don't block the API response
    // on SMTP -- log and surface the email outcome but always return ok.
    let emailResult: { sent: boolean; reason?: string } | null = null;
    if (becameResolved) {
      emailResult = await sendClawbackResolvedEmail({
        caseId: id,
        clientName: prev.client_name,
        policyNumber: prev.policy_number,
        postcode: prev.postcode,
        newStatus,
        oldStatus: prev.status,
        note,
        actor: session.username,
        ebahAgentName: prev.ebah_agent_name,
        adviserId: prev.adviser_id,
        agentBucket: prev.agent_bucket,
      });
      if (emailResult.sent) {
        await sql`
          INSERT INTO clawback_history (case_id, event_type, note, actor)
          VALUES (${id}, 'email_sent', ${'Resolved email sent (status ' + newStatus + ')'}, ${session.username})
        `;
      }
    }

    return NextResponse.json({ ok: true, newStatus, email: emailResult });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/reci/clawback/cases/[id]
 *
 * Soft-delete a case (Pauline / Poz / Jimmy only). Sets deleted_at = now()
 * so it disappears from every read view -- dashboard, reports, forecast,
 * summary tiles, notify-unnotified, activity feed. The row stays in the
 * DB with its full history so an admin can restore it via SQL if needed.
 *
 * Body (optional):  { reason?: string }
 */
export async function DELETE(
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
  const body = await req.json().catch(() => ({})) as { reason?: unknown };
  const reason = typeof body.reason === "string" ? body.reason.trim() : "";

  const r = await sql`
    UPDATE clawback_cases
       SET deleted_at = now(), updated_at = now()
     WHERE id = ${id} AND deleted_at IS NULL
     RETURNING id
  `;
  if (r.rowCount === 0) {
    return NextResponse.json({ error: "case not found or already deleted" }, { status: 404 });
  }
  await sql`
    INSERT INTO clawback_history (case_id, event_type, note, actor)
    VALUES (${id}, 'note', ${'Case deleted (soft) by ' + session.username + (reason ? ': ' + reason : '')}, ${session.username})
  `;
  return NextResponse.json({ ok: true, deletedId: id });
}
