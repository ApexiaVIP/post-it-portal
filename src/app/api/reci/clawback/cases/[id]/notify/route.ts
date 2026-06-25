/**
 * POST /api/reci/clawback/cases/[id]/notify
 *
 * Send the "new notification" email to the CAM (or Tan + Hayder for an
 * xstaff case) with Guy + management on CC. Idempotent in intent but not
 * in effect -- calling twice will resend, so the UI gates this on
 * notified_at being null and surfaces a confirm before re-notify.
 *
 * Body (optional):
 *   { note?: string }     extra context from Pauline that goes in the email body
 *
 * Auth: jimmy / pauline / poz only.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, canNotifyCam } from "@/lib/auth";
import { sendClawbackNotifyEmail } from "@/lib/reci/email";

export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  // Only Pauline / Jimmy notify a CAM. Sellers receive the email; they
  // don't fire it.
  if (!isClawbackUser(session.username) || !canNotifyCam(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as { note?: unknown };
  const noteRaw = typeof body.note === "string" ? body.note.trim() : "";
  const note = noteRaw.length > 0 ? noteRaw : null;

  const cur = await sql<{
    id: number; client_name: string;
    client_dob: string | null;
    policy_number: string;
    postcode: string | null; provider: string; policy_type: string | null;
    ebah_warning: string | null; ebah_agent_name: string;
    adviser_id: number | null; agent_bucket: string;
    clawback_due: string | null;
    clawback_date: string | null;
    notified_at: string | null;
    ebah_report_date: string | null;
  }>`
    SELECT c.id, c.client_name,
           c.client_dob::text AS client_dob,
           c.policy_number, c.postcode, c.provider, c.policy_type,
           c.ebah_warning, c.ebah_agent_name, c.adviser_id, c.agent_bucket,
           c.clawback_due::text AS clawback_due,
           c.clawback_date::text AS clawback_date,
           c.notified_at::text AS notified_at,
           -- Pull the EBAH report date from the upload that LAST touched
           -- this case so the email shows the most recent L&G snapshot.
           up.report_date::text AS ebah_report_date
    FROM clawback_cases c
    LEFT JOIN clawback_uploads up ON up.id = c.last_seen_upload_id
    WHERE c.id = ${id}
  `;
  if (cur.rowCount === 0) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const c = cur.rows[0];

  const result = await sendClawbackNotifyEmail({
    caseId: c.id,
    clientName: c.client_name,
    clientDob: c.client_dob,
    policyNumber: c.policy_number,
    postcode: c.postcode,
    provider: c.provider,
    policyType: c.policy_type,
    ebahWarning: c.ebah_warning,
    clawbackDate: c.clawback_date,
    ebahReportDate: c.ebah_report_date,
    ebahAgentName: c.ebah_agent_name,
    adviserId: c.adviser_id,
    agentBucket: c.agent_bucket,
    pozNote: note,
    actor: session.username,
  });

  if (result.sent) {
    await sql`
      UPDATE clawback_cases
      SET notified_at = COALESCE(notified_at, now()), updated_at = now()
      WHERE id = ${id}
    `;
    await sql`
      INSERT INTO clawback_history (case_id, event_type, note, actor)
      VALUES (${id}, 'email_sent', ${'Notification email sent' + (note ? ' (with note)' : '')}, ${session.username})
    `;
  }

  return NextResponse.json({ ok: result.sent, reason: result.reason });
}
