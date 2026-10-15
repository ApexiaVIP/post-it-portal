/**
 * DELETE /api/reci/recordings/[id]  (admins) -> deletes the held audio.
 * The row stays on the sale as a record that a recording was received.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdmin } from "@/lib/reci/recordings";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireAdmin();
  if (auth instanceof NextResponse) return auth;
  const id = Number(params.id);
  await sql`DELETE FROM deal_recording_chunks WHERE recording_id = ${id}`;
  await sql`
    UPDATE deal_recordings SET status = 'deleted', audio_removed_at = now(), removed_by = ${auth.username}
     WHERE id = ${id} AND status IN ('held', 'uploading')`;
  return NextResponse.json({ ok: true });
}
