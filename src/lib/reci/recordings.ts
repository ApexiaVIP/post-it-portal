/**
 * Sale recordings (agreed with Guy + Poz, 15 Oct 2026). This is the only
 * way calls get transcribed, so no time or money goes on non-sales calls:
 *
 *   1. The agent completes a sale, downloads the call recording(s) from
 *      3CX and drops them on their own RECI board with the client's
 *      surname and the call type (FF / AC / Both). That creates the sale.
 *   2. The sale goes into Poz's listening pool (/reci/recordings).
 *   3. Poz listens and, if she's happy, presses Transcribe: only that
 *      sale's recordings go to Call QA (transcribed in London).
 *
 * The recordings stay saved against the sale for future reference
 * (London database), whether or not they are transcribed.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser, isBoardSeller } from "@/lib/auth";
import { getAdviserBySlug, createDeal } from "@/lib/reci/db";
import { parseRecordingName } from "@/lib/qa/sharepoint";
import { beginTranscription } from "@/lib/qa/calls";
import { isoWeekNumber } from "@/lib/schema";
import type { Adviser } from "@/lib/reci/schema";

export const MAX_RECORDING_BYTES = 250 * 1024 * 1024;
export const MAX_CHUNK_BYTES = 4 * 1024 * 1024;

export type RecordingCallType = "fact_find" | "advice" | "one_call";
export const RECORDING_CALL_TYPES: Record<RecordingCallType, string> = {
  fact_find: "FF - Fact Find",
  advice: "AC - Advice Call",
  one_call: "Both",
};
const isCallType = (v: unknown): v is RecordingCallType => typeof v === "string" && v in RECORDING_CALL_TYPES;

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

/** Admins only (Poz, Pauline, Jimmy): listening, transcribing, deleting. */
export async function requireAdmin(): Promise<{ username: string } | NextResponse> {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  return { username: session.username };
}

/** Uploads that were started but never finished (e.g. the page was closed). */
export async function clearAbandonedUploads(): Promise<void> {
  await sql`DELETE FROM deal_recordings WHERE status = 'uploading' AND uploaded_at < now() - interval '1 day'`;
}

/** Start one recording upload; the audio follows in chunks. */
export async function startRecording(
  access: BoardAccess,
  f: { filename: string; mime_type: string | null; size_bytes: number; deal_id: number | null; call_type: unknown },
): Promise<{ id: number; other_seller: string | null } | { error: string; status: number }> {
  if (!(f.size_bytes > 0)) return { error: "Empty file", status: 400 };
  if (f.size_bytes > MAX_RECORDING_BYTES) return { error: "Recording is larger than 250MB", status: 413 };
  if (!isCallType(f.call_type)) return { error: "Choose the call type (FF, AC or Both)", status: 400 };
  if (f.deal_id !== null) {
    const d = await sql<{ adviser_id: number; status: string }>`SELECT adviser_id, status FROM deals WHERE id = ${f.deal_id}`;
    const deal = d.rows[0];
    if (!deal || deal.adviser_id !== access.adviser.id) return { error: "Sale not found on this board", status: 404 };
    if (!access.isAdmin && deal.status !== "not_yet_submitted") {
      return { error: "Recordings can only be added to sales that haven't been submitted yet", status: 409 };
    }
  }
  const ext = await sql<{ id: number; name: string; extension: string }>`
    SELECT id, name, extension FROM advisers WHERE extension IS NOT NULL AND extension <> ''`;
  const p = parseRecordingName(f.filename, new Set(ext.rows.map((r) => r.extension.trim())));
  // A 3CX file names the extension it was recorded on: flag a recording
  // from another seller's phone so it isn't filed on the wrong board.
  const owner = p.extension ? ext.rows.find((r) => r.extension.trim() === p.extension) : undefined;
  const otherSeller = owner && owner.id !== access.adviser.id ? `${owner.name} (extension ${owner.extension.trim()})` : null;
  const r = await sql<{ id: number }>`
    INSERT INTO deal_recordings (deal_id, adviser_id, filename, mime_type, size_bytes, client_phone, call_started_at, call_type, uploaded_by)
    VALUES (${f.deal_id}, ${access.adviser.id}, ${f.filename.slice(0, 200)}, ${(f.mime_type ?? "").slice(0, 100) || null},
            ${f.size_bytes}, ${p.phone},
            CASE WHEN ${p.startedAt}::text IS NULL THEN NULL ELSE (${p.startedAt}::timestamp AT TIME ZONE 'Europe/London') END,
            ${f.call_type}, ${access.username})
    RETURNING id`;
  return { id: r.rows[0].id, other_seller: otherSeller };
}

/**
 * Finish uploads: check every recording arrived in full, then attach them
 * to the given sale or create a new Not Yet Submitted sale under the
 * client's surname. Either way the sale lands in Poz's listening pool.
 */
export async function finishRecordings(
  access: BoardAccess, recordingIds: number[], dealId: number | null, surname: string,
): Promise<{ deal_id: number } | { error: string; status: number }> {
  if (recordingIds.length === 0) return { error: "No recordings", status: 400 };
  const client = surname.trim().replace(/\s+/g, " ").slice(0, 200);
  if (dealId === null && !client) return { error: "Enter the client's surname", status: 400 };
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
    // Dated by the latest call in the drop (the sale call), else today.
    const latestDay = rows.rows.map((r) => r.call_day).filter((d): d is string => !!d).sort().pop() ?? null;
    const when = latestDay ? new Date(`${latestDay}T12:00:00Z`) : new Date();
    const deal = await createDeal({
      adviser_id: access.adviser.id,
      year: Number((latestDay ?? new Date().toISOString()).slice(0, 4)),
      week: isoWeekNumber(when),
      client,
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
  client_phone: string | null; call_started_at: string | null; call_type: RecordingCallType | null;
  status: "held" | "sent" | "deleted";
  uploaded_by: string; uploaded_at: string; audio_removed_at: string | null; removed_by: string | null;
  listened_at: string | null; listened_by: string | null;
  qa_call_id: number | null; qa_case_id: number | null; qa_call_status: string | null;
}

const RECORDING_COLUMNS = `
  r.id, r.deal_id, r.filename, r.mime_type, r.size_bytes::float AS size_bytes, r.client_phone,
  r.call_started_at::text AS call_started_at, r.call_type, r.status, r.uploaded_by, r.uploaded_at::text AS uploaded_at,
  r.audio_removed_at::text AS audio_removed_at, r.removed_by, r.listened_at::text AS listened_at, r.listened_by,
  r.qa_call_id, k.case_id AS qa_case_id, k.status AS qa_call_status`;

export async function listDealRecordings(dealId: number): Promise<DealRecording[]> {
  const r = await sql.query<DealRecording>(
    `SELECT ${RECORDING_COLUMNS}
       FROM deal_recordings r LEFT JOIN qa_calls k ON k.id = r.qa_call_id AND k.deleted_at IS NULL
      WHERE r.deal_id = $1 AND r.status <> 'uploading'
      ORDER BY r.call_started_at NULLS LAST, r.id`, [dealId],
  );
  return r.rows;
}

export interface PoolSale {
  deal_id: number; client: string; week: number; year: number; status: string;
  adviser_name: string; adviser_slug: string; recordings: DealRecording[];
}

/** Poz's listening pool: sales with recordings she hasn't transcribed or marked as listened. */
export async function listPool(): Promise<PoolSale[]> {
  const deals = await sql<Omit<PoolSale, "recordings">>`
    SELECT d.id AS deal_id, d.client, d.week, d.year, d.status, a.name AS adviser_name, a.slug AS adviser_slug
      FROM deals d JOIN advisers a ON a.id = d.adviser_id
     WHERE EXISTS (SELECT 1 FROM deal_recordings r
                    WHERE r.deal_id = d.id AND r.status = 'held' AND r.qa_call_id IS NULL AND r.listened_at IS NULL)
     ORDER BY (SELECT MIN(r.uploaded_at) FROM deal_recordings r WHERE r.deal_id = d.id AND r.status = 'held') ASC
     LIMIT 200`;
  if (deals.rows.length === 0) return [];
  const recs = await sql.query<DealRecording>(
    `SELECT ${RECORDING_COLUMNS}
       FROM deal_recordings r LEFT JOIN qa_calls k ON k.id = r.qa_call_id AND k.deleted_at IS NULL
      WHERE r.deal_id = ANY($1::int[]) AND r.status = 'held'
      ORDER BY r.call_started_at NULLS LAST, r.id`, [deals.rows.map((d) => d.deal_id)],
  );
  return deals.rows.map((d) => ({ ...d, recordings: recs.rows.filter((r) => r.deal_id === d.deal_id) }));
}

export interface SentSale {
  deal_id: number; client: string; adviser_name: string; adviser_slug: string; year: number;
  case_id: number; calls: number; ready: number; failed: number; sent_at: string;
  check_status: "running" | "done" | "failed" | null;
  /** The last check failed only because AWS hasn't switched the AI on yet. */
  waiting_for_aws: boolean;
}

/** Sales Poz has sent for transcription in the last fortnight, with where each has got to. */
export async function listSent(): Promise<SentSale[]> {
  const r = await sql<SentSale>`
    SELECT d.id AS deal_id, d.client, a.name AS adviser_name, a.slug AS adviser_slug, d.year, k.case_id,
           COUNT(*)::int AS calls,
           COUNT(*) FILTER (WHERE k.status = 'ready')::int AS ready,
           COUNT(*) FILTER (WHERE k.status = 'failed')::int AS failed,
           MAX(k.created_at)::text AS sent_at,
           (SELECT r.status FROM qa_runs r WHERE r.case_id = k.case_id AND r.gate = 1
             ORDER BY r.started_at DESC LIMIT 1) AS check_status,
           COALESCE((SELECT r.status = 'failed' AND r.error ~* 'not available for this account' FROM qa_runs r
                      WHERE r.case_id = k.case_id AND r.gate = 1 ORDER BY r.started_at DESC LIMIT 1), false) AS waiting_for_aws
      FROM deal_recordings dr
      JOIN qa_calls k ON k.id = dr.qa_call_id AND k.deleted_at IS NULL
      JOIN deals d ON d.id = dr.deal_id
      JOIN advisers a ON a.id = d.adviser_id
     WHERE k.created_at > now() - interval '14 days'
     GROUP BY d.id, d.client, a.name, a.slug, d.year, k.case_id
     ORDER BY MAX(k.created_at) DESC
     LIMIT 50`;
  return r.rows;
}

/** Poz has listened and doesn't want this sale transcribed: out of the pool, recordings kept. */
export async function markListened(dealId: number, username: string): Promise<number> {
  const r = await sql`
    UPDATE deal_recordings SET listened_at = now(), listened_by = ${username}
     WHERE deal_id = ${dealId} AND status = 'held' AND qa_call_id IS NULL AND listened_at IS NULL`;
  return r.rowCount ?? 0;
}

/**
 * Poz's Transcribe button: send this sale's recordings that haven't been
 * transcribed yet to Call QA. They join the sale's Call QA case (created
 * on first use) and are transcribed in London; the recordings stay saved
 * on the sale. The caller checks UK processing is set up.
 */
export async function transcribeSale(dealId: number, username: string): Promise<{
  case_id: number | null; sent: number; failed: string[];
}> {
  const deal = (await sql<{ id: number; client: string; adviser_id: number }>`
    SELECT id, client, adviser_id FROM deals WHERE id = ${dealId}`).rows[0];
  if (!deal) return { case_id: null, sent: 0, failed: ["Sale not found"] };

  // Claim them so a double click can't send anything twice.
  const claimed = await sql<{
    id: number; filename: string | null; mime_type: string | null; size_bytes: string;
    client_phone: string | null; call_type: RecordingCallType | null; call_day: string | null;
  }>`
    UPDATE deal_recordings SET transcribe_started_at = now()
     WHERE deal_id = ${dealId} AND status = 'held' AND qa_call_id IS NULL
       AND (transcribe_started_at IS NULL OR transcribe_started_at < now() - interval '5 minutes')
    RETURNING id, filename, mime_type, size_bytes::text AS size_bytes, client_phone, call_type,
              (call_started_at AT TIME ZONE 'Europe/London')::date::text AS call_day`;
  if (claimed.rows.length === 0) return { case_id: null, sent: 0, failed: [] };
  const recs = claimed.rows.sort((a, b) => (a.call_day ?? "").localeCompare(b.call_day ?? "") || a.id - b.id);
  const oneCall = recs.some((r) => r.call_type === "one_call");

  // The sale's Call QA case: one per deal, holding all its calls.
  let caseId = (await sql<{ id: number }>`
    SELECT id FROM qa_cases WHERE deal_id = ${deal.id} AND deleted_at IS NULL ORDER BY id LIMIT 1`).rows[0]?.id ?? null;
  if (caseId === null) {
    const c = await sql<{ id: number }>`
      INSERT INTO qa_cases (client_name, adviser_id, case_type, client_phone, deal_id, created_by)
      VALUES (${deal.client.slice(0, 200)}, ${deal.adviser_id}, ${oneCall ? "one_call" : "two_call"},
              ${recs.find((r) => r.client_phone)?.client_phone ?? null}, ${deal.id}, ${username})
      RETURNING id`;
    caseId = c.rows[0].id;
  } else if (oneCall) {
    await sql`UPDATE qa_cases SET case_type = 'one_call' WHERE id = ${caseId}`;
  }

  let sent = 0;
  const failed: string[] = [];
  for (const rec of recs) {
    let callId: number | null = null;
    try {
      const next = await sql<{ n: number }>`
        SELECT COALESCE(MAX(call_number), 0)::int + 1 AS n FROM qa_calls WHERE case_id = ${caseId} AND deleted_at IS NULL`;
      const call = await sql<{ id: number }>`
        INSERT INTO qa_calls (case_id, call_number, call_type, call_date, filename, mime_type, size_bytes, created_by)
        VALUES (${caseId}, ${next.rows[0].n}, ${rec.call_type ?? "other"}, ${rec.call_day}, ${rec.filename}, ${rec.mime_type},
                ${Number(rec.size_bytes)}, ${username})
        RETURNING id`;
      callId = call.rows[0].id;
      // A working copy for Call QA's "Retry transcription"; Call QA deletes
      // it once the transcript is in. The sale keeps its own copy.
      await sql`
        INSERT INTO qa_upload_chunks (call_id, seq, data)
        SELECT ${callId}, seq, data FROM deal_recording_chunks WHERE recording_id = ${rec.id}`;
      const audio = await readAudio(rec.id);
      if (audio.length !== Number(rec.size_bytes)) throw new Error("the saved recording is incomplete");
      await beginTranscription(callId, audio, rec.filename, rec.mime_type);
      await sql`
        UPDATE deal_recordings SET qa_call_id = ${callId}, transcribe_started_at = NULL,
               listened_at = COALESCE(listened_at, now()), listened_by = COALESCE(listened_by, ${username})
         WHERE id = ${rec.id}`;
      sent++;
    } catch (e) {
      if (callId !== null) {
        await sql`DELETE FROM qa_upload_chunks WHERE call_id = ${callId}`;
        await sql`UPDATE qa_calls SET deleted_at = now() WHERE id = ${callId}`;
      }
      await sql`UPDATE deal_recordings SET transcribe_started_at = NULL WHERE id = ${rec.id}`;
      failed.push(`${rec.filename ?? `Recording ${rec.id}`}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return { case_id: caseId, sent, failed };
}

/** Chunk sizes in order (for playback). */
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
