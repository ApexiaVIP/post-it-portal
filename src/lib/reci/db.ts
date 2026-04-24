import { sql } from "@vercel/postgres";
import { Adviser, Deal, DealStatus } from "./schema";

export async function listAdvisers(): Promise<Adviser[]> {
  const { rows } = await sql<Adviser>`
    SELECT id, slug, name, sort_order, active
    FROM advisers
    WHERE active = true
    ORDER BY sort_order ASC, name ASC
  `;
  return rows;
}

export async function getAdviserBySlug(slug: string): Promise<Adviser | null> {
  const { rows } = await sql<Adviser>`
    SELECT id, slug, name, sort_order, active
    FROM advisers
    WHERE slug = ${slug} AND active = true
    LIMIT 1
  `;
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
  data: Omit<Deal, "id" | "created_at" | "updated_at" | "position">,
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
  const existing = await sql<Deal>`SELECT * FROM deals WHERE id = ${id} LIMIT 1`;
  if (existing.rows.length === 0) return null;
  const prev = existing.rows[0];
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

export async function changeDealStatus(
  id: number,
  newStatus: DealStatus,
  username: string,
  newPosition?: number,
): Promise<Deal | null> {
  const existing = await sql<Deal>`SELECT * FROM deals WHERE id = ${id} LIMIT 1`;
  if (existing.rows.length === 0) return null;
  const prev = existing.rows[0];
  const pos = newPosition ?? prev.position;
  const { rows } = await sql<Deal>`
    UPDATE deals SET status = ${newStatus}, position = ${pos}, updated_at = now()
    WHERE id = ${id}
    RETURNING *
  `;
  const updated = rows[0];
  await sql`
    INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
    VALUES (${id}, ${username}, ${prev.status}, ${updated.status}, ${prev.commission}, ${updated.commission}, 'status_change')
  `;
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
    w.total = w.paid + w.on_risk_nyp + w.in_processing + w.nys + w.cxl;
    byWeek.set(r.week, w);
  }
  return Array.from(byWeek.values()).sort((a, b) => a.week - b.week);
}
