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
import { ACCOUNT_BLOCKED, plainReason } from "./shared";

/**
 * Sale cases whose calls are all transcribed and haven't been checked
 * since. A check that failed only because AWS hasn't switched the AI on
 * for the account (whether it ran automatically or someone pressed Run)
 * is retried quietly every hour, so waiting sales run as soon as it is
 * (exported for tests).
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
         OR (lr.started_at < l.at AND NOT (lr.status = 'running' AND lr.started_at > now() - interval '6 minutes'))
         OR (lr.status = 'failed' AND lr.error ~* 'not available for this account'
             AND lr.started_at < now() - interval '1 hour'))
     ORDER BY l.at
     LIMIT ${limit}`;
  return r.rows;
}

/** Check the next waiting sale, if any, and email the outcome. */
export async function autoCheckNext(): Promise<{ caseId: number; status: string } | null> {
  if (!ukStatus().ready) return null;
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
  };
  const checks = res.observation?.checks ?? [];
  // While AWS has the AI switched off for the account, every sale would
  // fail the same way: retry quietly instead of emailing each time.
  if (done.status !== "done" && ACCOUNT_BLOCKED.test(done.error ?? "")) {
    return { caseId: next.id, status: "waiting for AWS" };
  }
  const mail = await sendQaReportReady({
    caseId: next.id, client: done.client_name, adviser: done.adviser, ok: done.status === "done",
    fails: checks.filter((k) => k.result === "FAIL").length,
    reviews: checks.filter((k) => k.result === "REVIEW_REQUIRED").length,
    disclosuresMissed: (res.disclosures?.disclosures ?? []).filter((d) => d.result === "MISSING" || d.result === "PARTIAL").length,
    error: done.status === "done" ? null : plainReason(done.error),
  });
  if (!mail.sent) console.error("[qa] report email not sent:", mail.reason);
  return { caseId: next.id, status: done.status };
}
