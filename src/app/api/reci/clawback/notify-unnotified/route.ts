/**
 * POST /api/reci/clawback/notify-unnotified
 *
 * Backfill helper for cases that landed before auto-Notify shipped, or
 * for cases that slipped through (manual entries with no email, ingest-
 * time SMTP failure, etc).
 *
 * Walks every case with clawback_due > 0 AND notified_at IS NULL,
 * fires the Notify email via the same path the manual button + the
 * ingest auto-Notify use, stamps notified_at, writes an email_sent
 * history row. Returns attempted / sent / failed counts.
 *
 * Admin only -- same gate as the manual Notify endpoint.
 *
 * Optional body { dry_run: true } returns the candidate list without
 * sending so you can sanity-check what would fire before pulling the
 * trigger.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, canNotifyCam } from "@/lib/auth";
import { sendClawbackNotifyEmail } from "@/lib/reci/email";

export const dynamic = "force-dynamic";
// Email sends are slow. Give ourselves headroom in case Poz hits this
// when there are dozens of cases queued.
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !canNotifyCam(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let dryRun = false;
  try {
    const body = await req.json();
    if (body && body.dry_run === true) dryRun = true;
  } catch { /* empty body is fine */ }

  const candidates = await sql<{
    id: number;
    client_name: string;
    client_dob: string | null;
    policy_number: string;
    postcode: string | null;
    provider: string;
    policy_type: string | null;
    ebah_warning: string | null;
    clawback_date: string | null;
    ebah_report_date: string | null;
    ebah_agent_name: string;
    adviser_id: number | null;
    agent_bucket: string;
    source: string | null;
    clawback_due: string;
  }>`
    SELECT c.id, c.client_name,
           c.client_dob::text AS client_dob,
           c.policy_number, c.postcode, c.provider, c.policy_type,
           c.ebah_warning,
           c.clawback_date::text AS clawback_date,
           up.report_date::text AS ebah_report_date,
           c.ebah_agent_name, c.adviser_id, c.agent_bucket,
           c.source,
           c.clawback_due::text AS clawback_due
    FROM clawback_cases c
    LEFT JOIN clawback_uploads up ON up.id = c.last_seen_upload_id
    WHERE c.clawback_due > 0
      AND c.notified_at IS NULL
    ORDER BY c.clawback_due DESC NULLS LAST, c.id ASC
  `;

  if (dryRun) {
    return NextResponse.json({
      ok: true,
      dryRun: true,
      candidateCount: candidates.rowCount,
      candidates: candidates.rows.map((c) => ({
        id: c.id, client_name: c.client_name, policy_number: c.policy_number,
        seller: c.adviser_id ?? c.agent_bucket,
        cb: Number(c.clawback_due),
      })),
    });
  }

  let attempted = 0, sent = 0, failed = 0;
  const failures: { id: number; reason: string }[] = [];

  for (const c of candidates.rows) {
    attempted++;
    try {
      const result = await sendClawbackNotifyEmail({
        caseId:         c.id,
        clientName:     c.client_name,
        clientDob:      c.client_dob,
        policyNumber:   c.policy_number,
        postcode:       c.postcode,
        provider:       c.provider,
        policyType:     c.policy_type,
        ebahWarning:    c.ebah_warning,
        clawbackDate:   c.clawback_date,
        ebahReportDate: c.ebah_report_date,
        ebahAgentName:  c.ebah_agent_name,
        adviserId:      c.adviser_id,
        agentBucket:    c.agent_bucket,
        source:         c.source,
        pozNote:        null,
        actor:         session.username!,
      });
      if (result.sent) {
        sent++;
        await sql`
          UPDATE clawback_cases
          SET notified_at = COALESCE(notified_at, now()), updated_at = now()
          WHERE id = ${c.id}
        `;
        await sql`
          INSERT INTO clawback_history (case_id, event_type, note, actor)
          VALUES (${c.id}, 'email_sent', ${'Backfill Notify by ' + session.username}, ${session.username})
        `;
      } else {
        failed++;
        failures.push({ id: c.id, reason: result.reason || "unknown" });
        console.error(`[notify-unnotified] failed for case ${c.id}:`, result.reason);
      }
    } catch (e) {
      failed++;
      const reason = e instanceof Error ? e.message : String(e);
      failures.push({ id: c.id, reason });
      console.error(`[notify-unnotified] exception for case ${c.id}:`, reason);
    }
  }

  return NextResponse.json({
    ok: true,
    attempted, sent, failed,
    failures: failures.slice(0, 50), // cap to avoid huge responses
  });
}
