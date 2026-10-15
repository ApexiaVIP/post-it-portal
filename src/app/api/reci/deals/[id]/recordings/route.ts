/**
 * GET /api/reci/deals/[id]/recordings  (admins) -> the sale's recordings
 * and, for any transcribed, where they are in Call QA.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { canUseCallQA } from "@/lib/auth";
import { requireAdmin, listDealRecordings } from "@/lib/reci/recordings";
import { ukStatus } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const dealId = Number(params.id);
  const [recordings, adviser] = await Promise.all([
    listDealRecordings(dealId),
    sql<{ slug: string }>`SELECT a.slug FROM deals d JOIN advisers a ON a.id = d.adviser_id WHERE d.id = ${dealId}`,
  ]);
  if (adviser.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  const uk = ukStatus();
  return NextResponse.json({
    slug: adviser.rows[0].slug,
    recordings,
    call_qa: canUseCallQA(auth.username),
    uk: uk.ready ? { ready: true } : { ready: false, reason: uk.reason },
  });
}
