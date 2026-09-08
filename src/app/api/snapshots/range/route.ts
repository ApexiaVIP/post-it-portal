/**
 * GET /api/snapshots/range?year=&from=&to=&adviser=
 *
 * The digital version of Hayder's Monday handout (Poz, 8 Sep 2026):
 * per-week call-centre stats over a chosen week range for one seller
 * (or the whole team), with totals and per-week averages.
 *
 * Columns mirror his sheet: Call time, Fact Finds, Quotes, Qu/FF %,
 * Closes, Cl/Qu %, Deals, D/Cl %, D/FF %, Mins p/Deal.
 *
 * Sources: each week's figures come from the LAST POST IT snapshot of
 * that week (weekly_auto = talk/calls, weekly_manual = FF/Quotes/
 * Closes, both cumulative Mon-to-capture), and Deals come from the
 * Reci (sum of no_of_deals excluding cancelled/clawback, the same
 * count the wages run on).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, canViewCallCentreMI } from "@/lib/auth";
import { getSnapshot, listDatesWithSnapshots, listSnapshotTargets } from "@/lib/snapshots";
import { ADVISERS } from "@/lib/schema";
import { isoWeekMonday } from "@/lib/reci/tracker";

export const dynamic = "force-dynamic";

function mmssToMinutes(v: number): number {
  const mins = Math.trunc(v);
  const secs = Math.round((v - mins) * 100);
  return mins + secs / 60;
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!canViewCallCentreMI(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const from = Math.max(1, Math.min(53, Number(url.searchParams.get("from")) || 1));
  const to = Math.max(from, Math.min(53, Number(url.searchParams.get("to")) || 53));
  const adviserRaw = url.searchParams.get("adviser") || "team";
  const adviser = (ADVISERS as readonly string[]).includes(adviserRaw) ? adviserRaw : "team";

  // Map every snapshot date to its ISO week so each week resolves to
  // its last captured day.
  const allDates = await listDatesWithSnapshots();
  const weekOf = (iso: string): { y: number; w: number } => {
    const d = new Date(iso + "T12:00:00Z");
    const utc = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
    const day = utc.getUTCDay() || 7;
    utc.setUTCDate(utc.getUTCDate() + 4 - day);
    const ys = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
    return { y: utc.getUTCFullYear(), w: Math.ceil(((utc.getTime() - ys.getTime()) / 86400000 + 1) / 7) };
  };
  const lastDateByWeek = new Map<number, string>();
  for (const date of allDates) {
    const { y, w } = weekOf(date);
    if (y !== year || w < from || w > to) continue;
    const cur = lastDateByWeek.get(w);
    if (!cur || date > cur) lastDateByWeek.set(w, date);
  }

  // Deals per adviser per week from the Reci (wage-accurate counts).
  const dealsR = await sql<{ week: number; name: string; deals: string }>`
    SELECT d.week, a.name, COALESCE(SUM(d.no_of_deals), 0)::text AS deals
    FROM deals d JOIN advisers a ON a.id = d.adviser_id
    WHERE d.year = ${year} AND d.status NOT IN ('cancelled', 'clawback')
    GROUP BY d.week, a.name
  `;
  const dealsByWeek = new Map<number, Map<string, number>>();
  for (const r of dealsR.rows) {
    const m = dealsByWeek.get(r.week) ?? new Map();
    m.set(r.name, Number(r.deals) || 0);
    dealsByWeek.set(r.week, m);
  }

  interface WeekRow {
    week: number;
    callMins: number; ff: number; quotes: number; closes: number; deals: number;
    quFfPct: number | null; clQuPct: number | null; dClPct: number | null; dFfPct: number | null;
    minsPerDeal: number | null;
  }
  const rows: WeekRow[] = [];
  for (let w = from; w <= to; w++) {
    const date = lastDateByWeek.get(w);
    let callMins = 0, ff = 0, quotes = 0, closes = 0;
    if (date) {
      const targets = await listSnapshotTargets(date);
      const target = targets.sort().at(-1);
      const snap = target ? await getSnapshot(date, target) : null;
      if (snap) {
        const names = adviser === "team" ? (ADVISERS as readonly string[]) : [adviser];
        for (const n of names) {
          const auto = snap.weekly_auto?.[n];
          if (auto) callMins += mmssToMinutes(Number(auto.talk_time_mmss) || 0);
          const man = snap.weekly_manual?.[n];
          if (man) {
            ff += Number(man.Fact_Find ?? 0) || 0;
            quotes += Number(man.Quotes ?? 0) || 0;
            closes += Number(man.Closes ?? 0) || 0;
          }
        }
      }
    }
    const weekDeals = dealsByWeek.get(w);
    const deals = weekDeals
      ? (adviser === "team"
          ? Array.from(weekDeals.values()).reduce((s, n) => s + n, 0)
          : (weekDeals.get(adviser) ?? 0))
      : 0;
    if (!date && deals === 0) continue; // nothing at all for the week
    rows.push({
      week: w,
      callMins: Math.round(callMins * 100) / 100,
      ff, quotes, closes, deals,
      quFfPct: ff > 0 ? quotes / ff : null,
      clQuPct: quotes > 0 ? closes / quotes : null,
      dClPct: closes > 0 ? deals / closes : null,
      dFfPct: ff > 0 ? deals / ff : null,
      minsPerDeal: deals > 0 ? Math.round((callMins / deals) * 100) / 100 : null,
    });
  }

  const total = rows.reduce(
    (a, r) => ({
      callMins: a.callMins + r.callMins, ff: a.ff + r.ff, quotes: a.quotes + r.quotes,
      closes: a.closes + r.closes, deals: a.deals + r.deals,
    }),
    { callMins: 0, ff: 0, quotes: 0, closes: 0, deals: 0 },
  );
  const n = rows.length || 1;
  return NextResponse.json({
    year, from, to, adviser,
    weekMonday: rows.length ? isoWeekMonday(year, rows[0].week).toISOString().slice(0, 10) : null,
    rows,
    total: {
      ...total,
      quFfPct: total.ff > 0 ? total.quotes / total.ff : null,
      clQuPct: total.quotes > 0 ? total.closes / total.quotes : null,
      dClPct: total.closes > 0 ? total.deals / total.closes : null,
      dFfPct: total.ff > 0 ? total.deals / total.ff : null,
      minsPerDeal: total.deals > 0 ? Math.round((total.callMins / total.deals) * 100) / 100 : null,
    },
    average: {
      callMins: Math.round((total.callMins / n) * 100) / 100,
      ff: Math.round((total.ff / n) * 10) / 10,
      quotes: Math.round((total.quotes / n) * 10) / 10,
      closes: Math.round((total.closes / n) * 10) / 10,
      deals: Math.round((total.deals / n) * 10) / 10,
    },
    weeksCounted: rows.length,
  });
}
