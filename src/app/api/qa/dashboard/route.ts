/**
 * GET /api/qa/dashboard?from=YYYY-MM-DD&to=YYYY-MM-DD&adviser_id=
 * Call QA MI (see src/lib/qa/dashboard.ts).
 */
import { NextResponse } from "next/server";
import { requireCallQA } from "@/lib/qa/db";
import { buildDashboard } from "@/lib/qa/dashboard";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const url = new URL(req.url);
  const today = new Date().toISOString().slice(0, 10);
  const from = ISO.test(url.searchParams.get("from") ?? "") ? url.searchParams.get("from")! : "2026-01-01";
  const to = ISO.test(url.searchParams.get("to") ?? "") ? url.searchParams.get("to")! : today;
  const adviserId = Number(url.searchParams.get("adviser_id")) > 0 ? Number(url.searchParams.get("adviser_id")) : null;
  return NextResponse.json(await buildDashboard(from, to, adviserId));
}
