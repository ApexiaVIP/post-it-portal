/**
 * The call 1 check (Gate 6, Guy 26 Nov 2026). On a two-call sale whose fact
 * find call is transcribed and whose advice call isn't in yet, call 1 is
 * checked on its own, against the adviser's online Fact Find, the SAF and the
 * observation form, and gives the points to cover on call 2. Once the advice
 * call is in, the full call check (Gate 1) takes over as before.
 */
import { sql } from "@vercel/postgres";
import { getCase, getCalls } from "./db";
import { runCall1 } from "./analyse";
import { ukModel } from "./uk";
import { ACCOUNT_BLOCKED, DAILY_LIMIT, SERVICE_BUSY, plainReason, type QaCall } from "./shared";
import type { Call1RunResult } from "./schemas";
import { sheetFor } from "@/lib/factfind";
import { sheetText } from "@/lib/factfind/view";
import type { Data } from "@/lib/factfind/types";
import { sendQaCall1Ready } from "@/lib/reci/email";

/** Busy or timed-out checks are tried again hourly up to this many times for the same calls. */
const MAX_RETRIES = 4;

/** The fact find calls a call 1 check reads. */
export function call1Calls(calls: QaCall[]): QaCall[] {
  return calls.filter((k) => k.status === "ready" && k.call_type === "fact_find");
}

/**
 * The online Fact Find behind the seller's advice check linked to the sale,
 * as the form holds it now, or the sheet the check read if it had no form.
 */
export async function factFindForCase(caseId: number): Promise<{ id: number; text: string } | null> {
  const k = (await sql<{ fact_find_id: number | null; sheet_text: string | null }>`
    SELECT fact_find_id, sheet_text FROM advice_checks
     WHERE qa_case_id = ${caseId} AND deleted_at IS NULL
     ORDER BY created_at DESC LIMIT 1`).rows[0];
  if (!k) return null;
  if (k.fact_find_id) {
    const f = (await sql<{ id: number; sheet_version: string; data: Data; purged_at: string | null }>`
      SELECT id, sheet_version, data, purged_at::text AS purged_at FROM fact_finds
       WHERE id = ${k.fact_find_id} AND deleted_at IS NULL`).rows[0];
    if (f && !f.purged_at) return { id: f.id, text: sheetText(sheetFor(f.sheet_version), f.data ?? {}) };
  }
  return k.sheet_text ? { id: 0, text: k.sheet_text } : null;
}

export type Call1Start = { runId: number; run: () => Promise<void> } | { error: string; status: number };

export async function startCall1(caseId: number, startedBy: string): Promise<Call1Start> {
  const c = await getCase(caseId);
  if (!c) return { error: "case not found", status: 404 };
  if (c.case_type !== "two_call") return { error: "The call 1 check is for two-call sales.", status: 400 };
  const calls = call1Calls(await getCalls(caseId));
  if (calls.length === 0) return { error: "Transcribe the fact find call first, with its call type set to Fact Find call.", status: 400 };
  const running = await sql`
    SELECT 1 FROM qa_runs WHERE case_id = ${caseId} AND gate = 6 AND status = 'running'
       AND started_at > now() - interval '15 minutes'`;
  if (running.rows.length > 0) return { error: "Already running", status: 409 };
  const sheet = await factFindForCase(caseId);
  const run = await sql<{ id: number }>`
    INSERT INTO qa_runs (case_id, gate, status, model, started_by)
    VALUES (${caseId}, 6, 'running', ${ukModel()}, ${startedBy}) RETURNING id`;
  const runId = run.rows[0].id;
  return { runId, run: async () => { await runCall1(runId, calls, c.case_type, sheet); } };
}

/**
 * Two-call sales on the RECI whose fact find call is transcribed, whose
 * advice call isn't in, and whose call 1 hasn't been checked since the calls
 * last changed. A check turned away by AWS (switched off, daily allowance
 * used, busy) or stopped at the time limit is retried hourly; busy and
 * time-outs at most MAX_RETRIES times (exported for tests).
 */
export async function casesReadyForCall1(limit: number) {
  const r = await sql<{ id: number }>`
    WITH latest AS (
      SELECT case_id, MAX(updated_at) AS at,
             COUNT(*) FILTER (WHERE status = 'transcribing') AS pending,
             COUNT(*) FILTER (WHERE status = 'ready' AND call_type = 'fact_find') AS ff,
             COUNT(*) FILTER (WHERE status = 'ready' AND call_type IN ('advice', 'one_call')) AS adv
        FROM qa_calls WHERE deleted_at IS NULL GROUP BY case_id
    ), last_run AS (
      SELECT DISTINCT ON (case_id) case_id, status, started_at, error
        FROM qa_runs WHERE gate = 6 ORDER BY case_id, started_at DESC
    )
    SELECT c.id
      FROM qa_cases c JOIN latest l ON l.case_id = c.id LEFT JOIN last_run lr ON lr.case_id = c.id
     WHERE c.deleted_at IS NULL AND c.deal_id IS NOT NULL AND c.case_type = 'two_call'
       AND l.pending = 0 AND l.ff > 0 AND l.adv = 0
       AND (lr.case_id IS NULL
         OR (lr.started_at < l.at AND NOT (lr.status = 'running' AND lr.started_at > now() - interval '15 minutes'))
         OR (lr.status = 'failed' AND lr.error ~* 'not available for this account|tokens per day'
             AND lr.started_at < now() - interval '1 hour')
         OR (lr.status = 'failed' AND (lr.error ILIKE 'Timed out%' OR (lr.error ~* '429|throttl|too many' AND lr.error !~* 'tokens per day'))
             AND lr.started_at < now() - interval '10 minutes'
             AND (SELECT COUNT(*) FROM qa_runs t WHERE t.case_id = c.id AND t.gate = 6 AND t.started_at > l.at) < ${MAX_RETRIES}))
     ORDER BY l.at
     LIMIT ${limit}`;
  return r.rows;
}

/** Check the next waiting call 1, if any, and email Poz the points for call 2. */
export async function autoCall1Next(): Promise<{ caseId: number; status: string } | null> {
  const [next] = await casesReadyForCall1(1);
  if (!next) return null;
  const s = await startCall1(next.id, "automatic");
  if ("error" in s) return { caseId: next.id, status: s.error };
  await s.run();

  const done = (await sql<{ status: string; error: string | null; result: Call1RunResult | null; client_name: string; adviser: string | null }>`
    SELECT r.status, r.error, r.result, c.client_name, a.name AS adviser
      FROM qa_runs r JOIN qa_cases c ON c.id = r.case_id LEFT JOIN advisers a ON a.id = c.adviser_id
     WHERE r.id = ${s.runId}`).rows[0];
  // Turned away by AWS: retried quietly, as the call check is. Busy is only
  // emailed once the retries are used up.
  const err = done.error ?? "";
  if (done.status !== "done" && (ACCOUNT_BLOCKED.test(err) || DAILY_LIMIT.test(err))) {
    return { caseId: next.id, status: "call 1 check waiting for AWS" };
  }
  if (done.status !== "done" && SERVICE_BUSY.test(err)) {
    const tries = (await sql<{ n: number }>`
      SELECT COUNT(*)::int AS n FROM qa_runs WHERE case_id = ${next.id} AND gate = 6
         AND started_at > (SELECT MAX(updated_at) FROM qa_calls WHERE case_id = ${next.id} AND deleted_at IS NULL)`).rows[0]?.n ?? 0;
    if (tries < MAX_RETRIES) return { caseId: next.id, status: "call 1 check busy, will retry" };
  }
  const mail = await sendQaCall1Ready({
    caseId: next.id, client: done.client_name, adviser: done.adviser,
    result: done.status === "done" ? done.result : null,
    error: done.status === "done" ? null : plainReason(done.error),
  });
  if (!mail.sent) console.error("[qa] call 1 email not sent:", mail.reason);
  return { caseId: next.id, status: `call 1 check ${done.status}` };
}
