/**
 * GET /api/reci/clawback/reports
 *
 * Per-seller Gross Issued / Saved / Net Position roll-ups for management
 * reporting. The "period" the case belongs to is decided by clawback_date
 * (when L&G will actually charge the CB), which is what Guy wants for
 * forecasting and reconciliation.
 *
 * Query params:
 *   scope   one of week | month | quarter | half | year (default month)
 *   year    integer (default current calendar year)
 *
 * Reporting months always run 1st to last day of each calendar month, per
 * Poz's spec. Cases with no clawback_date land in an explicit "Unscheduled"
 * bucket so they don't disappear from the totals.
 *
 * Auth: jimmy / pauline / poz only.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

type Scope = "week" | "month" | "quarter" | "half" | "year";

interface PeriodKey {
  key: string;        // e.g. "2026-01", "2026-W23", "2026-Q1", "2026-H1", "2026"
  label: string;      // human-readable
  start: string;      // ISO date (yyyy-mm-dd)
  end: string;        // ISO date inclusive
  sortRank: number;
}

interface BucketRow {
  key: "Tan" | "Hayder" | "Gurdaht" | "Atikur" | "Jack" | "Xstaff" | "Legacy" | "Needs review";
  adviser_id: number | null;
  gross: number;
  saved: number;
  resold: number;
  net: number;
  cases: number;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const adviserScope = await clawbackAdviserScope(session.username);
  if (adviserScope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const scope = (searchParams.get("scope") || "month") as Scope;
  if (!["week","month","quarter","half","year"].includes(scope)) {
    return NextResponse.json({ error: "bad scope" }, { status: 400 });
  }
  const year = Number(searchParams.get("year") || new Date().getUTCFullYear());
  if (!Number.isFinite(year)) {
    return NextResponse.json({ error: "bad year" }, { status: 400 });
  }

  // Pull every case for the chosen year (by clawback_date) plus those without
  // a clawback_date (legacy / unscheduled). Aggregating in JS keeps the SQL
  // simple; volume is well under 10k rows even at end-of-year.
  const rowsR = typeof adviserScope === "number"
    ? await sql<{
        adviser_id: number | null;
        adviser_name: string | null;
        agent_bucket: string;
        clawback_date: string | null;
        clawback_due: string | null;
        saved_amount: string | null;
        resold_amount: string | null;
      }>`
        SELECT
          c.adviser_id,
          a.name AS adviser_name,
          c.agent_bucket,
          c.clawback_date::text AS clawback_date,
          COALESCE(c.openwork_clawback_due, c.clawback_due)::text AS clawback_due,
          c.saved_amount::text AS saved_amount,
          c.resold_amount::text AS resold_amount
        FROM clawback_cases c
        LEFT JOIN advisers a ON a.id = c.adviser_id
        WHERE c.adviser_id = ${adviserScope}
          AND (c.clawback_date IS NULL OR EXTRACT(YEAR FROM c.clawback_date) = ${year})
      `
    : await sql<{
        adviser_id: number | null;
        adviser_name: string | null;
        agent_bucket: string;
        clawback_date: string | null;
        clawback_due: string | null;
        saved_amount: string | null;
        resold_amount: string | null;
      }>`
        SELECT
          c.adviser_id,
          a.name AS adviser_name,
          c.agent_bucket,
          c.clawback_date::text AS clawback_date,
          COALESCE(c.openwork_clawback_due, c.clawback_due)::text AS clawback_due,
          c.saved_amount::text AS saved_amount,
          c.resold_amount::text AS resold_amount
        FROM clawback_cases c
        LEFT JOIN advisers a ON a.id = c.adviser_id
        WHERE c.clawback_date IS NULL
           OR EXTRACT(YEAR FROM c.clawback_date) = ${year}
      `;

  // Group by (period, bucket).
  const byPeriod = new Map<string, { period: PeriodKey; buckets: Map<string, BucketRow> }>();
  function ensurePeriod(pk: PeriodKey) {
    let entry = byPeriod.get(pk.key);
    if (!entry) {
      entry = { period: pk, buckets: new Map() };
      byPeriod.set(pk.key, entry);
    }
    return entry;
  }
  function ensureBucket(periodEntry: { buckets: Map<string, BucketRow> }, row: typeof rowsR.rows[number]): BucketRow {
    const key = bucketLabel(row.adviser_name, row.agent_bucket);
    let b = periodEntry.buckets.get(key);
    if (!b) {
      b = {
        key: key as BucketRow["key"],
        adviser_id: row.adviser_id,
        gross: 0, saved: 0, resold: 0, net: 0, cases: 0,
      };
      periodEntry.buckets.set(key, b);
    }
    return b;
  }

  for (const r of rowsR.rows) {
    const pk = periodKeyFor(scope, year, r.clawback_date);
    const entry = ensurePeriod(pk);
    const b = ensureBucket(entry, r);
    const gross  = parseAmt(r.clawback_due);
    const saved  = parseAmt(r.saved_amount);
    const resold = parseAmt(r.resold_amount);
    b.gross  += gross;
    b.saved  += saved;
    b.resold += resold;
    b.cases  += 1;
  }
  // Net = Gross - Saved (per Poz's brief; resold goes alongside as a separate
  // line so Guy can see replacement-sale activity but it doesn't reduce Gross).
  for (const { buckets } of byPeriod.values()) {
    for (const b of buckets.values()) b.net = Math.max(0, b.gross - b.saved);
  }

  // Order periods by sortRank, sellers by Poz's preferred order.
  const SELLER_ORDER = ["Tan","Hayder","Gurdaht","Atikur","Jack","Xstaff","Legacy","Needs review"];
  const periods = Array.from(byPeriod.values())
    .sort((a, b) => a.period.sortRank - b.period.sortRank)
    .map((p) => ({
      ...p.period,
      buckets: Array.from(p.buckets.values()).sort(
        (a, b) => SELLER_ORDER.indexOf(a.key) - SELLER_ORDER.indexOf(b.key),
      ),
    }));

  // Roll-up totals across the full scope.
  const overall = new Map<string, BucketRow>();
  for (const p of periods) {
    for (const b of p.buckets) {
      let o = overall.get(b.key);
      if (!o) { o = { ...b, gross: 0, saved: 0, resold: 0, net: 0, cases: 0 }; overall.set(b.key, o); }
      o.gross  += b.gross;
      o.saved  += b.saved;
      o.resold += b.resold;
      o.cases  += b.cases;
    }
  }
  for (const o of overall.values()) o.net = Math.max(0, o.gross - o.saved);

  return NextResponse.json({
    scope, year,
    periods,
    overall: Array.from(overall.values()).sort(
      (a, b) => SELLER_ORDER.indexOf(a.key) - SELLER_ORDER.indexOf(b.key),
    ),
  });
}

// ---------- helpers --------------------------------------------------------

function parseAmt(v: string | null): number {
  if (!v) return 0;
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function bucketLabel(adviserName: string | null, bucket: string): string {
  if (bucket === "adviser" && adviserName) return adviserName;
  if (bucket === "xstaff") return "Xstaff";
  if (bucket === "legacy") return "Legacy";
  return "Needs review";
}

function pad2(n: number) { return String(n).padStart(2, "0"); }

function periodKeyFor(scope: Scope, year: number, clawbackDate: string | null): PeriodKey {
  if (!clawbackDate) {
    return {
      key: `unscheduled`,
      label: "Unscheduled (no CB date)",
      start: "", end: "",
      sortRank: 1_000_000,
    };
  }
  // Parse the date locally as yyyy-mm-dd; treat it as UTC midnight.
  const [yStr, mStr, dStr] = clawbackDate.slice(0, 10).split("-");
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  if (scope === "year") {
    return {
      key: String(year),
      label: `${year} (Annual)`,
      start: `${year}-01-01`,
      end:   `${year}-12-31`,
      sortRank: 0,
    };
  }
  if (scope === "half") {
    const half = m <= 6 ? 1 : 2;
    const startMonth = half === 1 ? 1 : 7;
    const endMonth   = half === 1 ? 6 : 12;
    return {
      key: `${year}-H${half}`,
      label: `H${half} ${year} (${monthShort(startMonth)}-${monthShort(endMonth)})`,
      start: `${year}-${pad2(startMonth)}-01`,
      end:   `${year}-${pad2(endMonth)}-${endMonth === 6 ? 30 : 31}`,
      sortRank: half,
    };
  }
  if (scope === "quarter") {
    const q = Math.ceil(m / 3);
    const startMonth = (q - 1) * 3 + 1;
    const endMonth   = q * 3;
    return {
      key: `${year}-Q${q}`,
      label: `Q${q} ${year}`,
      start: `${year}-${pad2(startMonth)}-01`,
      end:   `${year}-${pad2(endMonth)}-${[3,6,9,12].includes(endMonth) ? (endMonth === 6 || endMonth === 9 ? 30 : 31) : 30}`,
      sortRank: q,
    };
  }
  if (scope === "month") {
    const lastDay = new Date(Date.UTC(y, m, 0)).getUTCDate();
    return {
      key: `${year}-${pad2(m)}`,
      label: `${monthShort(m)} ${year}`,
      start: `${year}-${pad2(m)}-01`,
      end:   `${year}-${pad2(m)}-${lastDay}`,
      sortRank: m,
    };
  }
  // week (ISO week of the year)
  const date = new Date(Date.UTC(y, m - 1, d));
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return {
    key: `${year}-W${pad2(week)}`,
    label: `Week ${week} (${year})`,
    start: clawbackDate, // approximate
    end: clawbackDate,
    sortRank: week,
  };
}

function monthShort(m: number): string {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
}
