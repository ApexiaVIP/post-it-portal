/**
 * PUT /api/reci/recordings/[id]/chunk?seq=N  (raw bytes, max 4MB per request)
 * Only the person who started the upload (or an admin) can add to it.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser } from "@/lib/auth";
import { MAX_CHUNK_BYTES } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const id = Number(params.id);
  const seq = Number(new URL(req.url).searchParams.get("seq"));
  if (!Number.isInteger(seq) || seq < 0) return NextResponse.json({ error: "bad seq" }, { status: 400 });

  const r = await sql<{ status: string; uploaded_by: string }>`SELECT status, uploaded_by FROM deal_recordings WHERE id = ${id}`;
  const rec = r.rows[0];
  if (!rec) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (rec.uploaded_by !== session.username && !isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  if (rec.status !== "uploading") return NextResponse.json({ error: "This recording is no longer accepting audio" }, { status: 409 });
  const buf = Buffer.from(await req.arrayBuffer());
  if (buf.length === 0 || buf.length > MAX_CHUNK_BYTES) {
    return NextResponse.json({ error: "Chunk must be 1 byte to 4MB" }, { status: 400 });
  }
  await sql.query(
    `INSERT INTO deal_recording_chunks (recording_id, seq, data) VALUES ($1, $2, $3)
     ON CONFLICT (recording_id, seq) DO UPDATE SET data = EXCLUDED.data`,
    [id, seq, buf],
  );
  return NextResponse.json({ ok: true });
}
