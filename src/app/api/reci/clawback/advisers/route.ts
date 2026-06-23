/**
 * GET /api/reci/clawback/advisers
 *
 * Light lookup endpoint for the New Case form. Returns active advisers in
 * Pauline's preferred order so the sales-agent dropdown is consistent
 * with the rest of the dashboard.
 *
 * Auth: any user who can reach the Clawback Dashboard at all.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const r = await sql<{ id: number; name: string }>`
    SELECT id, name FROM advisers
    WHERE active = true
    ORDER BY sort_order ASC, name ASC
  `;
  return NextResponse.json({ advisers: r.rows });
}
