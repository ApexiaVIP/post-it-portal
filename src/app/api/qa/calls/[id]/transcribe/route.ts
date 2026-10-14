/**
 * POST /api/qa/calls/[id]/transcribe
 * Joins the uploaded chunks and starts transcribing them with Amazon
 * Transcribe in London. Returns straight away; the case page shows
 * "Transcribing…" until the job finishes (see lib/qa/calls.ts). The
 * uploaded chunks are kept until the transcript is in, so a failed
 * transcription can be retried without uploading again.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";
import { ukStatus } from "@/lib/qa/uk";
import { beginTranscription } from "@/lib/qa/calls";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 120;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });
  const callId = Number(params.id);

  const call = await sql<{ status: string; filename: string | null; mime_type: string | null; size_bytes: string | null }>`
    SELECT status, filename, mime_type, size_bytes::text AS size_bytes FROM qa_calls WHERE id = ${callId} AND deleted_at IS NULL`;
  if (call.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (call.rows[0].status === "transcribing" || call.rows[0].status === "ready") {
    return NextResponse.json({ error: "Already transcribing" }, { status: 409 });
  }

  const chunks = await sql.query<{ data: Buffer }>(
    `SELECT data FROM qa_upload_chunks WHERE call_id = $1 ORDER BY seq`, [callId],
  );
  const audio = Buffer.concat(chunks.rows.map((r) => Buffer.from(r.data)));
  const expected = Number(call.rows[0].size_bytes) || 0;
  if (audio.length === 0 || (expected > 0 && audio.length !== expected)) {
    await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${callId}`;
    await sql`UPDATE qa_calls SET status = 'failed', error = 'Upload incomplete, please delete this call and upload the recording again.', updated_at = now() WHERE id = ${callId}`;
    return NextResponse.json({ error: "Upload incomplete" }, { status: 400 });
  }

  try {
    await beginTranscription(callId, audio, call.rows[0].filename, call.rows[0].mime_type);
    return NextResponse.json({ ok: true, status: "transcribing" }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`UPDATE qa_calls SET status = 'failed', error = ${msg.slice(0, 500)}, updated_at = now() WHERE id = ${callId}`;
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
