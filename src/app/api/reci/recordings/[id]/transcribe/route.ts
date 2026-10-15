/**
 * POST /api/reci/recordings/[id]/transcribe  { call_type }
 * Poz's decision after listening: send this sale recording to Call QA.
 * It joins the sale's Call QA case (created on first use, linked to the
 * deal), is transcribed in London, and the held audio here is removed.
 * Admins with Call QA access only; refused until UK processing is set up.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { canUseCallQA } from "@/lib/auth";
import { requireAdmin, readAudio } from "@/lib/reci/recordings";
import { ukStatus } from "@/lib/qa/uk";
import { beginTranscription } from "@/lib/qa/calls";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 120;

const CALL_TYPES = ["fact_find", "advice", "one_call", "other"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  if (!canUseCallQA(auth.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });

  const id = Number(params.id);
  const body = await req.json().catch(() => ({})) as { call_type?: string };
  const callType = CALL_TYPES.includes(body.call_type ?? "") ? body.call_type! : "other";

  // Claim it so a double click can't send it twice.
  const claim = await sql<{
    deal_id: number; filename: string | null; mime_type: string | null; size_bytes: string;
    client_phone: string | null; call_day: string | null;
  }>`
    UPDATE deal_recordings SET status = 'sent' WHERE id = ${id} AND status = 'held'
    RETURNING deal_id, filename, mime_type, size_bytes::text AS size_bytes, client_phone,
              (call_started_at AT TIME ZONE 'Europe/London')::date::text AS call_day`;
  const rec = claim.rows[0];
  if (!rec) return NextResponse.json({ error: "This recording isn't waiting to be sent" }, { status: 409 });
  const release = () => sql`UPDATE deal_recordings SET status = 'held' WHERE id = ${id}`;

  let callId: number | null = null;
  try {
    const deal = (await sql<{ id: number; client: string; adviser_id: number }>`
      SELECT id, client, adviser_id FROM deals WHERE id = ${rec.deal_id}`).rows[0];
    if (!deal) throw new Error("Sale not found");

    // The sale's Call QA case: one per deal, holding all its calls.
    let caseId = (await sql<{ id: number }>`
      SELECT id FROM qa_cases WHERE deal_id = ${deal.id} AND deleted_at IS NULL ORDER BY id LIMIT 1`).rows[0]?.id ?? null;
    if (caseId === null) {
      const c = await sql<{ id: number }>`
        INSERT INTO qa_cases (client_name, adviser_id, case_type, client_phone, deal_id, created_by)
        VALUES (${deal.client.slice(0, 200)}, ${deal.adviser_id}, ${callType === "one_call" ? "one_call" : "two_call"},
                ${rec.client_phone}, ${deal.id}, ${auth.username})
        RETURNING id`;
      caseId = c.rows[0].id;
    } else if (callType === "one_call") {
      await sql`UPDATE qa_cases SET case_type = 'one_call' WHERE id = ${caseId}`;
    }

    const next = await sql<{ n: number }>`
      SELECT COALESCE(MAX(call_number), 0)::int + 1 AS n FROM qa_calls WHERE case_id = ${caseId} AND deleted_at IS NULL`;
    const call = await sql<{ id: number }>`
      INSERT INTO qa_calls (case_id, call_number, call_type, call_date, filename, mime_type, size_bytes, created_by)
      VALUES (${caseId}, ${next.rows[0].n}, ${callType}, ${rec.call_day}, ${rec.filename}, ${rec.mime_type},
              ${Number(rec.size_bytes)}, ${auth.username})
      RETURNING id`;
    callId = call.rows[0].id;

    // Keep a copy with the call until it's transcribed, so Call QA's
    // "Retry transcription" works; Call QA deletes it once the transcript is in.
    await sql`
      INSERT INTO qa_upload_chunks (call_id, seq, data)
      SELECT ${callId}, seq, data FROM deal_recording_chunks WHERE recording_id = ${id}`;
    const audio = await readAudio(id);
    if (audio.length !== Number(rec.size_bytes)) throw new Error("The held recording is incomplete.");
    await beginTranscription(callId, audio, rec.filename, rec.mime_type);

    await sql`
      UPDATE deal_recordings SET qa_call_id = ${callId}, audio_removed_at = now(), removed_by = ${auth.username}
       WHERE id = ${id}`;
    await sql`DELETE FROM deal_recording_chunks WHERE recording_id = ${id}`;
    return NextResponse.json({ ok: true, case_id: caseId, call_id: callId }, { status: 202 });
  } catch (e) {
    if (callId !== null) {
      await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${callId}`;
      await sql`UPDATE qa_calls SET deleted_at = now() WHERE id = ${callId}`;
    }
    await release();
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `${msg} The recording is still held on the sale.` }, { status: 502 });
  }
}
