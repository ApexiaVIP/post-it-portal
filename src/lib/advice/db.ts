/**
 * Advice check data access (Guy, 22 Nov 2026). Sellers see and run only
 * their own checks; Call QA users see and can act on every check.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, canUseAdviceCheck, isAdviceReviewer } from "@/lib/auth";
import type { CaseType } from "@/lib/qa/shared";
import type { AdviceCheckResult, CheckStatus } from "./shared";

export interface AdviceUser {
  username: string;
  reviewer: boolean;
  /** The seller's own adviser row, if their login is linked to one. */
  adviserId: number | null;
}

/** Session gate for every advice check API route (the middleware is the first lock). */
export async function requireAdviceCheck(): Promise<AdviceUser | NextResponse> {
  const session = await getSession();
  if (!canUseAdviceCheck(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const username = session.username.toLowerCase();
  const a = await sql<{ id: number }>`SELECT id FROM advisers WHERE username = ${username} LIMIT 1`;
  return { username, reviewer: isAdviceReviewer(username), adviserId: a.rows[0]?.id ?? null };
}

export interface CheckRow {
  id: number;
  adviser_id: number | null;
  adviser_name: string | null;
  created_by: string;
  client_label: string;
  case_type: CaseType;
  fact_find_date: string;
  recommendation: string;
  presented: boolean;
  notes_anyway: boolean;
  sheet_typed: string | null;
  sheet_text: string | null;
  status: CheckStatus;
  model: string | null;
  result: AdviceCheckResult | null;
  usage: unknown;
  standards: unknown;
  error: string | null;
  previous_id: number | null;
  fact_find_id: number | null;
  qa_case_id: number | null;
  linked_by: string | null;
  linked_at: string | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}

export async function getCheck(id: number): Promise<CheckRow | null> {
  const r = await sql<CheckRow>`
    SELECT k.id, k.adviser_id, a.name AS adviser_name, k.created_by, k.client_label, k.case_type,
           k.fact_find_date::text AS fact_find_date, k.recommendation, k.presented, k.notes_anyway,
           k.sheet_typed, k.sheet_text, k.status, k.model, k.result, k.usage, k.standards, k.error,
           k.previous_id, k.fact_find_id, k.qa_case_id, k.linked_by, k.linked_at::text AS linked_at,
           k.created_at::text AS created_at, k.started_at::text AS started_at, k.finished_at::text AS finished_at
      FROM advice_checks k LEFT JOIN advisers a ON a.id = k.adviser_id
     WHERE k.id = ${id} AND k.deleted_at IS NULL`;
  return r.rows[0] ?? null;
}

/** A seller's own check: they ran it, or it is on their adviser record. */
export function canSee(u: AdviceUser, c: Pick<CheckRow, "created_by" | "adviser_id">): boolean {
  return u.reviewer || c.created_by === u.username || (u.adviserId !== null && c.adviser_id === u.adviserId);
}
