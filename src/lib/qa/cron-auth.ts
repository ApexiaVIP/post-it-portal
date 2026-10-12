/**
 * The Call QA scheduled jobs spend money on transcription and AI, so they
 * only run when Vercel's scheduler calls with CRON_SECRET; without the
 * secret configured they refuse rather than run open.
 */
import { NextResponse } from "next/server";

export function cronDenied(req: Request): NextResponse | null {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (req.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "forbidden" }, { status: 401 });
  }
  return null;
}
