/**
 * Call QA once a day (Jimmy, 13 Oct 2026).
 *
 *   evening    syncInbox()        list the day's new recordings
 *   overnight  processNight()     transcribe + sort each recording into a
 *                                 case, then run the full check on cases
 *                                 where a sale was completed
 *   morning    buildMorningDigest()   summary email for review
 *
 * The overnight job runs every ten minutes in the early hours and each
 * run does as much as fits in its time budget, so a busy day is spread
 * across several runs.
 */
import Anthropic from "@anthropic-ai/sdk";
import { sql } from "@vercel/postgres";
import { downloadRecording } from "./sharepoint";
import { transcribeAudio, guessAdviserSpeaker } from "./transcribe";
import { sortCall, type SortResult } from "./classify";
import { buildTranscriptText, runGate1, QA_MODEL } from "./analyse";
import { getCalls, type QaCall, type Utterance } from "./db";

const MAX_ATTEMPTS = 3;
const PLACEHOLDER = /^Client (0\d+|number unknown)$/;

export interface NightResult {
  transcribed: number;
  attachedToCases: number;
  notSales: number;
  failed: number;
  checksRun: number;
  checksFailed: number;
}

function nightlyCheckCap(): number {
  return Number(process.env.QA_NIGHTLY_MAX_CHECKS) || 25;
}

export interface InboxClaim {
  id: number; drive_id: string; item_id: string; filename: string; mime_type: string | null;
  size_bytes: string | null; adviser_id: number | null; client_phone: string | null; call_day: string | null;
}

/** Transcribe and sort one recording into a case (or set it aside as not a sale). */
async function processItem(client: Anthropic, item: InboxClaim): Promise<"case" | "not_sale"> {
  const audio = await downloadRecording(item.drive_id, item.item_id);
  const t = await transcribeAudio(audio, item.mime_type || "application/octet-stream");
  if (t.utterances.length === 0) throw new Error("No speech found in the recording.");
  const adviserSpeaker = guessAdviserSpeaker(t.utterances);

  // Sort it using the same transcript layout the full check reads.
  const asCall = {
    call_number: 1, call_type: "other", call_date: item.call_day, duration_seconds: t.durationSeconds,
    adviser_speaker: adviserSpeaker, utterances: t.utterances,
  } as unknown as QaCall;
  const sort: SortResult = await sortCall(client, buildTranscriptText([asCall]));
  return fileRecording(item, { utterances: t.utterances, durationSeconds: t.durationSeconds, adviserSpeaker }, sort);
}

/** Put a transcribed, sorted recording into its client's case (exported for tests). */
export async function fileRecording(
  item: InboxClaim,
  t: { utterances: Utterance[]; durationSeconds: number | null; adviserSpeaker: string | null },
  sort: SortResult,
): Promise<"case" | "not_sale"> {
  const adviserSpeaker = t.adviserSpeaker;
  if (sort.call_type === "not_a_sales_call") {
    await sql`
      UPDATE qa_inbox SET status = 'ignored', note = ${`Not a sales call: ${sort.summary}`.slice(0, 500)},
             handled_by = 'overnight', handled_at = now()
       WHERE id = ${item.id}`;
    return "not_sale";
  }

  // Find this client's case by phone number, or start one.
  let caseId: number | null = null;
  if (item.client_phone) {
    const found = await sql<{ id: number; client_name: string }>`
      SELECT id, client_name FROM qa_cases
       WHERE deleted_at IS NULL AND client_phone = ${item.client_phone}
         AND created_at > now() - interval '60 days'
       ORDER BY created_at DESC LIMIT 1`;
    if (found.rows[0]) {
      caseId = found.rows[0].id;
      if (PLACEHOLDER.test(found.rows[0].client_name) && sort.client_name.trim()) {
        await sql`UPDATE qa_cases SET client_name = ${sort.client_name.trim().slice(0, 200)} WHERE id = ${caseId}`;
      }
    }
  }
  if (caseId === null) {
    const name = sort.client_name.trim() || `Client ${item.client_phone ?? "number unknown"}`;
    const c = await sql<{ id: number }>`
      INSERT INTO qa_cases (client_name, adviser_id, case_type, client_phone, auto_created, created_by)
      VALUES (${name.slice(0, 200)}, ${item.adviser_id}, ${sort.call_type === "one_call" ? "one_call" : "two_call"},
              ${item.client_phone}, true, 'overnight')
      RETURNING id`;
    caseId = c.rows[0].id;
  } else if (sort.call_type === "one_call") {
    await sql`UPDATE qa_cases SET case_type = 'one_call' WHERE id = ${caseId}`;
  }

  const next = await sql<{ n: number }>`
    SELECT COALESCE(MAX(call_number), 0)::int + 1 AS n FROM qa_calls WHERE case_id = ${caseId} AND deleted_at IS NULL`;
  const call = await sql.query<{ id: number }>(
    `INSERT INTO qa_calls (case_id, call_number, call_type, call_date, filename, mime_type, size_bytes, status,
                           duration_seconds, adviser_speaker, utterances, classification, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, 'ready', $8, $9, $10::jsonb, $11::jsonb, 'overnight')
     RETURNING id`,
    [caseId, next.rows[0].n, sort.call_type, item.call_day, item.filename, item.mime_type,
     Number(item.size_bytes) || null, t.durationSeconds, adviserSpeaker,
     JSON.stringify(t.utterances), JSON.stringify(sort)],
  );
  if (sort.sale_completed && (sort.call_type === "advice" || sort.call_type === "one_call")) {
    await sql`UPDATE qa_cases SET ready_for_check = true, updated_at = now() WHERE id = ${caseId}`;
  }
  await sql`
    UPDATE qa_inbox SET status = 'assigned', case_id = ${caseId}, call_id = ${call.rows[0].id},
           note = ${sort.summary.slice(0, 500)}, handled_by = 'overnight', handled_at = now()
     WHERE id = ${item.id}`;
  return "case";
}

/** Cases with a completed sale whose latest calls haven't been checked yet (exported for tests). */
export async function casesNeedingCheck(limit: number) {
  const r = await sql<{ id: number; case_type: "one_call" | "two_call" }>`
    WITH latest_call AS (
      SELECT case_id, MAX(created_at) AS at FROM qa_calls WHERE deleted_at IS NULL AND status = 'ready' GROUP BY case_id
    )
    SELECT c.id, c.case_type
      FROM qa_cases c JOIN latest_call lc ON lc.case_id = c.id
     WHERE c.deleted_at IS NULL AND c.ready_for_check
       AND NOT EXISTS (SELECT 1 FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 1
                        AND ((r.status = 'done' AND r.started_at >= lc.at)
                          OR (r.status = 'running' AND r.started_at > now() - interval '6 minutes')))
       AND (SELECT COUNT(*) FROM qa_runs r WHERE r.case_id = c.id AND r.gate = 1
             AND r.status = 'failed' AND r.started_at >= lc.at) < 2
     ORDER BY lc.at
     LIMIT ${limit}`;
  return r.rows;
}

/** Take the oldest waiting recording, counting the attempt (exported for tests). */
export async function claimNextRecording(): Promise<InboxClaim | null> {
  const claim = await sql<InboxClaim>`
    UPDATE qa_inbox SET attempts = attempts + 1
     WHERE id = (SELECT id FROM qa_inbox
                  WHERE status = 'new' AND adviser_id IS NOT NULL AND attempts < ${MAX_ATTEMPTS}
                  ORDER BY COALESCE(call_started_at, file_created_at) LIMIT 1)
     RETURNING id, drive_id, item_id, filename, mime_type, size_bytes::text AS size_bytes, adviser_id, client_phone,
               (COALESCE(call_started_at, file_created_at) AT TIME ZONE 'Europe/London')::date::text AS call_day`;
  return claim.rows[0] ?? null;
}

export async function processNight(budgetMs = 240_000): Promise<NightResult> {
  const started = Date.now();
  const left = () => budgetMs - (Date.now() - started);
  const out: NightResult = { transcribed: 0, attachedToCases: 0, notSales: 0, failed: 0, checksRun: 0, checksFailed: 0 };
  const client = new Anthropic();

  // 1. Transcribe and sort waiting recordings, oldest first.
  let didTranscription = false;
  while (left() > 100_000) {
    const item = await claimNextRecording();
    if (!item) break;
    didTranscription = true;
    try {
      const r = await processItem(client, item);
      out.transcribed++;
      if (r === "case") out.attachedToCases++; else out.notSales++;
    } catch (e) {
      out.failed++;
      const msg = e instanceof Error ? e.message : String(e);
      await sql`UPDATE qa_inbox SET note = ${`Overnight attempt failed: ${msg}`.slice(0, 500)} WHERE id = ${item.id}`;
    }
  }

  // 2. Full checks, in a run of their own so each has the whole time budget.
  if (!didTranscription && left() > 200_000) {
    const doneTonight = await sql<{ n: number }>`
      SELECT COUNT(*)::int AS n FROM qa_runs WHERE started_by = 'overnight' AND started_at > now() - interval '12 hours'`;
    const room = Math.max(0, nightlyCheckCap() - doneTonight.rows[0].n);
    const cases = await casesNeedingCheck(Math.min(2, room));
    await Promise.all(cases.map(async (c) => {
      const calls = (await getCalls(c.id)).filter((k) => k.status === "ready");
      const run = await sql<{ id: number }>`
        INSERT INTO qa_runs (case_id, gate, status, model, started_by)
        VALUES (${c.id}, 1, 'running', ${QA_MODEL}, 'overnight') RETURNING id`;
      await runGate1(run.rows[0].id, calls, c.case_type);
      const st = await sql<{ status: string }>`SELECT status FROM qa_runs WHERE id = ${run.rows[0].id}`;
      if (st.rows[0]?.status === "done") out.checksRun++; else out.checksFailed++;
    }));
  }
  return out;
}

export interface DigestCase {
  id: number; client_name: string; adviser_name: string | null; status: string;
  fails: number; reviews: number; disclosuresMissed: number;
}

/** What happened overnight, for the morning email. */
export async function buildMorningDigest() {
  const runs = await sql<{ case_id: number; client_name: string; adviser_name: string | null; status: string; result: unknown }>`
    SELECT DISTINCT ON (r.case_id) r.case_id, c.client_name, a.name AS adviser_name, r.status, r.result
      FROM qa_runs r JOIN qa_cases c ON c.id = r.case_id LEFT JOIN advisers a ON a.id = c.adviser_id
     WHERE r.started_by = 'overnight' AND r.gate = 1 AND r.started_at > now() - interval '16 hours'
       AND c.deleted_at IS NULL
     ORDER BY r.case_id, r.started_at DESC`;
  const cases: DigestCase[] = runs.rows.map((r) => {
    const res = (r.result ?? {}) as {
      observation?: { checks?: { result: string }[] };
      disclosures?: { disclosures?: { result: string }[] };
    };
    const checks = res.observation?.checks ?? [];
    return {
      id: r.case_id, client_name: r.client_name, adviser_name: r.adviser_name, status: r.status,
      fails: checks.filter((k) => k.result === "FAIL").length,
      reviews: checks.filter((k) => k.result === "REVIEW_REQUIRED").length,
      disclosuresMissed: (res.disclosures?.disclosures ?? []).filter((d) => d.result === "MISSING" || d.result === "PARTIAL").length,
    };
  });
  const counts = await sql<{ transcribed: number; not_sales: number; stuck: number }>`
    SELECT COUNT(*) FILTER (WHERE status = 'assigned' AND handled_by = 'overnight' AND handled_at > now() - interval '16 hours')::int AS transcribed,
           COUNT(*) FILTER (WHERE status = 'ignored' AND handled_by = 'overnight' AND handled_at > now() - interval '16 hours')::int AS not_sales,
           COUNT(*) FILTER (WHERE status = 'new' AND attempts >= ${MAX_ATTEMPTS})::int AS stuck
      FROM qa_inbox`;
  return { cases, ...counts.rows[0] };
}
