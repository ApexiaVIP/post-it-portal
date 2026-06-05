import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser } from "@/lib/auth";
import { getAdviserById } from "@/lib/reci/db";
import { sendClawbackEmail } from "@/lib/reci/email";
import { Deal } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Bulk-notify endpoint: sends a clawback email to the seller for every deal
 * currently sitting in the Clawback column. Idempotent in spirit but not in
 * effect — calling it twice will re-send every email, so use sparingly. The
 * primary purpose is the one-off catch-up: deals that were moved to Clawback
 * before the email feature existed.
 *
 * Admin-only. GET so it can be triggered from a browser URL.
 *
 *   GET /api/admin/clawback-notify-all
 */
export async function GET() {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { rows: deals } = await sql<Deal>`
    SELECT * FROM deals WHERE status = 'clawback' ORDER BY id ASC
  `;

  const results: Array<{ id: number; client: string; adviser_id: number; sent: boolean; reason?: string }> = [];
  for (const d of deals) {
    const adviser = await getAdviserById(d.adviser_id);
    if (!adviser) {
      results.push({ id: d.id, client: d.client, adviser_id: d.adviser_id, sent: false, reason: "adviser missing" });
      continue;
    }
    const r = await sendClawbackEmail({
      deal: d,
      adviser,
      notes: d.notes ?? null,
      changedBy: session.username ?? "system",
    });
    results.push({ id: d.id, client: d.client, adviser_id: d.adviser_id, ...r });
  }

  const summary = {
    found:  deals.length,
    sent:   results.filter((r) => r.sent).length,
    failed: results.filter((r) => !r.sent).length,
  };
  return NextResponse.json({ ok: true, summary, results });
}
