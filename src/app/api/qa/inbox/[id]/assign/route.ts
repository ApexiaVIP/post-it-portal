/**
 * POST /api/qa/inbox/[id]/assign
 *   { case_id }  or  { new_case: { client_name, case_type } }
 *   plus { call_type, call_date? }
 * Adds the recording to a case: downloads it from SharePoint and starts
 * transcribing it with Amazon Transcribe in London (lib/qa/calls.ts).
 * The case page shows "Transcribing…" until the transcript is in; the
 * audio is deleted as soon as it is. If anything fails the recording
 * goes back to the inbox to try again.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase } from "@/lib/qa/db";
import { downloadRecording } from "@/lib/qa/sharepoint";
import { ukStatus } from "@/lib/qa/uk";
import { beginTranscription } from "@/lib/qa/calls";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

const CALL_TYPES = ["fact_find", "advice", "one_call", "other"];

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });
  const inboxId = Number(params.id);
  const body = await req.json().catch(() => ({})) as {
    case_id?: number; new_case?: { client_name?: string; case_type?: string };
    call_type?: string; call_date?: string;
  };

  // Claim the recording so a double click can't add it twice.
  const claim = await sql<{
    drive_id: string; item_id: string; filename: string; mime_type: string | null;
    size_bytes: string | null; adviser_id: number | null; client_phone: string | null; call_day: string | null;
  }>`
    UPDATE qa_inbox SET status = 'assigned', handled_by = ${auth.username}, handled_at = now()
     WHERE id = ${inboxId} AND status = 'new'
     RETURNING drive_id, item_id, filename, mime_type, size_bytes::text AS size_bytes, adviser_id, client_phone,
               (COALESCE(call_started_at, file_created_at) AT TIME ZONE 'Europe/London')::date::text AS call_day`;
  if (claim.rows.length === 0) return NextResponse.json({ error: "Already added or not found" }, { status: 409 });
  const item = claim.rows[0];
  const release = async () => {
    await sql`UPDATE qa_inbox SET status = 'new', case_id = NULL, call_id = NULL WHERE id = ${inboxId}`;
  };

  // Case: existing, or a new one carrying the adviser and client number.
  let caseId = Number(body.case_id) || 0;
  if (caseId) {
    if (!(await getCase(caseId))) { await release(); return NextResponse.json({ error: "Case not found" }, { status: 404 }); }
    if (item.client_phone) {
      await sql`UPDATE qa_cases SET client_phone = COALESCE(client_phone, ${item.client_phone}) WHERE id = ${caseId}`;
    }
  } else {
    const name = (body.new_case?.client_name ?? "").trim().slice(0, 200);
    if (!name) { await release(); return NextResponse.json({ error: "Client name is required" }, { status: 400 }); }
    const caseType = body.new_case?.case_type === "one_call" ? "one_call" : "two_call";
    const c = await sql<{ id: number }>`
      INSERT INTO qa_cases (client_name, adviser_id, case_type, client_phone, created_by)
      VALUES (${name}, ${item.adviser_id}, ${caseType}, ${item.client_phone}, ${auth.username})
      RETURNING id`;
    caseId = c.rows[0].id;
  }

  const callType = CALL_TYPES.includes(body.call_type ?? "") ? body.call_type! : "other";
  const callDate = typeof body.call_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.call_date) ? body.call_date : item.call_day;
  const next = await sql<{ n: number }>`
    SELECT COALESCE(MAX(call_number), 0)::int + 1 AS n FROM qa_calls WHERE case_id = ${caseId} AND deleted_at IS NULL`;
  const call = await sql<{ id: number }>`
    INSERT INTO qa_calls (case_id, call_number, call_type, call_date, filename, mime_type, size_bytes, status, created_by)
    VALUES (${caseId}, ${next.rows[0].n}, ${callType}, ${callDate}, ${item.filename}, ${item.mime_type},
            ${Number(item.size_bytes) || null}, 'transcribing', ${auth.username})
    RETURNING id`;
  const callId = call.rows[0].id;
  await sql`UPDATE qa_inbox SET case_id = ${caseId}, call_id = ${callId} WHERE id = ${inboxId}`;

  try {
    const audio = await downloadRecording(item.drive_id, item.item_id);
    await beginTranscription(callId, audio, item.filename, item.mime_type);
    return NextResponse.json({ ok: true, case_id: caseId, call_id: callId, status: "transcribing" }, { status: 202 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    await sql`UPDATE qa_calls SET deleted_at = now(), status = 'failed', error = ${msg.slice(0, 500)} WHERE id = ${callId}`;
    await release();
    return NextResponse.json({ error: `${msg} The recording is back in the inbox to try again.`, case_id: caseId }, { status: 502 });
  }
}
