/**
 * Sale recordings on the RECI board (Poz, 15 Oct 2026).
 *
 * A seller completes a sale, downloads the call recording(s) from 3CX and
 * drops them on their own board: that creates the sale (Not Yet
 * Submitted) with the recordings attached. Poz fills in the rest, listens
 * from the sale, and decides per recording whether to send it to Call QA
 * for transcription. The audio is held in the London database until then
 * and deleted after RECORDING_KEEP_DAYS whatever happens.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser, isBoardSeller } from "@/lib/auth";
import { getAdviserBySlug, createDeal } from "@/lib/reci/db";
import { parseRecordingName } from "@/lib/qa/sharepoint";
import { isoWeekNumber } from "@/lib/schema";
import type { Adviser } from "@/lib/reci/schema";

export const RECORDING_KEEP_DAYS = 30;
export const MAX_RECORDING_BYTES = 250 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

export interface BoardAccess { username: string; isAdmin: boolean; adviser: Adviser }

/**
 * Who may act on this board: admins on any board, a sales agent only on
 * the board whose adviser carries their username.
 */
export async function boardAccess(slug: string): Promise<BoardAccess | NextResponse> {
  const session = await getSession();
  const username: string = session.username ?? "";
  const lower = username.toLowerCase();
  const adviser = await getAdviserBySlug(slug);
  if (!adviser) return NextResponse.json({ error: "adviser not found" }, { status: 404 });
  if (isDashboardUser(username)) return { username, isAdmin: true, adviser };
  if (isBoardSeller(session.username)) {
    const own = await sql<{ id: number }>`SELECT id FROM advisers WHERE username = ${lower} AND id = ${adviser.id}`;
    if (own.rows.length > 0) return { username: session.username, isAdmin: false, adviser };
  }
  return NextResponse.json({ error: "forbidden" }, { status: 403 });
}

/** Admins only (Poz, Pauline, Jimmy): listening, sending to Call QA, deleting. */
export async function requireAdmin(): Promise<{ username: string } | NextResponse> {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { username: session.username };
}

/** Delete audio held past the keep period, and uploads that never finished. */
export async function purgeOldRecordings(): Promise<void> {
  await sql`
    DELETE FROM deal_recordings
     WHERE status = 'uploading' AND uploaded_at < now() - interval '1 day'`;
  const old = await sql<{ id: number }>`
    UPDATE deal_recordings SET status = 'deleted', audio_removed_at = now(),
           removed_by = ${`automatic (${RECORDING_KEEP_DAYS} days)`}
     WHERE status = 'held' AND uploaded_at < now() - make_interval(days => ${RECORDING_KEEP_DAYS})
     RETURNING id`;
  if (old.rows.length) {
    await sql.query(`DELETE FROM deal_recording_chunks WHERE recording_id = ANY($1::int[])`, [old.rows.map((r) => r.id)]);
  }
}

/** Start one recording upload; the audio follows in chunks. */
export async function startRecording(
  access: BoardAccess, f: { filename: string; mime_type: string | null; size_bytes: number; deal_id: number | null },
): Promise<{ id: number } | { error: string; status: number }> {
  if (!(f.size_bytes > 0)) return { error: "Empty file", status: 400 };
  if (f.size_bytes > MAX_RECORDING_BYTES) return { error: "Recording is larger than 250MB", status: 413 };
  if (f.deal_id !== null) {
    const d = await sql<{ adviser_id: number; status: string }>`SELECT adviser_id, status FROM deals WHERE id = ${f.deal_id}`;
    const deal = d.rows[0];
    if (!deal || deal.adviser_id !== access.adviser.id) return { error: "Sale not found on this board", status: 404 };
    if (!access.isAdmin && deal.status !== "not_yet_submitted") {
      return { error: "Recordings can only be added to sales that haven't been submitted yet", status: 409 };
    }
  }
  const ext = await sql<{ extension: string }>`SELECT extension FROM advisers WHERE extension IS NOT NULL AND extension <> ''`;
  const p = parseRecordingName(f.filename, new Set(ext.rows.map((r) => r.extension.trim())));
  const r = await sql<{ id: number }>`
    INSERT INTO deal_recordings (deal_id, adviser_id, filename, mime_type, size_bytes, client_phone, call_started_at, uploaded_by)
    VALUES (${f.deal_id}, ${access.adviser.id}, ${f.filename.slice(0, 200)}, ${(f.mime_type ?? "").slice(0, 100) || null},
            ${f.size_bytes}, ${p.phone},
            CASE WHEN ${p.startedAt}::text IS NULL THEN NULL ELSE (${p.startedAt}::timestamp AT TIME ZONE 'Europe/London') END,
            ${access.username})
    RETURNING id`;
  return { id: r.rows[0].id };
}

/**
 * Finish uploads: check every recording arrived in full, then attach them
 * to the given sale or create a new Not Yet Submitted sale for them.
 */
export async function finishRecordings(
  access: BoardAccess, recordingIds: number[], dealId: number | null,
): Promise<{ deal_id: number } | { error: string; status: number }> {
  if (recordingIds.length === 0) return { error: "No recordings", status: 400 };
  const rows = await sql.query<{
    id: number; size_bytes: string; received: string; status: string; uploaded_by: string; adviser_id: number;
    client_phone: string | null; call_day: string | null;
  }>(
    `SELECT r.id, r.size_bytes::text, COALESCE(SUM(octet_length(c.data)), 0)::text AS received, r.status,
            r.uploaded_by, r.adviser_id, r.client_phone,
            (r.call_started_at AT TIME ZONE 'Europe/London')::date::text AS call_day
       FROM deal_recordings r LEFT JOIN deal_recording_chunks c ON c.recording_id = r.id
      WHERE r.id = ANY($1::int[])
      GROUP BY r.id
      ORDER BY r.call_started_at NULLS LAST, r.id`,
    [recordingIds],
  );
  if (rows.rows.length !== recordingIds.length) return { error: "Recording not found", status: 404 };
  for (const r of rows.rows) {
    if (r.adviser_id !== access.adviser.id || (!access.isAdmin && r.uploaded_by !== access.username)) {
      return { error: "forbidden", status: 403 };
    }
    if (r.status !== "uploading") return { error: "Recording already attached", status: 409 };
    if (r.received !== r.size_bytes) return { error: "A recording didn't upload in full. Please try again.", status: 400 };
  }

  let id = dealId;
  if (id === null) {
    // Named after the client's number until Poz fills in the details.
    const first = rows.rows[0];
    const latestDay = rows.rows.map((r) => r.call_day).filter(Boolean).sort().pop() ?? null;
    const when = latestDay ? new Date(`${latestDay}T12:00:00Z`) : new Date();
    const phone = rows.rows.find((r) => r.client_phone)?.client_phone ?? first.client_phone;
    const deal = await createDeal({
      adviser_id: access.adviser.id,
      year: Number((latestDay ?? new Date().toISOString()).slice(0, 4)),
      week: isoWeekNumber(when),
      client: phone ? `New sale (${phone})` : "New sale (details to follow)",
      postcode: null, no_of_deals: 1, provider: null, premium: null, confirmed_date: null,
      poz_listened: null, miscellaneous: null, submitted: null, acc_ref: null,
      status: "not_yet_submitted", commission: 0,
      notes: `Created from ${rows.rows.length} call recording${rows.rows.length === 1 ? "" : "s"} by ${access.username}`,
      gl_sp: null, gl_txt: null, trust_done: null, trust_sent: null,
      booked_date: latestDay, policy_type: null, resell_cb: 0,
      client_email: null, client_email_2: null, policy_number: null, policy_start_date: null, first_dd_date: null,
    }, access.username);
    id = deal.id;
  }
  await sql.query(
    `UPDATE deal_recordings SET deal_id = $1, status = 'held' WHERE id = ANY($2::int[])`,
    [id, recordingIds],
  );
  return { deal_id: id };
}

export interface DealRecording {
  id: number; deal_id: number; filename: string | null; mime_type: string | null; size_bytes: number;
  client_phone: string | null; call_started_at: string | null; status: "held" | "sent" | "deleted";
  uploaded_by: string; uploaded_at: string; audio_removed_at: string | null; removed_by: string | null;
  qa_call_id: number | null; qa_case_id: number | null; qa_call_status: string | null;
}

export async function listDealRecordings(dealId: number): Promise<DealRecording[]> {
  const r = await sql<DealRecording>`
    SELECT r.id, r.deal_id, r.filename, r.mime_type, r.size_bytes::float AS size_bytes, r.client_phone,
           r.call_started_at::text AS call_started_at, r.status, r.uploaded_by, r.uploaded_at::text AS uploaded_at,
           r.audio_removed_at::text AS audio_removed_at, r.removed_by, r.qa_call_id,
           k.case_id AS qa_case_id, k.status AS qa_call_status
      FROM deal_recordings r LEFT JOIN qa_calls k ON k.id = r.qa_call_id AND k.deleted_at IS NULL
     WHERE r.deal_id = ${dealId} AND r.status <> 'uploading'
     ORDER BY r.call_started_at NULLS LAST, r.id`;
  return r.rows;
}

/** The held audio, in order (for playback and for sending to Call QA). */
export async function chunkMap(recordingId: number): Promise<{ seq: number; len: number }[]> {
  const r = await sql<{ seq: number; len: number }>`
    SELECT seq, octet_length(data)::int AS len FROM deal_recording_chunks WHERE recording_id = ${recordingId} ORDER BY seq`;
  return r.rows;
}

export async function readAudio(recordingId: number): Promise<Buffer> {
  const r = await sql.query<{ data: Buffer }>(
    `SELECT data FROM deal_recording_chunks WHERE recording_id = $1 ORDER BY seq`, [recordingId],
  );
  return Buffer.concat(r.rows.map((x) => Buffer.from(x.data)));
}

/**
 * Which bytes to send for a browser's Range request, capped at maxSlice
 * per response, and which chunks hold them (exported for tests).
 */
export function planRange(
  map: { seq: number; len: number }[], rangeHeader: string | null, maxSlice: number,
): { total: number; start: number; end: number; seqs: number[]; firstOffset: number } | { total: number; unsatisfiable: true } {
  const total = map.reduce((s, c) => s + c.len, 0);
  const m = (rangeHeader ?? "").match(/bytes=(\d*)-(\d*)/);
  let start = 0;
  let end = total - 1;
  if (m && m[1] === "" && m[2] !== "") start = Math.max(0, total - Number(m[2]));
  else if (m) { start = Number(m[1] || 0); if (m[2] !== "") end = Math.min(total - 1, Number(m[2])); }
  if (total === 0 || start >= total || start > end) return { total, unsatisfiable: true };
  end = Math.min(end, start + maxSlice - 1);
  const seqs: number[] = [];
  let off = 0;
  let firstOffset = 0;
  for (const c of map) {
    if (off + c.len > start && off <= end) { if (seqs.length === 0) firstOffset = off; seqs.push(c.seq); }
    off += c.len;
  }
  return { total, start, end, seqs, firstOffset };
}
