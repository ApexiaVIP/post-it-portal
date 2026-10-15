/**
 * GET /api/reci/recordings/[id]/audio  (admins)
 * Streams a held sale recording for listening on the sale. Answers in
 * byte ranges of at most ~4MB (the platform's response limit), which is
 * how browsers fetch audio anyway, so seeking works.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdmin, chunkMap, planRange } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const MAX_SLICE = 4 * 1024 * 1024 - 64 * 1024;
const TYPES: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", m4a: "audio/mp4", mp4: "audio/mp4", ogg: "audio/ogg", opus: "audio/ogg", flac: "audio/flac", webm: "audio/webm" };

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  const r = await sql<{ status: string; filename: string | null; mime_type: string | null }>`
    SELECT status, filename, mime_type FROM deal_recordings WHERE id = ${id}`;
  const rec = r.rows[0];
  if (!rec || rec.status !== "held") return NextResponse.json({ error: "Recording not available" }, { status: 404 });

  const plan = planRange(await chunkMap(id), req.headers.get("range"), MAX_SLICE);
  if ("unsatisfiable" in plan) {
    if (plan.total === 0) return NextResponse.json({ error: "Recording not available" }, { status: 404 });
    return new NextResponse(null, { status: 416, headers: { "Content-Range": `bytes */${plan.total}` } });
  }
  const { start, end, total } = plan;
  const rows = await sql.query<{ data: Buffer }>(
    `SELECT data FROM deal_recording_chunks WHERE recording_id = $1 AND seq = ANY($2::int[]) ORDER BY seq`, [id, plan.seqs],
  );
  const joined = Buffer.concat(rows.rows.map((x) => Buffer.from(x.data)));
  const body = joined.subarray(start - plan.firstOffset, end - plan.firstOffset + 1);

  const ext = (rec.filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return new NextResponse(new Uint8Array(body), {
    status: 206,
    headers: {
      "Content-Type": TYPES[ext] ?? rec.mime_type ?? "application/octet-stream",
      "Content-Length": String(body.length),
      "Content-Range": `bytes ${start}-${end}/${total}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, no-store",
    },
  });
}
