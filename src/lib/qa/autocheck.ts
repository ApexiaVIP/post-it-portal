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

/** Sale cases whose calls are all transcribed and haven't been checked since (exported for tests). */
export async function casesReadyForAutoCheck(limit: number) {
  const r = await sql<{ id: number; case_type: "one_call" | "two_call" }>`
    WITH latest AS (
      SELECT case_id, MAX(updated_at) AS at,
             COUNT(*) FILTER (WHERE status = 'transcribing') AS pending,
             COUNT(*) FILTER (WHERE status = 'ready') AS ready
        FROM qa_calls WHERE deleted_at IS NULL GROUP BY case_id
    )
    SELECT c.id, c.case_type
      FROM qa_cases c JOIN latest l ON l.case_id = c.id
     WHERE c.deleted_at IS NULL AND c.deal_id IS NOT NULL
       AND l.pending = 0 AND l.ready > 0
       AND NOT EXISTS (SELECT 1 FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 1
                        AND (r.started_at >= l.at OR (r.status = 'running' AND r.started_at > now() - interval '6 minutes')))
       AND (SELECT COUNT(*) FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 1 AND r.status = 'failed'
             AND r.started_at >= l.at - interval '1 day') < 2
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
  const mail = await sendQaReportReady({
    caseId: next.id, client: done.client_name, adviser: done.adviser, ok: done.status === "done",
    fails: checks.filter((k) => k.result === "FAIL").length,
    reviews: checks.filter((k) => k.result === "REVIEW_REQUIRED").length,
    disclosuresMissed: (res.disclosures?.disclosures ?? []).filter((d) => d.result === "MISSING" || d.result === "PARTIAL").length,
    error: done.error,
  });
  if (!mail.sent) console.error("[qa] report email not sent:", mail.reason);
  return { caseId: next.id, status: done.status };
}
