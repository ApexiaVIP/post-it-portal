import { NextResponse } from "next/server";
import { getSession, isDashboardUser } from "@/lib/auth";
import { runNightlyBackup } from "@/lib/reci/backup";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Manual on-demand RECI backup. Admin-only. Useful before any risky
 * operation (re-import, bulk delete, schema change, etc.). Stores under
 * the same KV key as the nightly cron: reci-backup:<today>. If a backup
 * already exists for today it is overwritten.
 *
 *   GET /api/admin/backup-now
 */
export async function GET() {
  const session = await getSession();
  if (!isDashboardUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  try {
    const summary = await runNightlyBackup();
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
