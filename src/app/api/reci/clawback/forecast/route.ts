/**
 * GET /api/reci/clawback/forecast
 *
 * Forward-looking management view for Guy. Returns:
 *
 *   - kpis: current month / next month forecast £, MTD saved £, YTD
 *           saved £, total at-risk £, total open cases.
 *   - months: per-seller Gross / Saved / Net for the next 12 calendar
 *             months (anchored on clawback_date, the date L&G will
 *             actually charge). Resolved-but-not-saved cases stay in
 *             the figures so Guy sees true forward exposure.
 *   - imminentCases: the 10 cases with the highest CB exposure due in
 *             the next 30 days, status != saved | resold | closed.
 *
 * Scoped sellers see only their own cases (same gate as the dashboard).
 * Admins + Guy see everything.
 *
 * Auth: jimmy / pauline / poz / sellers / guy.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, clawbackAdviserScope } from "@/lib/auth";

export const dynamic = "force-dynamic";

interface SellerForecast {
  key: string;              // "Tan" | "Hayder" | ... | "Xstaff" | "Legacy"
  adviser_id: number | null;
  gross: number;
  saved: number;
  resold: number;
  net: number;
  cases: number;
}
interface MonthForecast {
  key: string;              // "2026-07"
  label: string;            // "Jul 2026"
  start: string;            // ISO date
  end: string;              // ISO date inclusive
  sellers: SellerForecast[];
  totals: { gross: number; saved: number; resold: number; net: number; cases: number };
}

export async function GET() {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scope = await clawbackAdviserScope(session.username);
  if (scope === -1) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const scopeWhere = typeof scope === "number" ? `AND c.adviser_id = ${scope}` : "";

  const now = new Date();
  const todayIso = isoDate(now);
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth() + 1; // 1..12

  // Window: from today through end of (current month + 11) so we cover 12
  // months of forecast in total.
  const windowEnd = new Date(Date.UTC(curYear, curMonth + 11, 0)); // last day of month #12
  const windowEndIso = isoDate(windowEnd);

  // Pull every case whose CB date is in the forecast window AND is not
  // already resolved as not-impacting (saved / resold / closed). We keep
  // 'open' / 'reinstated' / 'dead' so Guy sees realistic exposure.
  const casesR = await sql.query<{
    adviser_id: number | null;
    adviser_name: string | null;
    agent_bucket: string;
    clawback_date: string | null;
    gross: string | null;
    saved_amount: string | null;
    resold_amount: string | null;
    status: string;
    client_name: string;
    policy_number: string;
    postcode: string | null;
    id: number;
  }>(
    `SELECT
        c.id,
        c.adviser_id,
        a.name AS adviser_name,
        c.agent_bucket,
        c.clawback_date::text AS clawback_date,
        COALESCE(c.final_clawback_due, c.openwork_clawback_due, c.clawback_due)::text AS gross,
        c.saved_amount::text  AS saved_amount,
        c.resold_amount::text AS resold_amount,
        c.status,
        c.client_name,
        c.policy_number,
        c.postcode
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     WHERE c.clawback_date IS NOT NULL
       AND c.clawback_date >= $1::date
       AND c.clawback_date <= $2::date
       AND c.status NOT IN ('saved','resold','closed')
       ${scopeWhere}`,
    [todayIso, windowEndIso],
  );

  // Build month buckets.
  const monthsMap = new Map<string, MonthForecast>();
  for (let i = 0; i < 12; i++) {
    const m = curMonth + i;
    const y = curYear + Math.floor((m - 1) / 12);
    const mm = ((m - 1) % 12) + 1;
    const start = `${y}-${pad2(mm)}-01`;
    const lastDay = new Date(Date.UTC(y, mm, 0)).getUTCDate();
    const end = `${y}-${pad2(mm)}-${pad2(lastDay)}`;
    const key = `${y}-${pad2(mm)}`;
    monthsMap.set(key, {
      key,
      label: `${monthShort(mm)} ${y}`,
      start, end,
      sellers: [],
      totals: { gross: 0, saved: 0, resold: 0, net: 0, cases: 0 },
    });
  }

  const SELLER_ORDER = ["Tan","Hayder","Gurdaht","Atikur","Jack","Xstaff","Legacy","Needs review"];

  for (const r of casesR.rows) {
    if (!r.clawback_date) continue;
    const monthKey = r.clawback_date.slice(0, 7);
    const m = monthsMap.get(monthKey);
    if (!m) continue;
    const sellerKey = bucketLabel(r.adviser_name, r.agent_bucket);
    let s = m.sellers.find((x) => x.key === sellerKey);
    if (!s) {
      s = { key: sellerKey, adviser_id: r.adviser_id, gross: 0, saved: 0, resold: 0, net: 0, cases: 0 };
      m.sellers.push(s);
    }
    const gross  = parseAmt(r.gross);
    const saved  = parseAmt(r.saved_amount);
    const resold = parseAmt(r.resold_amount);
    s.gross  += gross;
    s.saved  += saved;
    s.resold += resold;
    s.cases  += 1;
    m.totals.gross  += gross;
    m.totals.saved  += saved;
    m.totals.resold += resold;
    m.totals.cases  += 1;
  }
  for (const m of monthsMap.values()) {
    m.sellers.sort((a, b) => SELLER_ORDER.indexOf(a.key) - SELLER_ORDER.indexOf(b.key));
    for (const s of m.sellers) s.net = Math.max(0, s.gross - s.saved);
    m.totals.net = Math.max(0, m.totals.gross - m.totals.saved);
  }
  const months = Array.from(monthsMap.values());

  // KPIs.
  const monthStart = `${curYear}-${pad2(curMonth)}-01`;
  const monthEnd   = `${curYear}-${pad2(curMonth)}-${pad2(new Date(Date.UTC(curYear, curMonth, 0)).getUTCDate())}`;
  const nextMonth = curMonth === 12 ? 1 : curMonth + 1;
  const nextMonthYear = curMonth === 12 ? curYear + 1 : curYear;
  const yearStart = `${curYear}-01-01`;

  // Forecast £ this month + next month: just sum from the month buckets.
  const currentMonthKey = `${curYear}-${pad2(curMonth)}`;
  const nextMonthKey    = `${nextMonthYear}-${pad2(nextMonth)}`;
  const curForecast  = monthsMap.get(currentMonthKey)?.totals.net  ?? 0;
  const nextForecast = monthsMap.get(nextMonthKey)?.totals.net     ?? 0;

  // Saved £ MTD and YTD pulled from clawback_history.money_off events.
  // History timestamps are stamped at the moment the seller logs the save,
  // so MTD = saves logged this month (best proxy we have for "what we've
  // banked").
  const histScopeWhere = typeof scope === "number"
    ? `AND c.adviser_id = ${scope}`
    : "";
  const savedMtdR = await sql.query<{ saved: string }>(
    `SELECT COALESCE(SUM(h.amount), 0)::text AS saved
     FROM clawback_history h
     JOIN clawback_cases c ON c.id = h.case_id
     WHERE h.event_type = 'money_off'
       AND h.money_kind = 'saved'
       AND h.created_at >= $1::date
       AND h.created_at <  ($2::date + INTERVAL '1 day')
       ${histScopeWhere}`,
    [monthStart, monthEnd],
  );
  const savedYtdR = await sql.query<{ saved: string }>(
    `SELECT COALESCE(SUM(h.amount), 0)::text AS saved
     FROM clawback_history h
     JOIN clawback_cases c ON c.id = h.case_id
     WHERE h.event_type = 'money_off'
       AND h.money_kind = 'saved'
       AND h.created_at >= $1::date
       ${histScopeWhere}`,
    [yearStart],
  );

  // Total net at risk across every open case (not just the forecast
  // window) so Guy sees the actual standing exposure.
  const netR = await sql.query<{ net: string; cases: string }>(
    `SELECT COALESCE(SUM(c.net_at_risk), 0)::text AS net,
            COUNT(*)::text                       AS cases
     FROM clawback_cases c
     WHERE c.status NOT IN ('saved','resold','closed')
       ${scopeWhere}`,
    [],
  );

  // Top 10 imminent cases (next 30 days, biggest net exposure first).
  const imminentEnd = isoDate(new Date(Date.UTC(curYear, curMonth - 1, now.getUTCDate() + 30)));
  const imminentR = await sql.query<{
    id: number; client_name: string; policy_number: string; postcode: string | null;
    adviser_name: string | null; agent_bucket: string; ebah_warning: string | null;
    clawback_date: string | null; net_at_risk: string | null; status: string;
  }>(
    `SELECT c.id, c.client_name, c.policy_number, c.postcode,
            a.name AS adviser_name, c.agent_bucket, c.ebah_warning,
            c.clawback_date::text AS clawback_date,
            c.net_at_risk::text AS net_at_risk,
            c.status
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     WHERE c.clawback_date IS NOT NULL
       AND c.clawback_date >= $1::date
       AND c.clawback_date <= $2::date
       AND c.status NOT IN ('saved','resold','closed')
       ${scopeWhere}
     ORDER BY c.net_at_risk DESC NULLS LAST, c.clawback_date ASC
     LIMIT 10`,
    [todayIso, imminentEnd],
  );

  return NextResponse.json({
    today: todayIso,
    scoped: typeof scope === "number",
    kpis: {
      currentMonthForecast: curForecast,
      nextMonthForecast: nextForecast,
      mtdSaved: parseAmt(savedMtdR.rows[0]?.saved),
      ytdSaved: parseAmt(savedYtdR.rows[0]?.saved),
      totalNetAtRisk: parseAmt(netR.rows[0]?.net),
      openCases: Number(netR.rows[0]?.cases || 0),
    },
    months,
    imminentCases: imminentR.rows.map((r) => ({
      ...r,
      net_at_risk: parseAmt(r.net_at_risk),
    })),
  });
}

// ----- helpers -------------------------------------------------------------

function parseAmt(v: string | null | undefined): number {
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
function monthShort(m: number) {
  return ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][m - 1];
}
function isoDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad2(d.getUTCMonth() + 1)}-${pad2(d.getUTCDate())}`;
}
