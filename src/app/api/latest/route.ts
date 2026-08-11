// Endpoint used by the GitHub Actions runner.
// Returns today's per-adviser daily + Mon-to-today weekly sum.

import { NextResponse } from "next/server";
import { verifyApiToken } from "@/lib/auth";
import { loadManualDataFor } from "@/lib/store";
import {
  ADVISERS, ADVISER_FIELDS, RIC_FIELDS,
  emptyManualData, londonDateIso, datesInWeekUpTo,
} from "@/lib/schema";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!verifyApiToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const today = londonDateIso();
  const dates = datesInWeekUpTo(today);

  // Today's data is captured from the SAME read the weekly loop does
  // (dates always ends with today). It used to be a separate load, and
  // on 10 Aug 2026 that first read hit a transient KV failure that the
  // store silently swallowed: every evening POST IT email showed zero
  // deals/quotes/fact finds in the daily rows while the weekly rows,
  // read moments later, were correct. One shared read makes that
  // divergence structurally impossible.
  let todayData = emptyManualData();

  // Sum across this week for the weekly row.
  const weekDaily = Object.fromEntries(
    ADVISERS.map((a) => [a, Object.fromEntries(ADVISER_FIELDS.map((f) => [f.key, 0]))]),
  ) as Record<string, Record<string, number>>;
  const weekRic = Object.fromEntries(RIC_FIELDS.map((f) => [f.key, 0])) as Record<string, number>;

  let latestAt = "";
  let latestBy = "";
  for (const d of dates) {
    const dd = await loadManualDataFor(d);
    if (d === today) todayData = dd;
    for (const a of ADVISERS) {
      for (const f of ADVISER_FIELDS) {
        weekDaily[a][f.key] += Number(dd.daily[a]?.[f.key] || 0);
      }
    }
    for (const f of RIC_FIELDS) {
      weekRic[f.key] += Number(dd.ric[f.key] || 0);
    }
    if (dd.updatedAt && dd.updatedAt > latestAt) {
      latestAt = dd.updatedAt;
      latestBy = dd.updatedBy;
    }
  }

  return NextResponse.json(
    {
      // today's values → daily rows on the sheet
      daily: todayData.daily,
      ric: todayData.ric,
      ricComments: todayData.ricComments,
      // running weekly sum (Mon..today) → weekly rows on the sheet
      weekly: {
        daily: weekDaily,
        ric: weekRic,
      },
      updatedAt: latestAt,
      updatedBy: latestBy,
      today,
      weekDates: dates,
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
