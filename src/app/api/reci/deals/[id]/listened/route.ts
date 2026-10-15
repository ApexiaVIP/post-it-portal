/**
 * POST /api/reci/deals/[id]/listened  (admins)
 * Poz has listened and doesn't want this sale transcribed: it leaves the
 * listening pool. The recordings stay saved on the sale.
 */
import { NextResponse } from "next/server";
import { requireAdmin, markListened } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const n = await markListened(Number(params.id), auth.username);
  return NextResponse.json({ ok: true, marked: n });
}
