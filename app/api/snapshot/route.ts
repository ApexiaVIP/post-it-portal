/**
 * POST /api/snapshot  — called by the GitHub Actions scraper after each run.
 *                       Authenticated with the shared Bearer token.
 * GET  /api/snapshot  — used by the dashboard. Returns latest snapshot,
 *                       OR a specific one if ?date=YYYY-MM-DD&target=HH:MM.
 *                       Requires a signed-in session.
 */
import { NextResponse } from "next/server";
import { verifyApiToken, getSession } from "@/lib/auth";
import { saveSnapshot, getSnapshot, getLatestSnapshot, Snapshot } from "@/lib/snapshots";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  if (!verifyApiToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  let body: Snapshot;
  try {
    body = (await req.json()) as Snapshot;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.date || !body.target || !body.capturedAt) {
    return NextResponse.json({ error: "missing required fields" }, { status: 400 });
  }
  await saveSnapshot(body);
  return NextResponse.json({ ok: true, date: body.date, target: body.target });
}

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const date = searchParams.get("date");
  const target = searchParams.get("target");
  const snap = date && target
    ? await getSnapshot(date, target)
    : await getLatestSnapshot();
  if (!snap) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  return NextResponse.json(snap, { headers: { "Cache-Control": "no-store" } });
}
