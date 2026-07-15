/**
 * POST /api/post-it-email
 *
 * Relay endpoint for the post-it-automation GitHub Action (15 Jul
 * 2026). The Action generates the POST IT workbook, then hands it
 * here instead of speaking SMTP itself; the portal sends it via the
 * same Purelymail transport (SMTP_* env in Vercel) as every other
 * email. One email pipeline, one set of credentials.
 *
 * Auth: same bearer token the Action already uses for /api/latest
 * and /api/snapshot (READ_API_TOKEN).
 *
 * Body (JSON):
 *   {
 *     subject:     string,
 *     body:        string,           // plain-text email body
 *     filename:    string,           // e.g. "POST_IT_2026-07-15_1700.xlsx"
 *     xlsx_base64: string,           // the workbook, base64
 *     recipients:  string[],         // from the Action's EMAIL_RECIPIENTS
 *   }
 */
import { NextResponse } from "next/server";
import { verifyApiToken } from "@/lib/auth";
import { sendPostItWorkbookEmail } from "@/lib/reci/email";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Workbooks are tens of KB; anything past a few MB means something is
// wrong upstream. Base64 inflates ~4/3, so 8MB of base64 ≈ 6MB file.
const MAX_BASE64_LENGTH = 8 * 1024 * 1024;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(req: Request) {
  if (!verifyApiToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const body = await req.json().catch(() => null) as {
    subject?: unknown; body?: unknown; filename?: unknown;
    xlsx_base64?: unknown; recipients?: unknown;
  } | null;
  if (!body) {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  const subject  = typeof body.subject === "string" ? body.subject.trim() : "";
  const text     = typeof body.body === "string" ? body.body : "";
  const filename = typeof body.filename === "string" && body.filename.trim()
    ? body.filename.trim().replace(/[/\\]/g, "_")
    : "POST_IT.xlsx";
  const b64      = typeof body.xlsx_base64 === "string" ? body.xlsx_base64 : "";
  const recipients = Array.isArray(body.recipients)
    ? body.recipients.filter((r): r is string => typeof r === "string" && EMAIL_RE.test(r.trim())).map((r) => r.trim())
    : [];

  if (!subject) return NextResponse.json({ error: "subject required" }, { status: 400 });
  if (!b64)     return NextResponse.json({ error: "xlsx_base64 required" }, { status: 400 });
  if (b64.length > MAX_BASE64_LENGTH) {
    return NextResponse.json({ error: "attachment too large" }, { status: 413 });
  }
  if (recipients.length === 0) {
    return NextResponse.json({ error: "at least one valid recipient required" }, { status: 400 });
  }

  const result = await sendPostItWorkbookEmail({
    recipients, subject, body: text, filename, xlsxBase64: b64,
  });
  if (!result.sent) {
    return NextResponse.json({ ok: false, error: result.reason || "send failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, recipients: recipients.length });
}
