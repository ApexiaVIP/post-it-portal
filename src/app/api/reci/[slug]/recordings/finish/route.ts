/**
 * POST /api/reci/[slug]/recordings/finish  { recording_ids, deal_id? } -> { deal_id }
 * Once every recording has uploaded in full: creates a Not Yet Submitted
 * sale for them, or attaches them to deal_id.
 */
import { NextResponse } from "next/server";
import { boardAccess, finishRecordings } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const access = await boardAccess(params.slug);
  if (access instanceof NextResponse) return access;
  const body = await req.json().catch(() => null) as { recording_ids?: unknown; deal_id?: number | null } | null;
  const ids = Array.isArray(body?.recording_ids)
    ? body!.recording_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  const r = await finishRecordings(access, Array.from(new Set(ids)), Number(body?.deal_id) > 0 ? Number(body?.deal_id) : null);
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, deal_id: r.deal_id });
}
