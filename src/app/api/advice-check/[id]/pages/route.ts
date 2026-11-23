/**
 * POST /api/advice-check/[id]/pages  (multipart "file")
 *
 * One photo or scan of the Fact Find sheet, before the check is run. Photos
 * are shrunk in the browser first (lib/advice/upload.ts); a PDF goes as it
 * is. The pages are held only until the sheet has been read, then deleted.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireAdviceCheck, getCheck, canSee } from "@/lib/advice/db";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

const MAX_BYTES = 4 * 1024 * 1024;
const MAX_PAGES = 20;

function kind(buf: Buffer): string | null {
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return "image/jpeg";
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  return null;
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const u = await requireAdviceCheck();
  if (u instanceof NextResponse) return u;
  const c = await getCheck(Number(params.id));
  if (!c || !canSee(u, c)) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (c.status !== "draft") return NextResponse.json({ error: "This check has already been run." }, { status: 409 });

  const form = await req.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "No file" }, { status: 400 });
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > MAX_BYTES) return NextResponse.json({ error: `${file.name} is larger than 4MB. Photograph the pages instead.` }, { status: 413 });
  const mime = kind(buf);
  if (!mime) return NextResponse.json({ error: `${file.name} isn't a photo (JPEG or PNG) or a PDF.` }, { status: 400 });

  const n = await sql<{ n: number }>`SELECT COUNT(*)::int AS n FROM advice_check_pages WHERE check_id = ${c.id}`;
  const count = n.rows[0]?.n ?? 0;
  if (count >= MAX_PAGES) return NextResponse.json({ error: `Up to ${MAX_PAGES} pages.` }, { status: 400 });
  await sql.query(
    `INSERT INTO advice_check_pages (check_id, page_no, mime_type, data) VALUES ($1, $2, $3, $4)`,
    [c.id, count + 1, mime, buf],
  );
  return NextResponse.json({ ok: true, pages: count + 1 });
}
