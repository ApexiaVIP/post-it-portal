/**
 * GET /api/reci/clawback/monthly?year=2026
 * PUT /api/reci/clawback/monthly   { year, month, total, old_ow, note }
 *
 * CB by month (Poz, 24 Sep 2026): the simple month-by-month view that
 * separates Guy's headline MI from the admin case detail.
 *
 *   Forecast CB         every case L&G forecast to claw back in that
 *                       month (by clawback_date), at the effective CB
 *                       (Poz's final figure when set, else the EBAH
 *                       forecast), whatever happened to it since.
 *   Forecast not taken  the part of that forecast that was saved:
 *                       any positive (On) status, i.e. reinstated,
 *                       resold, premiums brought up to date etc.
 *   Actual CB taken     what Openwork actually debited that month, typed
 *                       in by Poz from the OW portal. Differs from the
 *                       forecast in amount and timing, so it cannot be
 *                       derived from case data.
 *
 * Each figure splits Old OW / New OW by the case's source tag; cases
 * with no tag are reported separately so the split stays honest.
 *
 * Company-level MI: junior sellers (scoped to their own cases) can't
 * read it. Only clawback admins can edit the actuals.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import {
  getSession, isClawbackUser, isClawbackAdmin, clawbackAdviserScope,
} from "@/lib/auth";
import { POSITIVE_STATUSES } from "@/lib/reci/status";

export const dynamic = "force-dynamic";

interface Split { total: number; old: number; new: number; untagged: number }
interface Actual {
  total: number;
  old: number | null;
  new: number | null;
  note: string | null;
  updated_by: string | null;
  updated_at: string | null;
}

const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];

const emptySplit = (): Split => ({ total: 0, old: 0, new: 0, untagged: 0 });
const round2 = (n: number) => Math.round(n * 100) / 100;
function roundSplit(s: Split): Split {
  return { total: round2(s.total), old: round2(s.old), new: round2(s.new), untagged: round2(s.untagged) };
}
function addTo(s: Split, source: string | null, amount: number) {
  s.total += amount;
  if (source === "old_ow") s.old += amount;
  else if (source === "new_ow") s.new += amount;
  else s.untagged += amount;
}
function addSplit(a: Split, b: Split) {
  a.total += b.total; a.old += b.old; a.new += b.new; a.untagged += b.untagged;
}

async function gate() {
  const session = await getSession();
  if (!isClawbackUser(session.username)) return { error: 403 as const };
  const scope = await clawbackAdviserScope(session.username);
  if (scope !== null) return { error: 403 as const };
  return { username: session.username as string };
}

export async function GET(req: Request) {
  const g = await gate();
  if ("error" in g) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();

  const [casesR, actualsR] = await Promise.all([
    sql.query<{ month: number; source: string | null; status: string; cb: string | null }>(
      `SELECT EXTRACT(MONTH FROM c.clawback_date)::int AS month,
              c.source, c.status,
              COALESCE(c.final_clawback_due, c.clawback_due)::text AS cb
         FROM clawback_cases c
        WHERE c.deleted_at IS NULL
          AND c.status <> 'closed'
          AND c.clawback_date >= make_date($1, 1, 1)
          AND c.clawback_date <  make_date($1 + 1, 1, 1)`,
      [year],
    ),
    sql.query<{
      month: number; total_amount: string; old_ow_amount: string | null;
      note: string | null; updated_by: string | null; updated_at: string | null;
    }>(
      `SELECT month, total_amount::text, old_ow_amount::text, note, updated_by,
              updated_at::text
         FROM clawback_monthly_actuals WHERE year = $1`,
      [year],
    ),
  ]);

  const positive = new Set<string>(POSITIVE_STATUSES);
  const months = Array.from({ length: 12 }, (_, i) => ({
    month: i + 1,
    key: `${year}-${String(i + 1).padStart(2, "0")}`,
    label: `${MONTHS[i]} ${year}`,
    cases: 0,
    forecast: emptySplit(),
    notTaken: emptySplit(),
    actual: null as Actual | null,
  }));

  for (const r of casesR.rows) {
    const m = months[r.month - 1];
    if (!m) continue;
    const cb = Number(r.cb) || 0;
    m.cases++;
    addTo(m.forecast, r.source, cb);
    if (positive.has(r.status)) addTo(m.notTaken, r.source, cb);
  }
  for (const a of actualsR.rows) {
    const m = months[a.month - 1];
    if (!m) continue;
    const total = Number(a.total_amount) || 0;
    const old = a.old_ow_amount === null ? null : Number(a.old_ow_amount) || 0;
    m.actual = {
      total, old, new: old === null ? null : round2(total - old),
      note: a.note, updated_by: a.updated_by, updated_at: a.updated_at,
    };
  }

  // YTD runs to the current month for the current year, the whole year
  // for past years; the full-year row always covers all twelve.
  const now = new Date();
  const lastMonth = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
  const sumRange = (upTo: number) => {
    const forecast = emptySplit();
    const notTaken = emptySplit();
    let aTotal = 0, aOld = 0, splitMissing = 0, entered = 0, cases = 0;
    for (const m of months.slice(0, upTo)) {
      cases += m.cases;
      addSplit(forecast, m.forecast);
      addSplit(notTaken, m.notTaken);
      if (m.actual) {
        entered++;
        aTotal += m.actual.total;
        if (m.actual.old === null) splitMissing++;
        else aOld += m.actual.old;
      }
    }
    return {
      months: upTo,
      cases,
      forecast: roundSplit(forecast),
      notTaken: roundSplit(notTaken),
      actual: {
        total: round2(aTotal),
        // Only report an Old/New split when every entered month has one.
        old: splitMissing === 0 && entered > 0 ? round2(aOld) : null,
        new: splitMissing === 0 && entered > 0 ? round2(aTotal - aOld) : null,
        monthsEntered: entered,
      },
    };
  };

  return NextResponse.json({
    year,
    canEdit: isClawbackAdmin(g.username),
    months: months.map((m) => ({ ...m, forecast: roundSplit(m.forecast), notTaken: roundSplit(m.notTaken) })),
    ytd: sumRange(lastMonth),
    fullYear: sumRange(12),
  });
}

export async function PUT(req: Request) {
  const g = await gate();
  if ("error" in g || !isClawbackAdmin(g.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => null) as {
    year?: number; month?: number; total?: number | string | null;
    old_ow?: number | string | null; note?: string | null;
  } | null;
  const year = Number(body?.year);
  const month = Number(body?.month);
  if (!Number.isInteger(year) || year < 2020 || year > 2100 || !Number.isInteger(month) || month < 1 || month > 12) {
    return NextResponse.json({ error: "year and month required" }, { status: 400 });
  }

  const parseMoney = (v: unknown): number | null | "bad" => {
    if (v === null || v === undefined || (typeof v === "string" && v.trim() === "")) return null;
    const n = Number(String(v).replace(/[£,\s]/g, ""));
    return Number.isFinite(n) && n >= 0 ? round2(n) : "bad";
  };
  const total = parseMoney(body?.total);
  const old = parseMoney(body?.old_ow);
  if (total === "bad" || old === "bad") {
    return NextResponse.json({ error: "amounts must be positive numbers" }, { status: 400 });
  }

  // A blank total clears the month.
  if (total === null) {
    await sql`DELETE FROM clawback_monthly_actuals WHERE year = ${year} AND month = ${month}`;
    return NextResponse.json({ ok: true, cleared: true });
  }
  if (old !== null && old > total) {
    return NextResponse.json({ error: "Old OW can't be more than the total" }, { status: 400 });
  }
  const note = (body?.note ?? "").toString().trim() || null;
  await sql`
    INSERT INTO clawback_monthly_actuals (year, month, total_amount, old_ow_amount, note, updated_by, updated_at)
    VALUES (${year}, ${month}, ${total}, ${old}, ${note}, ${g.username}, now())
    ON CONFLICT (year, month) DO UPDATE SET
      total_amount = EXCLUDED.total_amount,
      old_ow_amount = EXCLUDED.old_ow_amount,
      note = EXCLUDED.note,
      updated_by = EXCLUDED.updated_by,
      updated_at = now()
  `;
  return NextResponse.json({ ok: true });
}
