/**
 * PUT /api/qa/calls/[id]/chunk?seq=N  (raw bytes, max 4MB per request)
 * Holds the recording only until it has been transcribed.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const MAX_CHUNK = 4 * 1024 * 1024;

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const callId = Number(params.id);
  const seq = Number(new URL(req.url).searchParams.get("seq"));
  if (!Number.isInteger(seq) || seq < 0) return NextResponse.json({ error: "bad seq" }, { status: 400 });

  const call = await sql`SELECT status FROM qa_calls WHERE id = ${callId} AND deleted_at IS NULL`;
  if (call.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (call.rows[0].status !== "uploading") {
    return NextResponse.json({ error: "This call is no longer accepting audio" }, { status: 409 });
  }
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_CHUNK) {
    return NextResponse.json({ error: "Chunk must be 1 byte to 4MB" }, { status: 400 });
  }
  await sql.query(
    `INSERT INTO qa_upload_chunks (call_id, seq, data) VALUES ($1, $2, $3)
     ON CONFLICT (call_id, seq) DO UPDATE SET data = EXCLUDED.data`,
    [callId, seq, buf],
  );
  return NextResponse.json({ ok: true });
}
