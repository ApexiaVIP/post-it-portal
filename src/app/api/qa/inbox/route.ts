/**
 * GET /api/qa/inbox?status=new|assigned|ignored
 * Recordings found in SharePoint, with the adviser, client number and a
 * suggested case (same client number) for each.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";
import { sharepointConfigured } from "@/lib/qa/sharepoint";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET(req: Request) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const status = new URL(req.url).searchParams.get("status") ?? "new";
  const st = ["new", "assigned", "ignored"].includes(status) ? status : "new";

  const [items, sync, counts] = await Promise.all([
    sql.query(
      `SELECT i.id, i.filename, i.size_bytes::float AS size_bytes, i.extension, i.adviser_id, a.name AS adviser_name,
              i.client_phone, COALESCE(i.call_started_at, i.file_created_at)::text AS call_at,
              i.status, i.case_id, i.handled_by, i.handled_at::text AS handled_at,
              (SELECT c.id FROM qa_cases c
                WHERE c.deleted_at IS NULL AND i.client_phone IS NOT NULL AND c.client_phone = i.client_phone
                ORDER BY c.created_at DESC LIMIT 1) AS suggested_case_id,
              (SELECT c.client_name FROM qa_cases c
                WHERE c.deleted_at IS NULL AND i.client_phone IS NOT NULL AND c.client_phone = i.client_phone
                ORDER BY c.created_at DESC LIMIT 1) AS suggested_case_name
         FROM qa_inbox i LEFT JOIN advisers a ON a.id = i.adviser_id
        WHERE i.status = $1
        ORDER BY COALESCE(i.call_started_at, i.file_created_at) DESC NULLS LAST
        LIMIT 300`, [st]),
    sql`SELECT synced_at::text AS synced_at, detail FROM qa_sync_state WHERE key = 'sharepoint'`,
    sql`SELECT status, COUNT(*)::int AS n FROM qa_inbox GROUP BY status`,
  ]);
  return NextResponse.json({
    configured: sharepointConfigured(),
    items: items.rows,
    sync: sync.rows[0] ?? null,
    counts: Object.fromEntries(counts.rows.map((r) => [r.status, r.n])),
  });
}
