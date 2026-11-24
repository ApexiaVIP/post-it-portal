/**
 * Fact Find forms: who can use them, loading and clearing (Jimmy, 24 Nov 2026).
 *
 * The forms hold clients' health and money details, so sellers only get them
 * once Guy has set how long they are kept: FACT_FIND_KEEP_DAYS on Vercel both
 * opens the form to the sellers and starts the clear-out. Until then only the
 * Call QA users (Guy, Poz, Jimmy) have it, to try on made-up clients.
 */
import { sql } from "@vercel/postgres";
import type { AdviceUser } from "@/lib/advice/db";
import type { CaseType } from "@/lib/qa/shared";
import type { Data } from "./types";

export function keepDays(): number | null {
  const n = Number(process.env.FACT_FIND_KEEP_DAYS);
  return Number.isInteger(n) && n > 0 ? n : null;
}
export function canUseForms(u: AdviceUser): boolean {
  return u.reviewer || keepDays() !== null;
}

export interface FormRow {
  id: number;
  adviser_id: number | null;
  adviser_name: string | null;
  created_by: string;
  client_label: string;
  case_type: CaseType;
  fact_find_date: string;
  sheet_version: string;
  data: Data;
  rev: number;
  presented: boolean;
  created_at: string;
  updated_at: string;
  purged_at: string | null;
}

export async function getForm(id: number): Promise<FormRow | null> {
  if (!Number.isInteger(id) || id <= 0) return null;
  const r = await sql<FormRow>`
    SELECT f.id, f.adviser_id, a.name AS adviser_name, f.created_by, f.client_label, f.case_type,
           f.fact_find_date::text AS fact_find_date, f.sheet_version, f.data, f.rev, f.presented,
           f.created_at::text AS created_at, f.updated_at::text AS updated_at, f.purged_at::text AS purged_at
      FROM fact_finds f LEFT JOIN advisers a ON a.id = f.adviser_id
     WHERE f.id = ${id} AND f.deleted_at IS NULL`;
  return r.rows[0] ?? null;
}

/** Clears the answers, and the copies the checks hold, once a form is past its keeping time. */
export async function purgeOldForms(): Promise<void> {
  const days = keepDays();
  if (days === null) return;
  const old = await sql<{ id: number }>`
    UPDATE fact_finds SET data = '{}'::jsonb, purged_at = now()
     WHERE purged_at IS NULL AND updated_at < now() - make_interval(days => ${days}) RETURNING id`;
  for (const f of old.rows) {
    await sql`UPDATE advice_checks SET sheet_typed = NULL, sheet_text = NULL WHERE fact_find_id = ${f.id}`;
  }
}

const MAX_DATA = 300_000;
/** The answers as sent by the form, or null if they aren't usable. */
export function cleanData(v: unknown): Data | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  return JSON.stringify(v).length > MAX_DATA ? null : (v as Data);
}
