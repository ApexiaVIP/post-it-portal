/**
 * GET /api/reci/business-tracker/seller?year=&adviser=
 *
 * One adviser's Business Tracker measures per month and per quarter
 * (Poz/Guy, 2 Sep 2026) for the Seller Trends page.
 */
import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { sellerPerformance } from "@/lib/reci/tracker";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const url = new URL(req.url);
  const year = Number(url.searchParams.get("year")) || new Date().getFullYear();
  const adviser = Number(url.searchParams.get("adviser")) || 0;
  const result = await sellerPerformance(year, adviser);
  return NextResponse.json(result);
}
