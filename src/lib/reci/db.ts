/**
 * Postgres helper — uses @vercel/postgres which works with both Vercel Postgres
 * (now Neon) and a standard POSTGRES_URL env var.
 */
import { sql } from "@vercel/postgres";
import {
  Adviser,
  CANCELLATION_REASONS,
  CancellationReason,
  Deal,
  DealStatus,
} from "./schema";
import { sendCancellationEmail } from "./email";

export async function listAdvisers(): Promise<Adviser[]> {
  const { rows } = await sql<Adviser>`
    SELECT id, slug, name, sort_order, active, email
    FROM advisers
    WHERE active = true
    ORDER BY sort_order ASC, name ASC
  `;
  return rows;
}

export async function getAdviserBySlug(slug: string): Promise<Adviser | null> {
  const { rows } = await sql<Adviser>`
    SELECT id, slug, name, sort_order, active, email
    FROM advisers
    WHERE slug = ${slug} AND active = true
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getAdviserById(id: number): Promise<Adviser | null> {
  const { rows } = await sql<Adviser>`
    SELECT id, slug, name, sort_order, active, email
    FROM advisers
    WHERE id = ${id}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function getDealById(id: number): Promise<Deal | null> {
  const { rows } = await sql<Deal>`SELECT * FROM deals WHERE id = ${id} LIMIT 1`;
  return rows[0] ?? null;
}

export async function listDealsForAdviser(adviserId: number, year: number): Promise<Deal[]> {
  const { rows } = await sql<Deal>`
    SELECT * FROM deals
    WHERE adviser_id = ${adviserId} AND year = ${year}
    ORDER BY week ASC, status ASC, position ASC, id ASC
  `;
  return rows;
}

export async function createDeal(
  data: Omit<Deal, "id" | "created_at" | "updated_at" | "position" | "cancellation_reason" | "cancellation_notes" | "cancelled_at" | "cancelled_by" | "in_processing_stage">,
  username: string,
): Promise<Deal> {
  const { rows } = await sql<Deal>`
    INSERT INTO deals (
      adviser_id, year, week, client, postcode, no_of_deals, provider, premium,
      confirmed_date, poz_listened, miscellaneous, submitted, acc_ref,
      status, commission, notes, gl_sp, gl_txt, trust_done, trust_sent
    ) VALUES (
      ${data.adviser_id}, ${data.year}, ${data.week}, ${data.client},
      ${data.postcode}, ${data.no_of_deals}, ${data.provider}, ${data.premium},
      ${data.confirmed_date}, ${data.poz_listened}, ${data.miscellaneous},
      ${data.submitted}, ${data.acc_ref}, ${data.status}, ${data.commission},
      ${data.notes}, ${data.gl_sp}, ${data.gl_txt}, ${data.trust_done}, ${data.trust_sent}
    )
    RETURNING *
  `;
  const deal = rows[0];
  await sql`
    INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
    VALUES (${deal.id}, ${username}, NULL, ${deal.status}, NULL, ${deal.commission}, 'created')
  `;
  return deal;
}

export async function updateDeal(
  id: number,
  patch: Partial<Omit<Deal, "id" | "created_at" | "updated_at">>,
  username: string,
): Promise<Deal | null> {
  // Load existing for history
  const existing = await sql<Deal>`SELECT * FROM deals WHERE id = ${id} LIMIT 1`;
  if (existing.rows.length === 0) return null;
  const prev = existing.rows[0];

  // Merge + update
  const next: Deal = { ...prev, ...patch };
  const { rows } = await sql<Deal>`
    UPDATE deals SET
      adviser_id = ${next.adviser_id},
      year = ${next.year},
      week = ${next.week},
      position = ${next.position ?? prev.position},
      client = ${next.client},
      postcode = ${next.postcode},
      no_of_deals = ${next.no_of_deals},
      provider = ${next.provider},
      premium = ${next.premium},
      confirmed_date = ${next.confirmed_date},
      poz_listened = ${next.poz_listened},
      miscellaneous = ${next.miscellaneous},
      submitted = ${next.submitted},
      acc_ref = ${next.acc_ref},
      status = ${next.status},
      commission = ${next.commission},
      notes = ${next.notes},
      gl_sp = ${next.gl_sp},
      gl_txt = ${next.gl_txt},
      trust_done = ${next.trust_done},
      trust_sent = ${next.trust_sent},
      in_processing_stage = ${next.in_processing_stage},
      cancellation_reason = ${next.cancellation_reason},
      cancellation_notes  = ${next.cancellation_notes},
      cancelled_at        = ${next.cancelled_at},
      cancelled_by        = ${next.cancelled_by},
      updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  const updated = rows[0];
  if (prev.status !== updated.status || Number(prev.commission) !== Number(updated.commission)) {
    await sql`
      INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
      VALUES (${id}, ${username}, ${prev.status}, ${updated.status}, ${prev.commission}, ${updated.commission}, 'updated')
    `;
  }
  return updated;
}

export async function deleteDeal(id: number, username: string): Promise<boolean> {
  await sql`
    INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
    SELECT id, ${username}, status, NULL, commission, NULL, 'deleted' FROM deals WHERE id = ${id}
  `;
  const { rowCount } = await sql`DELETE FROM deals WHERE id = ${id}`;
  return (rowCount ?? 0) > 0;
}

export interface ChangeStatusOptions {
  reason?: CancellationReason | null;
  notes?: string | null;
  position?: number;
}

export async function changeDealStatus(
  id: number,
  newStatus: DealStatus,
  username: string,
  opts: ChangeStatusOptions = {},
): Promise<Deal | null> {
  const existing = await sql<Deal>`SELECT * FROM deals WHERE id = ${id} LIMIT 1`;
  if (existing.rows.length === 0) return null;
  const prev = existing.rows[0];
  const pos = opts.position ?? prev.position;

  // Decide what to do with the cancellation columns based on the new status.
  let newReason: CancellationReason | null = prev.cancellation_reason;
  let newNotes:  string | null              = prev.cancellation_notes;
  let setCancelledNow = false;
  let cancelledBy:   string | null          = prev.cancelled_by;
  let clearCancelledAt = false;

  if (newStatus === "cancelled") {
    if (!opts.reason || !CANCELLATION_REASONS.includes(opts.reason)) {
      throw new Error("cancellation reason required");
    }
    newReason = opts.reason;
    newNotes  = (opts.notes ?? "").toString().slice(0, 1000) || null;
    setCancelledNow = true;
    cancelledBy = username;
  } else if (prev.status === "cancelled") {
    // Reopening a deal — clear cancellation fields.
    newReason = null;
    newNotes  = null;
    cancelledBy = null;
    clearCancelledAt = true;
  }

  let updated: Deal;
  if (setCancelledNow) {
    const r = await sql<Deal>`
      UPDATE deals SET
        status = ${newStatus},
        position = ${pos},
        cancellation_reason = ${newReason},
        cancellation_notes  = ${newNotes},
        cancelled_at        = now(),
        cancelled_by        = ${cancelledBy},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    updated = r.rows[0];
  } else if (clearCancelledAt) {
    const r = await sql<Deal>`
      UPDATE deals SET
        status = ${newStatus},
        position = ${pos},
        cancellation_reason = NULL,
        cancellation_notes  = NULL,
        cancelled_at        = NULL,
        cancelled_by        = NULL,
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    updated = r.rows[0];
  } else {
    const r = await sql<Deal>`
      UPDATE deals SET
        status = ${newStatus},
        position = ${pos},
        updated_at = now()
      WHERE id = ${id}
      RETURNING *
    `;
    updated = r.rows[0];
  }

  await sql`
    INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
    VALUES (
      ${id}, ${username}, ${prev.status}, ${updated.status},
      ${prev.commission}, ${updated.commission},
      ${newStatus === "cancelled" ? `cancelled:${newReason}` : "status_change"}
    )
  `;

  // Fire the cancellation email — fire-and-fail-quietly so the API call still
  // succeeds even if Gmail is rate-limited or the env is misconfigured.
  // We log to console (visible in Vercel runtime logs) so you can debug.
  if (newStatus === "cancelled" && prev.status !== "cancelled" && newReason) {
    const adviser = await getAdviserById(updated.adviser_id);
    if (adviser) {
      const result = await sendCancellationEmail({
        deal: updated,
        adviser,
        reason: newReason,
        notes: newNotes,
        changedBy: username,
      });
      if (!result.sent) {
        console.error("[reci] cancellation email NOT sent:", result.reason);
      } else {
        console.log("[reci] cancellation email sent for deal", updated.id);
      }
    }
  }

  return updated;
}

export interface WeeklyRollup {
  week: number;
  paid: number;
  on_risk_nyp: number;
  in_processing: number;
  nys: number;
  cxl: number;
  total: number;
}

export async function businessTrackerFor(adviserId: number, year: number): Promise<WeeklyRollup[]> {
  const { rows } = await sql<{ week: number; status: string; total: string }>`
    SELECT week, status, COALESCE(SUM(commission), 0)::text AS total
    FROM deals
    WHERE adviser_id = ${adviserId} AND year = ${year}
    GROUP BY week, status
    ORDER BY week ASC
  `;
  const byWeek = new Map<number, WeeklyRollup>();
  for (const r of rows) {
    const w = byWeek.get(r.week) ?? {
      week: r.week, paid: 0, on_risk_nyp: 0, in_processing: 0, nys: 0, cxl: 0, total: 0,
    };
    const amt = Number(r.total);
    if (r.status === "paid") w.paid += amt;
    else if (r.status === "on_risk_nyp") w.on_risk_nyp += amt;
    else if (r.status === "in_processing") w.in_processing += amt;
    else if (r.status === "not_yet_submitted") w.nys += amt;
    else if (r.status === "cancelled") w.cxl += amt;
    else if (r.status === "clawback")  w.cxl += amt;
    w.total = w.paid + w.on_risk_nyp + w.in_processing + w.nys + w.cxl;
    byWeek.set(r.week, w);
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week - b.week);
}

// ---------------------------------------------------------------------------
// Cancellations rollup — used by the per-adviser page's Cancellations block
// and by the global dashboard.
// ---------------------------------------------------------------------------

export interface CancellationWeekRow {
  week: number;
  npw: number;
  postponed: number;
  declined: number;
  other: number;
  total: number;
  commission: number;
}

export interface CancellationDeal {
  id: number;
  client: string;
  week: number;
  commission: number;
  reason: CancellationReason | null;
  notes: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  provider: string | null;
}

export async function cancellationsFor(
  adviserId: number,
  year: number,
): Promise<{ weeks: CancellationWeekRow[]; deals: CancellationDeal[] }> {
  const { rows } = await sql<Deal>`
    SELECT * FROM deals
    WHERE adviser_id = ${adviserId} AND year = ${year} AND status = 'cancelled'
    ORDER BY week DESC, cancelled_at DESC NULLS LAST, id DESC
  `;
  const byWeek = new Map<number, CancellationWeekRow>();
  for (const d of rows) {
    const w = byWeek.get(d.week) ?? {
      week: d.week, npw: 0, postponed: 0, declined: 0, other: 0, total: 0, commission: 0,
    };
    if (d.cancellation_reason === "npw") w.npw += 1;
    else if (d.cancellation_reason === "postponed") w.postponed += 1;
    else if (d.cancellation_reason === "declined") w.declined += 1;
    else if (d.cancellation_reason === "other") w.other += 1;
    else w.other += 1; // legacy: cancelled with no reason -> count as other
    w.total += 1;
    w.commission += Number(d.commission || 0);
    byWeek.set(d.week, w);
  }
  return {
    weeks: Array.from(byWeek.values()).sort((a, b) => b.week - a.week),
    deals: rows.map((d) => ({
      id: d.id,
      client: d.client,
      week: d.week,
      commission: Number(d.commission || 0),
      reason: d.cancellation_reason,
      notes: d.cancellation_notes,
      cancelled_at: d.cancelled_at,
      cancelled_by: d.cancelled_by,
      provider: d.provider,
    })),
  };
}

// Global cancellations across all advisers — used by the dashboard.
export interface CancellationAdviserRow {
  adviser_id: number;
  adviser_name: string;
  npw: number;
  postponed: number;
  declined: number;
  other: number;
  total: number;
  commission: number;
}

export async function cancellationsAll(year: number): Promise<{
  byAdviser: CancellationAdviserRow[];
  byWeek:    CancellationWeekRow[];
}> {
  const { rows: byAdv } = await sql<{ adviser_id: number; adviser_name: string; reason: string | null; cnt: string; sum: string }>`
    SELECT d.adviser_id, a.name AS adviser_name, d.cancellation_reason AS reason,
           COUNT(*)::text AS cnt, COALESCE(SUM(d.commission), 0)::text AS sum
    FROM deals d JOIN advisers a ON a.id = d.adviser_id
    WHERE d.year = ${year} AND d.status = 'cancelled'
    GROUP BY d.adviser_id, a.name, d.cancellation_reason
    ORDER BY a.sort_order ASC
  `;
  const advMap = new Map<number, CancellationAdviserRow>();
  for (const r of byAdv) {
    const a = advMap.get(r.adviser_id) ?? {
      adviser_id: r.adviser_id, adviser_name: r.adviser_name,
      npw: 0, postponed: 0, declined: 0, other: 0, total: 0, commission: 0,
    };
    const n = Number(r.cnt);
    if (r.reason === "npw") a.npw += n;
    else if (r.reason === "postponed") a.postponed += n;
    else if (r.reason === "declined") a.declined += n;
    else a.other += n;
    a.total += n;
    a.commission += Number(r.sum);
    advMap.set(r.adviser_id, a);
  }

  const { rows: byWk } = await sql<{ week: number; reason: string | null; cnt: string; sum: string }>`
    SELECT week, cancellation_reason AS reason, COUNT(*)::text AS cnt,
           COALESCE(SUM(commission), 0)::text AS sum
    FROM deals
    WHERE year = ${year} AND status = 'cancelled'
    GROUP BY week, cancellation_reason
    ORDER BY week DESC
  `;
  const wkMap = new Map<number, CancellationWeekRow>();
  for (const r of byWk) {
    const w = wkMap.get(r.week) ?? {
      week: r.week, npw: 0, postponed: 0, declined: 0, other: 0, total: 0, commission: 0,
    };
    const n = Number(r.cnt);
    if (r.reason === "npw") w.npw += n;
    else if (r.reason === "postponed") w.postponed += n;
    else if (r.reason === "declined") w.declined += n;
    else w.other += n;
    w.total += n;
    w.commission += Number(r.sum);
    wkMap.set(r.week, w);
  }

  return {
    byAdviser: Array.from(advMap.values()),
    byWeek:    Array.from(wkMap.values()).sort((a, b) => b.week - a.week),
  };
}
