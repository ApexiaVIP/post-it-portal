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
import { sendClawbackNotifyDigestEmail } from "@/lib/reci/email";

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
    WHERE c.deleted_at IS NULL
      AND c.clawback_due > 0
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

  // Group candidates by (adviser_id, agent_bucket) so each routing
  // identity receives ONE digest email containing all of its pending
  // cases, grouped by postcode in the body. Duplicate-surname cases
  // become easy to tell apart in the inbox.
  const groups = new Map<string, {
    adviserId: number | null;
    agentBucket: string;
    rows: typeof candidates.rows;
  }>();
  for (const c of candidates.rows) {
    const key = `${c.adviser_id ?? "null"}|${c.agent_bucket}`;
    const g = groups.get(key);
    if (g) g.rows.push(c);
    else groups.set(key, { adviserId: c.adviser_id, agentBucket: c.agent_bucket, rows: [c] });
  }

  let attempted = 0, sent = 0, failed = 0;
  const failures: { groupKey: string; caseIds: number[]; reason: string }[] = [];

  for (const [key, g] of groups) {
    attempted += g.rows.length;
    const caseIds = g.rows.map((c) => c.id);
    // Pick a report-date hint for the digest header. They should all be
    // the same when this is run right after an upload; if mixed, take
    // the most common one.
    const reportDates = g.rows.map((c) => c.ebah_report_date).filter(Boolean) as string[];
    const ebahReportDate = reportDates[0] ?? null;
    try {
      const result = await sendClawbackNotifyDigestEmail({
        adviserId:   g.adviserId,
        agentBucket: g.agentBucket,
        ebahReportDate,
        actor:       session.username!,
        cases: g.rows.map((c) => ({
          caseId:       c.id,
          clientName:   c.client_name,
          clientDob:    c.client_dob,
          policyNumber: c.policy_number,
          postcode:     c.postcode,
          provider:     c.provider,
          policyType:   c.policy_type,
          ebahWarning:  c.ebah_warning,
          clawbackDate: c.clawback_date,
          source:       c.source,
        })),
      });
      if (result.sent) {
        sent += g.rows.length;
        // Stamp notified_at + a history row on every case in the
        // digest. Single round-trip via ANY($1) for efficiency.
        await sql.query(
          `UPDATE clawback_cases
             SET notified_at = COALESCE(notified_at, now()), updated_at = now()
             WHERE id = ANY($1::int[])`,
          [caseIds],
        );
        await sql.query(
          `INSERT INTO clawback_history (case_id, event_type, note, actor)
             SELECT id, 'email_sent', $2, $3 FROM unnest($1::int[]) AS id`,
          [caseIds, `Backfill Notify (digest) by ${session.username}`, session.username],
        );
      } else {
        failed += g.rows.length;
        failures.push({ groupKey: key, caseIds, reason: result.reason || "unknown" });
        console.error(`[notify-unnotified] digest failed for ${key} (${caseIds.length} cases):`, result.reason);
      }
    } catch (e) {
      failed += g.rows.length;
      const reason = e instanceof Error ? e.message : String(e);
      failures.push({ groupKey: key, caseIds, reason });
      console.error(`[notify-unnotified] digest exception for ${key}:`, reason);
    }
  }

  return NextResponse.json({
    ok: true,
    attempted, sent, failed,
    digestsSent: sent === 0 ? 0 : groups.size - failures.length,
    failures: failures.slice(0, 50),
  });
}
