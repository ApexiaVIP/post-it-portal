/**
 * GET /api/reci/confirmations?year=&week=
 *
 * The Confirmation Planner feed (Poz, 2 Sep 2026): the week's confirmed
 * deals grouped by confirmation day, building cumulatively Monday to
 * Friday, with daily/weekly totals, Acc/Ref counts, per-CAM stats, the
 * "booked per Post-it vs confirmed" reconciliation line, and the amount
 * of business sitting in Checked status (Poz's chosen way of surfacing
 * rejected calls).
 *
 * A deal belongs to a day via its typed confirmed_date ("28/8" style,
 * parsed against the deal's year). Net commission = commission -
 * resell_cb throughout.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser } from "@/lib/auth";
import { isoWeekMonday } from "@/lib/reci/tracker";
import { loadManualDataFor } from "@/lib/store";
import { ADVISERS as POSTIT_ADVISERS } from "@/lib/schema";
import type { Deal, DealStatus, InProcessingStage } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

/** Parse Poz's typed confirmed dates: "28/8", "28/08", "28/8/26", "28/8/2026". */
function parseConfirmedDate(text: string | null, fallbackYear: number): string | null {
  if (!text) return null;
  const m = text.trim().match(/^(\d{1,2})[\/\-.](\d{1,2})(?:[\/\-.](\d{2,4}))?$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  let year = m[3] ? Number(m[3]) : fallbackYear;
  if (year < 100) year += 2000;
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const iso = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

function positionLabel(status: DealStatus, stage: InProcessingStage | null): string {
  if (status === "in_processing" && stage === "checked") return "Checked";
  if (status === "in_processing") return `In Processing${stage ? ` (${stage.toUpperCase()})` : ""}`;
  if (status === "not_yet_submitted") return "Not Yet Submitted";
  if (status === "on_risk_nyp") return "On Risk NYP";
  if (status === "paid") return "Paid";
  if (status === "cancelled") return "Cancelled";
  return "Clawback";
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const now = new Date();
  const year = Number(url.searchParams.get("year")) || now.getFullYear();
  const week = Math.max(1, Math.min(53, Number(url.searchParams.get("week"))
    || isoWeekOfToday()));

  // The week's Monday-Friday ISO dates.
  const monday = isoWeekMonday(year, week);
  const dayDates: string[] = [];
  for (let i = 0; i < 5; i++) {
    const d = new Date(monday);
    d.setUTCDate(monday.getUTCDate() + i);
    dayDates.push(d.toISOString().slice(0, 10));
  }
  const weekStart = dayDates[0];
  const sunday = new Date(monday); sunday.setUTCDate(monday.getUTCDate() + 6);
  const weekEnd = sunday.toISOString().slice(0, 10);

  const dealsR = await sql<Deal & { adviser_name: string }>`
    SELECT d.*, a.name AS adviser_name
    FROM deals d JOIN advisers a ON a.id = d.adviser_id
    WHERE d.year = ${year}
  `;

  interface PlannerDeal {
    id: number; adviser_id: number; adviser_name: string;
    client: string; acc_ref: string | null; no_of_deals: number;
    policy_type: string | null; provider: string | null;
    booked_date: string | null; premium: number | null;
    commission: number; resell_cb: number; net: number;
    position: string; confirmedOn: string;
  }
  const byDay = new Map<string, PlannerDeal[]>();
  for (const d of dealsR.rows) {
    const confirmedOn = parseConfirmedDate(d.confirmed_date, d.year);
    if (!confirmedOn || confirmedOn < weekStart || confirmedOn > weekEnd) continue;
    const commission = Number(d.commission ?? 0) || 0;
    const cb = Number(d.resell_cb ?? 0) || 0;
    const arr = byDay.get(confirmedOn) ?? [];
    arr.push({
      id: d.id, adviser_id: d.adviser_id, adviser_name: d.adviser_name,
      client: d.client, acc_ref: d.acc_ref, no_of_deals: Number(d.no_of_deals ?? 0) || 0,
      policy_type: d.policy_type, provider: d.provider,
      booked_date: d.booked_date ? String(d.booked_date).slice(0, 10) : null,
      premium: d.premium != null ? Number(d.premium) : null,
      commission, resell_cb: cb, net: commission - cb,
      position: positionLabel(d.status, d.in_processing_stage),
      confirmedOn,
    });
    byDay.set(confirmedOn, arr);
  }

  // Active advisers for the CAM stats grid (auto add/remove as team changes).
  const advisersR = await sql<{ id: number; name: string }>`
    SELECT id, name FROM advisers WHERE active = true ORDER BY sort_order, name
  `;
  const sellers = advisersR.rows;

  // Post-it booked counts (Closes) per day per seller for the
  // booked-vs-confirmed line. Post-it names match adviser names.
  const postItByDay: Record<string, { byName: Record<string, number>; total: number }> = {};
  for (const date of dayDates) {
    const manual = await loadManualDataFor(date);
    const byName: Record<string, number> = {};
    let total = 0;
    for (const a of POSTIT_ADVISERS) {
      const n = Number(manual.daily?.[a]?.Closes ?? 0) || 0;
      byName[a] = n;
      total += n;
    }
    postItByDay[date] = { byName, total };
  }

  // Build day blocks with daily + cumulative totals and CAM stats.
  const zeroCam = () => Object.fromEntries(sellers.map((s) => [s.id, { deals: 0, comm: 0 }])) as Record<number, { deals: number; comm: number }>;
  const cum = { deals: 0, comm: 0, cb: 0, net: 0, acc: 0, ref: 0, cam: zeroCam() };
  const days = dayDates.map((date) => {
    const deals = (byDay.get(date) ?? []).sort((a, b) => a.adviser_name.localeCompare(b.adviser_name) || a.id - b.id);
    const daily = { deals: 0, comm: 0, cb: 0, net: 0, acc: 0, ref: 0, cam: zeroCam() };
    for (const d of deals) {
      daily.deals += d.no_of_deals;
      daily.comm += d.commission;
      daily.cb += d.resell_cb;
      daily.net += d.net;
      if ((d.acc_ref ?? "").toUpperCase().startsWith("ACC")) daily.acc += 1;
      if ((d.acc_ref ?? "").toUpperCase().startsWith("REF")) daily.ref += 1;
      const c = daily.cam[d.adviser_id];
      if (c) { c.deals += d.no_of_deals; c.comm += d.net; }
    }
    cum.deals += daily.deals; cum.comm += daily.comm; cum.cb += daily.cb;
    cum.net += daily.net; cum.acc += daily.acc; cum.ref += daily.ref;
    for (const s of sellers) {
      cum.cam[s.id].deals += daily.cam[s.id].deals;
      cum.cam[s.id].comm += daily.cam[s.id].comm;
    }
    return {
      date,
      deals,
      daily,
      cumulative: {
        deals: cum.deals, comm: cum.comm, cb: cum.cb, net: cum.net,
        acc: cum.acc, ref: cum.ref,
        cam: Object.fromEntries(sellers.map((s) => [s.id, { ...cum.cam[s.id] }])),
      },
      postItBooked: postItByDay[date],
    };
  });

  // Business sitting in Checked status among the week's confirmed deals
  // (Poz's chosen surface for rejected calls).
  const weekDeals = Array.from(byDay.values()).flat();
  const checked = weekDeals.filter((d) => d.position === "Checked");
  const checkedTotal = { n: checked.length, net: checked.reduce((s, d) => s + d.net, 0) };

  return NextResponse.json({
    year, week, weekStart,
    sellers,
    days,
    weekTotals: {
      deals: cum.deals, comm: cum.comm, cb: cum.cb, net: cum.net,
      acc: cum.acc, ref: cum.ref, checked: checkedTotal,
    },
  });
}

function isoWeekOfToday(): number {
  const d = new Date();
  const utc = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = utc.getUTCDay() || 7;
  utc.setUTCDate(utc.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1));
  return Math.ceil(((utc.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
}
