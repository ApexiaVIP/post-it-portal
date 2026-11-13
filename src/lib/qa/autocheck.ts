/**
 * After Poz presses Transcribe on a sale (22 Oct 2026): once all of that
 * sale's calls are transcribed, run the call check (Gate 1) on its own and
 * email that the report is ready. Only sales Poz chose are checked; cases
 * made any other way are left for a person to run.
 */
import { sql } from "@vercel/postgres";
import { getCalls } from "./db";
import { runGate1 } from "./analyse";
import { ukStatus, ukModel } from "./uk";
import { sendQaReportReady } from "@/lib/reci/email";
import { ACCOUNT_BLOCKED, SERVICE_BUSY, plainReason } from "./shared";

/**
 * A check that was stopped at the time limit, or turned away because the
 * AWS account's per-minute limit was reached, is tried again quietly (only
 * its missing parts run, see runGate1) up to this many times in all for the
 * same calls before the outcome is emailed and it is left for a person.
 */
const MAX_RETRIES = 4;

/** Retryable failures for a sale since its calls last changed. */
async function retriesSoFar(caseId: number): Promise<number> {
  const r = await sql<{ n: number }>`
    SELECT COUNT(*)::int AS n FROM qa_runs t
     WHERE t.case_id = ${caseId} AND t.gate = 1
       AND (t.error ILIKE 'Timed out%' OR t.error ~* '429|throttl|too many')
       AND t.started_at > (SELECT MAX(updated_at) FROM qa_calls WHERE case_id = ${caseId} AND deleted_at IS NULL)`;
  return r.rows[0]?.n ?? 0;
}

/**
 * Sale cases whose calls are all transcribed and haven't been checked
 * since. A check that failed only because AWS hasn't switched the AI on
 * for the account (whether it ran automatically or someone pressed Run)
 * is retried quietly every hour, so waiting sales run as soon as it is.
 * Timed-out and busy checks are retried after 10 minutes (exported for tests).
 */
export async function casesReadyForAutoCheck(limit: number) {
  const r = await sql<{ id: number; case_type: "one_call" | "two_call" }>`
    WITH latest AS (
      SELECT case_id, MAX(updated_at) AS at,
             COUNT(*) FILTER (WHERE status = 'transcribing') AS pending,
             COUNT(*) FILTER (WHERE status = 'ready') AS ready
        FROM qa_calls WHERE deleted_at IS NULL GROUP BY case_id
    ), last_run AS (
      SELECT DISTINCT ON (case_id) case_id, status, started_at, started_by, error
        FROM qa_runs WHERE gate = 1 ORDER BY case_id, started_at DESC
    )
    SELECT c.id, c.case_type
      FROM qa_cases c JOIN latest l ON l.case_id = c.id LEFT JOIN last_run lr ON lr.case_id = c.id
     WHERE c.deleted_at IS NULL AND c.deal_id IS NOT NULL
       AND l.pending = 0 AND l.ready > 0
       AND (lr.case_id IS NULL
         OR (lr.started_at < l.at AND NOT (lr.status = 'running' AND lr.started_at > now() - interval '15 minutes'))
         OR (lr.status = 'failed' AND lr.error ~* 'not available for this account'
             AND lr.started_at < now() - interval '1 hour')
         OR (lr.status = 'failed' AND (lr.error ILIKE 'Timed out%' OR lr.error ~* '429|throttl|too many')
             AND lr.started_at < now() - interval '10 minutes'
             AND (SELECT COUNT(*) FROM qa_runs t
                   WHERE t.case_id = c.id AND t.gate = 1
                     AND (t.error ILIKE 'Timed out%' OR t.error ~* '429|throttl|too many')
                     AND t.started_at > l.at) < ${MAX_RETRIES}))
     ORDER BY l.at
     LIMIT ${limit}`;
  return r.rows;
}

/**
 * A check the server stopped at its time limit (maxDuration on the routes
 * that run checks) never gets to record an outcome and would show as
 * running for ever, blocking its sale from being checked again. Anything
 * still running after 15 minutes is marked as timed out (12 Nov 2026: the
 * first real check, Bailey's hour-long call, hit the old 5-minute limit).
 */
async function expireStaleRuns() {
  await sql`
    UPDATE qa_runs SET status = 'failed', finished_at = now(),
           error = 'Timed out: the check took longer than the server allows.'
     WHERE status = 'running' AND started_at < now() - interval '15 minutes'`;
}

/** Check the next waiting sale, if any, and email the outcome. */
export async function autoCheckNext(): Promise<{ caseId: number; status: string } | null> {
  if (!ukStatus().ready) return null;
  await expireStaleRuns();
  const [next] = await casesReadyForAutoCheck(1);
  if (!next) return null;

  const calls = (await getCalls(next.id)).filter((k) => k.status === "ready");
  const run = await sql<{ id: number }>`
    INSERT INTO qa_runs (case_id, gate, status, model, started_by)
    VALUES (${next.id}, 1, 'running', ${ukModel()}, 'automatic') RETURNING id`;
  await runGate1(run.rows[0].id, calls, next.case_type);

  const done = (await sql<{ status: string; error: string | null; result: unknown; client_name: string; adviser: string | null }>`
    SELECT r.status, r.error, r.result, c.client_name, a.name AS adviser
      FROM qa_runs r JOIN qa_cases c ON c.id = r.case_id LEFT JOIN advisers a ON a.id = c.adviser_id
     WHERE r.id = ${run.rows[0].id}`).rows[0];
  const res = (done.result ?? {}) as {
    observation?: { checks?: { result: string }[] };
    disclosures?: { disclosures?: { result: string }[] };
    consistency?: { priorities_followthrough?: { recap: { result: string }; items: { addressed: string }[] } };
  };
  const pf = res.consistency?.priorities_followthrough;
  const checks = res.observation?.checks ?? [];
  // While AWS has the AI switched off for the account, every sale would
  // fail the same way: retry quietly instead of emailing each time.
  if (done.status !== "done" && ACCOUNT_BLOCKED.test(done.error ?? "")) {
    return { caseId: next.id, status: "waiting for AWS" };
  }
  if (done.status !== "done" && SERVICE_BUSY.test(done.error ?? "") && (await retriesSoFar(next.id)) < MAX_RETRIES) {
    return { caseId: next.id, status: "busy, will retry" };
  }
  const mail = await sendQaReportReady({
    caseId: next.id, client: done.client_name, adviser: done.adviser, ok: done.status === "done",
    fails: checks.filter((k) => k.result === "FAIL").length,
    reviews: checks.filter((k) => k.result === "REVIEW_REQUIRED").length,
    disclosuresMissed: (res.disclosures?.disclosures ?? []).filter((d) => d.result === "MISSING" || d.result === "PARTIAL").length,
    error: done.status === "done" ? null : plainReason(done.error),
    priorities: pf ? {
      recap: pf.recap.result,
      notAddressed: pf.items.filter((p) => p.addressed === "NO" || p.addressed === "PARTIAL").length,
    } : null,
  });
  if (!mail.sent) console.error("[qa] report email not sent:", mail.reason);
  return { caseId: next.id, status: done.status };
}
