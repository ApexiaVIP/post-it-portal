/**
 * GET /api/reci/recordings  (admins) -> Poz's listening pool: every sale
 * with recordings she hasn't transcribed or marked as listened yet.
 */
import { NextResponse } from "next/server";
import { canUseCallQA } from "@/lib/auth";
import { requireAdmin, listPool, clearAbandonedUploads } from "@/lib/reci/recordings";
import { ukStatus } from "@/lib/qa/uk";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function GET() {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  await clearAbandonedUploads();
  const uk = ukStatus();
  return NextResponse.json({
    sales: await listPool(),
    call_qa: canUseCallQA(auth.username),
    uk: uk.ready ? { ready: true } : { ready: false, reason: uk.reason },
  });
}
