/**
 * GET /api/reci/recordings  (admins) -> Poz's listening pool: every sale
 * with recordings she hasn't transcribed or marked as listened yet, plus
 * the sales she has sent for transcription and where each has got to.
 */
import { NextResponse } from "next/server";
import { canUseCallQA } from "@/lib/auth";
import { requireAdmin, listPool, listSent, clearAbandonedUploads } from "@/lib/reci/recordings";
import { ukStatus } from "@/lib/qa/uk";
import { advanceTranscriptions } from "@/lib/qa/calls";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  await clearAbandonedUploads();
  await advanceTranscriptions();
  const uk = ukStatus();
  const [sales, sent] = await Promise.all([listPool(), listSent()]);
  return NextResponse.json({
    sales,
    sent,
    call_qa: canUseCallQA(auth.username),
    uk: uk.ready ? { ready: true } : { ready: false, reason: uk.reason },
  });
}
