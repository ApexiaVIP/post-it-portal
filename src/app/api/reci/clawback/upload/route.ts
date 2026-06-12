/**
 * POST /api/reci/clawback/upload
 *
 * Multipart form with a single `file` field containing an L&G EBAH xlsx.
 * Parses, upserts cases, returns the ingest summary. Auth-gated to
 * jimmy / pauline / poz.
 */
import { NextResponse } from "next/server";
import { getSession, isClawbackUser, canUploadEbah } from "@/lib/auth";
import { ingestEbahFile } from "@/lib/reci/clawback-ingest";

export const dynamic = "force-dynamic";
// Vercel Pro plan ceiling. The batched ingest handles ~700 rows in
// well under 10s, but raising the ceiling protects us against a
// future provider format with 5k+ rows.
export const maxDuration = 300;

export async function POST(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !canUploadEbah(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "expected multipart form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing file field" }, { status: 400 });
  }
  if (!/\.xlsx$/i.test(file.name)) {
    return NextResponse.json({ error: "only .xlsx is supported" }, { status: 400 });
  }
  const buf = Buffer.from(await file.arrayBuffer());

  try {
    const summary = await ingestEbahFile(buf, file.name, session.username!);
    return NextResponse.json({ ok: true, summary });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
