/**
 * Transcription jobs for Call QA calls (14 Oct 2026). A recording is
 * handed to Amazon Transcribe in London and the call shows
 * "Transcribing…" until the job finishes, which takes a few minutes.
 * The portal checks on waiting jobs whenever Call QA is open (the case
 * page polls every few seconds), stores the transcript and deletes the
 * audio and the job from AWS straight away.
 *
 * Belt and braces: the London bucket also deletes anything older than a
 * day on its own (lifecycle rule, see scripts/aws-uk-setup.md), so audio
 * is never kept even if nobody opens the portal.
 */
import { sql } from "@vercel/postgres";
import { ukStatus, requireUk } from "./uk";
import { startTranscription, checkTranscription, cleanUpJob, guessAdviserSpeaker } from "./transcribe";

/** Start transcribing a call's audio and mark the call as transcribing. */
export async function beginTranscription(
  callId: number, audio: Buffer, filename: string | null, mimeType: string | null,
): Promise<void> {
  const c = requireUk();
  const { job, audioKey } = await startTranscription(c, callId, audio, filename, mimeType);
  await sql`
    UPDATE qa_calls SET status = 'transcribing', error = NULL, transcribe_job = ${job},
           audio_key = ${audioKey}, transcribe_checked_at = now(), updated_at = now()
     WHERE id = ${callId}`;
}

/** A call taken off the SharePoint inbox goes back there if it can't be transcribed. */
async function returnToInbox(callId: number, reason: string): Promise<boolean> {
  const inbox = await sql<{ id: number }>`SELECT id FROM qa_inbox WHERE call_id = ${callId}`;
  if (inbox.rows.length === 0) return false;
  await sql`UPDATE qa_calls SET deleted_at = now() WHERE id = ${callId}`;
  await sql`
    UPDATE qa_inbox SET status = 'new', case_id = NULL, call_id = NULL,
           note = ${`Transcription failed: ${reason}`.slice(0, 500)}
     WHERE id = ${inbox.rows[0].id}`;
  return true;
}

/**
 * Check on waiting transcription jobs (for one case, or any), at most
 * every few seconds per call. Errors talking to AWS are logged and the
 * call is simply checked again next time.
 */
export async function advanceTranscriptions(caseId: number | null = null): Promise<void> {
  const s = ukStatus();
  if (!s.ready) return;
  const c = s.config;

  // A call whose job never started (the request was cut off mid-way).
  const stuck = await sql<{ id: number }>`
    UPDATE qa_calls SET status = 'failed', error = 'Transcription was interrupted, please try again.', updated_at = now()
     WHERE status = 'transcribing' AND deleted_at IS NULL AND transcribe_job IS NULL
       AND (${caseId}::int IS NULL OR case_id = ${caseId}::int)
       AND updated_at < now() - interval '10 minutes'
     RETURNING id`;
  for (const r of stuck.rows) await returnToInbox(r.id, "the transcription was interrupted");

  const due = await sql<{ id: number; transcribe_job: string; audio_key: string | null }>`
    UPDATE qa_calls SET transcribe_checked_at = now()
     WHERE id IN (
       SELECT id FROM qa_calls
        WHERE status = 'transcribing' AND deleted_at IS NULL AND transcribe_job IS NOT NULL
          AND (${caseId}::int IS NULL OR case_id = ${caseId}::int)
          AND (transcribe_checked_at IS NULL OR transcribe_checked_at < now() - interval '60 seconds')
        ORDER BY id LIMIT 5)
     RETURNING id, transcribe_job, audio_key`;

  await Promise.all(due.rows.map(async (row) => {
    try {
      const r = await checkTranscription(c, row.transcribe_job);
      if (r.state === "pending") return;
      if (r.state === "done" && r.utterances.length > 0) {
        // Only the first check to finish records the result; a slower,
        // overlapping check (cron and an open page at once) does nothing.
        const won = await sql.query(
          `UPDATE qa_calls SET status = 'ready', utterances = $2::jsonb, duration_seconds = $3,
                  adviser_speaker = $4, error = NULL, audio_key = NULL, updated_at = now()
            WHERE id = $1 AND status = 'transcribing'`,
          [row.id, JSON.stringify(r.utterances), r.durationSeconds, guessAdviserSpeaker(r.utterances)],
        );
        if ((won.rowCount ?? 0) === 0) return;
        await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${row.id}`;
        await cleanUpJob(c, { job: row.transcribe_job, audioKey: row.audio_key, transcriptKey: r.transcriptKey });
        return;
      }
      const reason = r.state === "failed" ? r.reason : "No speech was found in this recording.";
      const lost = await sql`
        UPDATE qa_calls SET status = 'failed', error = ${reason.slice(0, 500)}, audio_key = NULL, updated_at = now()
         WHERE id = ${row.id} AND status = 'transcribing'`;
      if ((lost.rowCount ?? 0) === 0) return;
      await cleanUpJob(c, { job: row.transcribe_job, audioKey: row.audio_key, transcriptKey: r.state === "done" ? r.transcriptKey : null });
      await returnToInbox(row.id, reason);
    } catch (e) {
      console.error(`[qa] checking transcription for call ${row.id}`, e);
    }
  }));
}

/** Remove anything still held in AWS for these calls (used when a call or case is deleted). */
export async function dropHeldAudio(callIds: number[]): Promise<void> {
  if (callIds.length === 0) return;
  const rows = await sql.query<{ id: number; transcribe_job: string | null; audio_key: string | null }>(
    `SELECT id, transcribe_job, audio_key FROM qa_calls
      WHERE id = ANY($1::int[]) AND (audio_key IS NOT NULL OR status = 'transcribing')`, [callIds],
  );
  const s = ukStatus();
  if (s.ready) {
    await Promise.all(rows.rows.map((r) => cleanUpJob(s.config, { job: r.transcribe_job, audioKey: r.audio_key })));
  }
  await sql.query(`DELETE FROM qa_upload_chunks WHERE call_id = ANY($1::int[])`, [callIds]);
  await sql.query(`UPDATE qa_calls SET audio_key = NULL WHERE id = ANY($1::int[])`, [callIds]);
}
