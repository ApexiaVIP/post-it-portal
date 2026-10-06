/**
 * POST   /api/qa/cases/[id]/document  (multipart "file": the suitability report PDF)
 * GET    /api/qa/cases/[id]/document  -> the stored PDF
 * DELETE /api/qa/cases/[id]/document
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase } from "@/lib/qa/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const MAX_BYTES = 4 * 1024 * 1024;

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const caseId = Number(params.id);
  if (!(await getCase(caseId))) return NextResponse.json({ error: "not found" }, { status: 404 });
  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: "PDF is larger than 4MB" }, { status: 413 });
  if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return NextResponse.json({ error: "Please upload the suitability report as a PDF" }, { status: 400 });
  }
  await sql`UPDATE qa_documents SET deleted_at = now() WHERE case_id = ${caseId} AND deleted_at IS NULL`;
  await sql.query(
    `INSERT INTO qa_documents (case_id, kind, filename, mime_type, data, uploaded_by)
     VALUES ($1, 'suitability_report', $2, 'application/pdf', $3, $4)`,
    [caseId, file.name.slice(0, 200), buf, auth.username],
  );
  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  const r = await sql.query<{ data: Buffer; filename: string | null }>(
    `SELECT data, filename FROM qa_documents WHERE case_id = $1 AND deleted_at IS NULL
      ORDER BY uploaded_at DESC LIMIT 1`, [Number(params.id)],
  );
  if (r.rows.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return new NextResponse(new Uint8Array(r.rows[0].data), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `inline; filename="${(r.rows[0].filename || "suitability-report.pdf").replace(/"/g, "")}"`,
      "Cache-Control": "no-store",
    },
  });
}

export async function DELETE(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  await sql`UPDATE qa_documents SET deleted_at = now() WHERE case_id = ${Number(params.id)} AND deleted_at IS NULL`;
  return NextResponse.json({ ok: true });
}
