/**
 * Recordings inbox sync: list new recordings from SharePoint into
 * qa_inbox, keeping only files for our advisers' extensions (Clearvolt's
 * SharePoint may hold other customers' calls) and long enough to be a
 * real conversation.
 */
import { sql } from "@vercel/postgres";
import { listRecordings, parseRecordingName } from "./sharepoint";

export interface SyncResult {
  listed: number;
  added: number;
  skippedOther: number;
  skippedShort: number;
  syncedAt: string;
}

export async function syncInbox(): Promise<SyncResult> {
  const advisers = await sql<{ id: number; extension: string }>`
    SELECT id, extension FROM advisers WHERE extension IS NOT NULL AND extension <> ''`;
  const byExt = new Map(advisers.rows.map((a) => [a.extension.trim(), a.id]));
  const known = new Set(byExt.keys());
  const minBytes = Number(process.env.QA_MIN_RECORDING_BYTES) || 1_000_000;

  const { files } = await listRecordings();
  let added = 0, skippedOther = 0, skippedShort = 0;
  for (const f of files) {
    const p = parseRecordingName(f.filename, known);
    if (!p.extension) { skippedOther++; continue; }
    if (f.sizeBytes < minBytes) { skippedShort++; continue; }
    const r = await sql.query(
      `INSERT INTO qa_inbox (drive_id, item_id, filename, folder_path, size_bytes, mime_type, file_created_at,
                             extension, adviser_id, client_phone, call_started_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
               CASE WHEN $11::text IS NULL THEN NULL ELSE ($11::timestamp AT TIME ZONE 'Europe/London') END)
       ON CONFLICT (drive_id, item_id) DO NOTHING`,
      [f.driveId, f.itemId, f.filename, f.folderPath, f.sizeBytes, f.mimeType, f.createdAt,
       p.extension, byExt.get(p.extension) ?? null, p.phone, p.startedAt],
    );
    if ((r.rowCount ?? 0) > 0) added++;
  }
  const result: SyncResult = {
    listed: files.length, added, skippedOther, skippedShort, syncedAt: new Date().toISOString(),
  };
  await sql`
    INSERT INTO qa_sync_state (key, synced_at, detail) VALUES ('sharepoint', now(), ${JSON.stringify(result)})
    ON CONFLICT (key) DO UPDATE SET synced_at = now(), detail = EXCLUDED.detail`;
  return result;
}
