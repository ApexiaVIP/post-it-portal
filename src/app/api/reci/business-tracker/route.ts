import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { businessTrackerByAdviser, parseScopeFromParams } from "@/lib/reci/tracker";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const { searchParams } = new URL(req.url);
  const year = Number(searchParams.get("year") || new Date().getFullYear());
  const scope = parseScopeFromParams(searchParams);
  // Parse the `advisers` comma-list. Guard against the empty-string trap:
  // `Number("") === 0` (not NaN), so the previous `.map(Number).filter(isFinite)`
  // turned a missing param into [0] — which then matched no adviser and
  // silently dropped every deal in the no-filter code path. Strip blanks BEFORE
  // Number() and also reject anything <= 0 since adviser IDs are positive.
  const advParam = searchParams.get("advisers");
  const advRaw = advParam
    ? advParam.split(",")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .map((s) => Number(s))
        .filter((n) => Number.isFinite(n) && n > 0)
    : [];
  const filter = advRaw.length > 0 ? advRaw : null;
  const result = await businessTrackerByAdviser(year, scope, filter);
  return NextResponse.json(result);
}
