/**
 * POST /api/reci/deals/[id]/transcribe  (Poz's Transcribe button)
 * Sends only this sale's recordings that haven't been transcribed to Call
 * QA, transcribed in London. The recordings stay saved on the sale.
 * Admins with Call QA access; refused until UK processing is set up.
 */
import { NextResponse } from "next/server";
import { canUseCallQA } from "@/lib/auth";
import { requireAdmin, transcribeSale } from "@/lib/reci/recordings";
import { ukStatus } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";
export const maxDuration = 300;

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  if (!canUseCallQA(auth.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const uk = ukStatus();
  if (!uk.ready) return NextResponse.json({ error: uk.reason }, { status: 503 });

  const r = await transcribeSale(Number(params.id), auth.username);
  if (r.sent === 0 && r.failed.length === 0) {
    return NextResponse.json({ error: "Nothing waiting to be transcribed on this sale" }, { status: 409 });
  }
  if (r.sent === 0) return NextResponse.json({ error: r.failed.join(" | "), case_id: r.case_id }, { status: 502 });
  return NextResponse.json({ ok: true, ...r }, { status: 202 });
}
