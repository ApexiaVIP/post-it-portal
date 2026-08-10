/**
 * GET /api/reci/cases — the adviser cases workspace feed (Poz, 6 Aug 2026).
 *
 * Two tabs share this endpoint:
 *   ?tab=cancelled      cancelled deals with resold outcome + call log
 *   ?tab=in_processing  in-processing deals with status + notes
 *
 * Access model (deliberately stricter than the clawback dashboard):
 *   - Admins (Jimmy/Pauline/Poz) and senior sellers (Tan/Hayder): every
 *     adviser's cases, full edit.
 *   - Junior sellers (Gurdaht/Atikur, future juniors): ONLY their own
 *     cases — Poz: "should only be able to see and update their own".
 *   - Guy (viewer): every case, read-only, so the green resolved rows
 *     are immediately visible to him.
 *
 * No financial dashboard here: the only £ shown are the case's own
 * commission (so advisers can prioritise) and the resold figures.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import {
  getSession, isClawbackUser, isClawbackViewer, isDashboardUser,
  getEditableAdviserId,
} from "@/lib/auth";
import { isoWeekOf } from "@/lib/reci/analytics";

export const dynamic = "force-dynamic";

export interface CaseRow {
  id: number;
  adviser_id: number;
  adviser_name: string;
  year: number;
  week: number;
  client: string;
  postcode: string | null;
  provider: string | null;
  status: string;
  in_processing_stage: string | null;
  commission: number;
  notes: string | null;
  cancellation_reason: string | null;
  cancellation_notes: string | null;
  cancelled_at: string | null;
  cancel_week: number;             // ISO week of cancelled_at, fallback sale week
  resold_outcome: "resold" | "pm" | null;
  resold_details: string | null;
  resold_new_commission: number | null;
  clawback_saved: number | null;
  resold_notes: string | null;
  resold_recorded_by: string | null;
  calls_count: number;
  last_call_on: string | null;
  call_dates: string[];
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const editable = await getEditableAdviserId(session.username);
  const viewer = isClawbackViewer(session.username);
  if (editable === undefined && !viewer) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const url = new URL(req.url);
  const tab = url.searchParams.get("tab") === "in_processing" ? "in_processing" : "cancelled";
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  // Adviser filter only honoured for all-scope users; juniors are pinned
  // to their own id regardless of what the query string claims.
  const adviserParam = Number(url.searchParams.get("adviser")) || null;
  const scopeAdviserId = typeof editable === "number" ? editable : adviserParam;

  const status = tab === "in_processing" ? "in_processing" : "cancelled";
  const r = await sql.query<Omit<CaseRow, "cancel_week" | "call_dates"> & { call_dates: string[] | null }>(
    `SELECT d.id, d.adviser_id, a.name AS adviser_name, d.year, d.week,
            d.client, d.postcode, d.provider, d.status, d.in_processing_stage,
            d.commission::float8 AS commission, d.notes,
            d.cancellation_reason, d.cancellation_notes,
            d.cancelled_at::text AS cancelled_at,
            d.resold_outcome, d.resold_details,
            d.resold_new_commission::float8 AS resold_new_commission,
            d.clawback_saved::float8 AS clawback_saved,
            d.resold_notes, d.resold_recorded_by,
            COALESCE(c.n, 0)::int AS calls_count,
            c.last_call_on::text AS last_call_on,
            c.dates AS call_dates
       FROM deals d
       JOIN advisers a ON a.id = d.adviser_id
       LEFT JOIN LATERAL (
         SELECT COUNT(*) AS n, MAX(called_on) AS last_call_on,
                array_agg(called_on::text ORDER BY called_on) AS dates
           FROM deal_calls dc WHERE dc.deal_id = d.id
       ) c ON true
      WHERE d.year = $1 AND d.status = $2
        AND ($3::int IS NULL OR d.adviser_id = $3)
      ORDER BY COALESCE(d.cancelled_at, d.created_at) DESC, d.id DESC`,
    [year, status, scopeAdviserId],
  );

  const rows: CaseRow[] = r.rows.map((row) => ({
    ...row,
    cancel_week: isoWeekOf(row.cancelled_at) ?? row.week,
    call_dates: row.call_dates ?? [],
  }));

  // Totals for the cancelled tab: per adviser overall + weekly (weekly
  // totals keyed on the CANCELLATION week per Poz). Resolved = outcome
  // recorded as Resold.
  let totals = null;
  if (tab === "cancelled") {
    const perAdviser = new Map<number, {
      adviser_id: number; adviser_name: string;
      cancelled_n: number; resolved_n: number; clawback_saved: number; commission: number;
    }>();
    const weekly = new Map<number, { week: number; cancelled_n: number; resolved_n: number; clawback_saved: number }>();
    for (const row of rows) {
      const a = perAdviser.get(row.adviser_id) ?? {
        adviser_id: row.adviser_id, adviser_name: row.adviser_name,
        cancelled_n: 0, resolved_n: 0, clawback_saved: 0, commission: 0,
      };
      a.cancelled_n += 1;
      a.commission += Number(row.commission) || 0;
      if (row.resold_outcome === "resold") a.resolved_n += 1;
      a.clawback_saved += Number(row.clawback_saved) || 0;
      perAdviser.set(row.adviser_id, a);

      const w = weekly.get(row.cancel_week) ?? { week: row.cancel_week, cancelled_n: 0, resolved_n: 0, clawback_saved: 0 };
      w.cancelled_n += 1;
      if (row.resold_outcome === "resold") w.resolved_n += 1;
      w.clawback_saved += Number(row.clawback_saved) || 0;
      weekly.set(row.cancel_week, w);
    }
    totals = {
      perAdviser: Array.from(perAdviser.values()).sort((a, b) => b.cancelled_n - a.cancelled_n),
      weekly: Array.from(weekly.values()).sort((a, b) => b.week - a.week),
    };
  }

  // Adviser list for the filter pills (all-scope users only).
  let advisers: { id: number; name: string }[] = [];
  if (scopeAdviserId === null || viewer) {
    const ar = await sql.query<{ id: number; name: string }>(
      `SELECT id, name FROM advisers WHERE active = true ORDER BY sort_order, name`,
    );
    advisers = ar.rows;
  }

  return NextResponse.json({
    tab,
    year,
    scope: typeof editable === "number" ? "own" : "all",
    canEdit: !viewer,
    canEditClawbackSaved: isDashboardUser(session.username),
    advisers,
    rows,
    totals,
  });
}
