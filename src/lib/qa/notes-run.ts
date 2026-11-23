/**
 * The seller's advice check on a Call QA sale (23 Nov 2026): finding the
 * check linked to the sale, and starting Gate 4, which tests its statements
 * against the calls. Gate 4 runs by hand from the case page, when a check is
 * linked to a sale whose calls have been checked, and from the cron once a
 * linked check or a call check finishes.
 */
import { sql } from "@vercel/postgres";
import { getCase, getCalls } from "./db";
import { runStatements } from "./analyse";
import { ukModel } from "./uk";
import { notesText, type AdviceCheckResult, justificationText } from "@/lib/advice/shared";

export interface LinkedCheck {
  id: number;
  sheet_text: string | null;
  result: AdviceCheckResult;
}

/** The latest finished advice check linked to the sale, if any. */
export async function linkedCheck(caseId: number): Promise<LinkedCheck | null> {
  const r = await sql<LinkedCheck>`
    SELECT id, sheet_text, result FROM advice_checks
     WHERE qa_case_id = ${caseId} AND deleted_at IS NULL AND status = 'done' AND result IS NOT NULL
     ORDER BY finished_at DESC LIMIT 1`;
  return r.rows[0] ?? null;
}

/** What Gate 4 is given: the numbered statements, the notes and the sheet. */
function statementsMaterial(k: LinkedCheck): string {
  const lines = k.result.statements.map((s) => `${s.n}. ${s.text} (from: ${s.where}${s.from_adviser ? ", the adviser" : ""})`);
  return [
    "THE STATEMENTS",
    lines.join("\n"),
    "",
    "THE CONCERT HUB NOTES THE CHECK DRAFTED",
    notesText(k.result) || "None.",
    "",
    "THE FACT FIND SHEET AS RECORDED",
    "<sheet>",
    k.sheet_text ?? "Not available.",
    "</sheet>",
  ].join("\n");
}

/** What the draft suitability report is also given: the sheet and the justification drafted from it. */
export function adviserRecordText(k: LinkedCheck): string {
  return [
    "<sheet>", k.sheet_text ?? "Not available.", "</sheet>",
    "",
    "<justification>", justificationText(k.result) || "The check didn't draft a justification (something was missing).", "</justification>",
  ].join("\n");
}

export type StatementsStart =
  | { runId: number; run: () => Promise<void> }
  | { error: string; status: number };

export async function startStatements(caseId: number, startedBy: string): Promise<StatementsStart> {
  const c = await getCase(caseId);
  if (!c) return { error: "case not found", status: 404 };
  const k = await linkedCheck(caseId);
  if (!k) return { error: "No finished advice check is linked to this sale.", status: 400 };
  if (!k.result.statements?.length) {
    return { error: "The seller's advice check stopped at the gap check, so it has no notes to test yet. It will have once they run it again with nothing missing.", status: 400 };
  }
  const running = await sql`
    SELECT 1 FROM qa_runs WHERE case_id = ${caseId} AND gate = 4 AND status = 'running'
       AND started_at > now() - interval '15 minutes'`;
  if (running.rows.length > 0) return { error: "Already running", status: 409 };
  const calls = (await getCalls(caseId)).filter((x) => x.status === "ready");
  if (calls.length === 0) return { error: "No transcribed calls on this case.", status: 400 };

  const run = await sql<{ id: number }>`
    INSERT INTO qa_runs (case_id, gate, status, model, started_by)
    VALUES (${caseId}, 4, 'running', ${ukModel()}, ${startedBy}) RETURNING id`;
  const runId = run.rows[0].id;
  return { runId, run: () => runStatements(runId, calls, c.case_type, { id: k.id, material: statementsMaterial(k) }) };
}

/**
 * A sale whose calls have been checked and whose linked advice check (with
 * notes to test) finished, or was linked, since its last Gate 4. Checks
 * older than a week are left for a person to run by hand.
 */
export async function autoStatementsNext(): Promise<{ caseId: number; status: string } | null> {
  const r = await sql<{ case_id: number }>`
    WITH g1 AS (
      SELECT DISTINCT ON (case_id) case_id, status, finished_at
        FROM qa_runs WHERE gate = 1 ORDER BY case_id, started_at DESC
    ), k AS (
      SELECT DISTINCT ON (qa_case_id) qa_case_id AS case_id, finished_at, linked_at, result
        FROM advice_checks
       WHERE qa_case_id IS NOT NULL AND deleted_at IS NULL AND status = 'done'
       ORDER BY qa_case_id, finished_at DESC
    )
    SELECT g1.case_id FROM g1 JOIN k ON k.case_id = g1.case_id JOIN qa_cases c ON c.id = g1.case_id
     WHERE g1.status = 'done' AND c.deleted_at IS NULL
       AND jsonb_array_length(COALESCE(k.result->'statements', '[]'::jsonb)) > 0
       AND GREATEST(k.finished_at, k.linked_at) > now() - interval '7 days'
       AND NOT EXISTS (SELECT 1 FROM qa_runs s
                        WHERE s.case_id = g1.case_id AND s.gate = 4
                          AND s.started_at >= GREATEST(g1.finished_at, k.finished_at, k.linked_at))
     ORDER BY GREATEST(g1.finished_at, k.finished_at, k.linked_at) LIMIT 1`;
  const caseId = r.rows[0]?.case_id;
  if (!caseId) return null;
  const s = await startStatements(caseId, "automatic");
  if ("error" in s) return { caseId, status: s.error };
  await s.run();
  const done = await sql<{ status: string }>`SELECT status FROM qa_runs WHERE id = ${s.runId}`;
  return { caseId, status: `notes check ${done.rows[0]?.status ?? "unknown"}` };
}
