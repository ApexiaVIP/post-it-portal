/**
 * POST /api/reci/[slug]/recordings
 *   { filename, mime_type, size_bytes, call_type, deal_id? } -> { id }
 * call_type: fact_find (FF), advice (AC) or one_call (Both).
 * Starts uploading one sale recording to this board (the seller's own
 * board, or any board for admins). The audio follows in chunks
 * (PUT /api/reci/recordings/[id]/chunk), then /recordings/finish creates
 * the sale or attaches the recordings to deal_id.
 */
import { NextResponse } from "next/server";
import { boardAccess, startRecording } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function POST(req: Request, { params }: { params: { slug: string } }) {
  const access = await boardAccess(params.slug);
  if (access instanceof NextResponse) return access;
  const body = await req.json().catch(() => null) as {
    filename?: string; mime_type?: string; size_bytes?: number; deal_id?: number | null; call_type?: string;
  } | null;
  const r = await startRecording(access, {
    filename: String(body?.filename ?? "recording"),
    mime_type: body?.mime_type ? String(body.mime_type) : null,
    size_bytes: Number(body?.size_bytes) || 0,
    deal_id: Number(body?.deal_id) > 0 ? Number(body?.deal_id) : null,
    call_type: body?.call_type,
  });
  if ("error" in r) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, id: r.id }, { status: 201 });
}
