import { NextResponse } from "next/server";
import {
  getSession, roleFor, isClawbackUser, isClawbackAdmin, isClawbackSeller,
  isClawbackViewer, canEditClawback, canUploadEbah, canNotifyCam,
  clawbackAdviserScope,
} from "@/lib/auth";
import { sql } from "@vercel/postgres";

export const dynamic = "force-dynamic";

/**
 * Returns the current user's username, role and granular feature flags
 * the UI uses to hide buttons. For sellers, also returns their scoped
 * adviser_id + name so the dashboard can say "Viewing: Tan's cases".
 *
 * A user with the seller / viewer clawback role but no separate primary
 * role (e.g. Gurdaht, Atikur, Jack, Guy) is still allowed through.
 */
export async function GET() {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = roleFor(session.username);
  // Sellers / viewers may have role="none" if they're not in the dashboard
  // or data-entry lists. That's fine -- the clawback gating below covers them.
  if (role === "none" && !isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const scope = await clawbackAdviserScope(session.username);
  let scopedAdviser: { id: number; name: string } | null = null;
  if (typeof scope === "number") {
    const r = await sql<{ id: number; name: string }>`
      SELECT id, name FROM advisers WHERE id = ${scope}
    `;
    if ((r.rowCount ?? 0) > 0) scopedAdviser = r.rows[0];
  }

  return NextResponse.json({
    username: session.username,
    role,
    canClawback:       isClawbackUser(session.username),
    isClawbackAdmin:   isClawbackAdmin(session.username),
    isClawbackSeller:  isClawbackSeller(session.username),
    isClawbackViewer:  isClawbackViewer(session.username),
    canEditClawback:   canEditClawback(session.username),
    canUploadEbah:     canUploadEbah(session.username),
    canNotifyCam:      canNotifyCam(session.username),
    clawbackAdviserId:   scopedAdviser?.id ?? null,
    clawbackAdviserName: scopedAdviser?.name ?? null,
  });
}
