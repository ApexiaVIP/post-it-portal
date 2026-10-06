/**
 * POST /api/qa/calls/[id]/transcribe
 * Joins the uploaded chunks, transcribes them (Deepgram, EU endpoint),
 * stores the timestamped transcript and deletes the audio. On failure the
 * audio is kept so the transcription can be retried.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";
import { transcribeAudio, guessAdviserSpeaker } from "@/lib/qa/transcribe";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const callId = Number(params.id);

  const call = await sql<{ status: string; mime_type: string | null; size_bytes: string | null }>`
    SELECT status, mime_type, size_bytes::text AS size_bytes FROM qa_calls WHERE id = ${callId} AND deleted_at IS NULL`;
  if (call.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (call.rows[0].status === "transcribing") {
    return NextResponse.json({ error: "Already transcribing" }, { status: 409 });
  }

  const chunks = await sql.query<{ data: Buffer }>(
    `SELECT data FROM qa_upload_chunks WHERE call_id = $1 ORDER BY seq`, [callId],
  );
  const audio = Buffer.concat(chunks.rows.map((r) => Buffer.from(r.data)));
  const expected = Number(call.rows[0].size_bytes) || 0;
  if (audio.length === 0 || (expected > 0 && audio.length !== expected)) {
    await sql`UPDATE qa_calls SET status = 'failed', error = 'Upload incomplete, please upload the recording again.', updated_at = now() WHERE id = ${callId}`;
    return NextResponse.json({ error: "Upload incomplete" }, { status: 400 });
  }

  await sql`UPDATE qa_calls SET status = 'transcribing', error = NULL, updated_at = now() WHERE id = ${callId}`;
  try {
    const t = await transcribeAudio(audio, call.rows[0].mime_type || "application/octet-stream");
    if (t.utterances.length === 0) throw new Error("No speech was found in this recording.");
    await sql.query(
      `UPDATE qa_calls SET status = 'ready', utterances = $2::jsonb, duration_seconds = $3,
              adviser_speaker = $4, error = NULL, updated_at = now() WHERE id = $1`,
      [callId, JSON.stringify(t.utterances), t.durationSeconds, guessAdviserSpeaker(t.utterances)],
    );
    await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${callId}`;
    return NextResponse.json({ ok: true, utterances: t.utterances.length, channels: t.channels });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`UPDATE qa_calls SET status = 'failed', error = ${msg.slice(0, 500)}, updated_at = now() WHERE id = ${callId}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
