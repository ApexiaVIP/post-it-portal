/**
 * GET /api/qa/deals?adviser_id=  -> the adviser's RECI deals from the last
 * 120 days, for linking a QA case to its deal (coverage MI).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET(req: Request) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const adviserId = Number(new URL(req.url).searchParams.get("adviser_id"));
  if (!(adviserId > 0)) return NextResponse.json({ deals: [] });
  const r = await sql`
    SELECT d.id, d.client, d.provider, d.status, d.week, d.year, d.booked_date::text AS booked_date,
           EXISTS (SELECT 1 FROM qa_cases q WHERE q.deal_id = d.id AND q.deleted_at IS NULL) AS has_qa
      FROM deals d
     WHERE d.adviser_id = ${adviserId}
       AND COALESCE(d.booked_date, d.created_at::date) >= (now() - interval '120 days')::date
     ORDER BY COALESCE(d.booked_date, d.created_at::date) DESC, d.id DESC
     LIMIT 200`;
  return NextResponse.json({ deals: r.rows });
}
