/**
 * Starting a draft suitability report (Guy, 20 Nov 2026), by hand from the
 * case page or automatically straight after a sale's call check. The draft is
 * written alongside the latest finished call check, so its gaps can be
 * numbered against that check's callback list.
 */
import { sql } from "@vercel/postgres";
import { getCase, getCalls } from "./db";
import { runLetter } from "./analyse";
import { ukModel } from "./uk";
import { triage } from "./triage";
import { callbackPointsText } from "./letter";
import { currentRedLines, withRedLines } from "./red-lines";
import { linkedCheck, adviserRecordText } from "./notes-run";
import type { Gate1Result, Gate2Result } from "./schemas";

export type LetterStart =
  | { runId: number; run: () => Promise<void> }
  | { error: string; status: number };

/** Records a draft run for the case and returns it ready to run. */
export async function startLetter(caseId: number, startedBy: string): Promise<LetterStart> {
  const c = await getCase(caseId);
  if (!c) return { error: "case not found", status: 404 };
  const latest = await sql<{ id: number; gate: number; status: string; result: unknown }>`
    SELECT DISTINCT ON (gate) id, gate, status, result FROM qa_runs
     WHERE case_id = ${caseId} AND gate IN (1, 2, 3, 5) ORDER BY gate, started_at DESC`;
  const g1 = latest.rows.find((r) => r.gate === 1);
  const g2 = latest.rows.find((r) => r.gate === 2 && r.status === "done");
  const g3 = latest.rows.find((r) => r.gate === 3);
  if (!g1 || g1.status !== "done") return { error: "The draft is written once the call check has finished.", status: 400 };
  if (g3?.status === "running") return { error: "Already drafting", status: 409 };
  const calls = (await getCalls(caseId)).filter((k) => k.status === "ready");
  if (calls.length === 0) return { error: "No transcribed calls on this case.", status: 400 };

  const red = currentRedLines(latest.rows.find((r) => r.gate === 5), g1.id);
  const t = withRedLines(triage(g1.result as Partial<Gate1Result>, (g2?.result ?? null) as Partial<Gate2Result> | null), red);
  // With the seller's advice check linked (23 Nov 2026), the draft is written
  // from the calls and the seller's own record together.
  const k = await linkedCheck(caseId);
  const record = k ? { checkId: k.id, text: adviserRecordText(k) } : null;
  const run = await sql<{ id: number }>`
    INSERT INTO qa_runs (case_id, gate, status, model, started_by)
    VALUES (${caseId}, 3, 'running', ${ukModel()}, ${startedBy}) RETURNING id`;
  const runId = run.rows[0].id;
  return { runId, run: () => runLetter(runId, calls, c.case_type, g1.id, callbackPointsText(t), record, red?.id ?? null) };
}

/**
 * A sale whose call check finished in the last two hours (so the call is
 * still in the AI's cache) and has no draft since. Older sales are drafted
 * by hand from the case page.
 */
export async function autoDraftNext(): Promise<{ caseId: number; status: string } | null> {
  const r = await sql<{ case_id: number }>`
    WITH g1 AS (
      SELECT DISTINCT ON (case_id) id, case_id, status, finished_at
        FROM qa_runs WHERE gate = 1 ORDER BY case_id, started_at DESC
    )
    SELECT g1.case_id FROM g1 JOIN qa_cases c ON c.id = g1.case_id
     WHERE g1.status = 'done' AND g1.finished_at > now() - interval '2 hours'
       AND c.deleted_at IS NULL AND c.deal_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM qa_runs l
                        WHERE l.case_id = g1.case_id AND l.gate = 3 AND l.started_at >= g1.finished_at)
     ORDER BY g1.finished_at LIMIT 1`;
  const caseId = r.rows[0]?.case_id;
  if (!caseId) return null;
  const s = await startLetter(caseId, "automatic");
  if ("error" in s) return { caseId, status: s.error };
  await s.run();
  const done = await sql<{ status: string }>`SELECT status FROM qa_runs WHERE id = ${s.runId}`;
  return { caseId, status: `draft ${done.rows[0]?.status ?? "unknown"}` };
}
