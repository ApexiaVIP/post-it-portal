/**
 * Call QA data access + shared types (Guy + Poz brief, 6 Oct 2026).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, canUseCallQA } from "@/lib/auth";

import type { QaCase, QaCall } from "./shared";
export * from "./shared";

/**
 * Session gate for every Call QA API route. The middleware already
 * blocks other users; this is the second lock on the data itself.
 */
export async function requireCallQA(): Promise<{ username: string } | NextResponse> {
  const session = await getSession();
  if (!canUseCallQA(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return { username: session.username };
}

export async function getCase(id: number): Promise<QaCase | null> {
  const r = await sql<QaCase>`
    SELECT c.id, c.client_name, c.adviser_id, a.name AS adviser_name, c.case_type,
           c.notes, c.created_by, c.created_at::text AS created_at,
           c.deal_id,
           CASE WHEN d.id IS NULL THEN NULL
                ELSE d.client || COALESCE(' · ' || d.provider, '') || ' · week ' || d.week || ' ' || d.year END AS deal_label,
           c.outcome, c.outcome_notes, c.outcome_by, c.outcome_at::text AS outcome_at
      FROM qa_cases c
      LEFT JOIN advisers a ON a.id = c.adviser_id
      LEFT JOIN deals d ON d.id = c.deal_id
     WHERE c.id = ${id} AND c.deleted_at IS NULL`;
  return r.rows[0] ?? null;
}

export async function getCalls(caseId: number, withTranscripts = true): Promise<QaCall[]> {
  const r = await sql.query<QaCall>(
    `SELECT id, case_id, call_number, call_type, call_date::text AS call_date, filename,
            mime_type, size_bytes::float AS size_bytes, status, error,
            duration_seconds::float AS duration_seconds, adviser_speaker,
            ${withTranscripts ? "utterances" : "NULL::jsonb AS utterances"}
       FROM qa_calls
      WHERE case_id = $1 AND deleted_at IS NULL
      ORDER BY call_number, id`,
    [caseId],
  );
  return r.rows;
}

/** Client-facing name for an adviser where we have one (welcome email work). */
export async function adviserDisplayName(adviserId: number | null): Promise<string | null> {
  if (adviserId === null) return null;
  const r = await sql<{ n: string }>`
    SELECT COALESCE(NULLIF(full_name, ''), name) AS n FROM advisers WHERE id = ${adviserId}`;
  return r.rows[0]?.n ?? null;
}
