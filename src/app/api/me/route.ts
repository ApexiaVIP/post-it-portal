import { NextResponse } from "next/server";
import {
  getSession, roleFor, isClawbackUser, isClawbackAdmin,
  isSeniorSeller, isJuniorSeller, isClawbackSeller,
  isClawbackViewer, canEditClawback, canEditAnyCase,
  canUploadEbah, canNotifyCam,
  getEditableAdviserId,
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

  // Junior sellers get an editableAdviserId pointing at their own adviser
  // row. Admin / senior / viewer return null. Used by the dashboard to
  // decide on a per-row basis whether the "Take action on this case"
  // verification gate fires.
  const editableAdviserId = await getEditableAdviserId(session.username);
  let editableAdviser: { id: number; name: string } | null = null;
  if (typeof editableAdviserId === "number") {
    const r = await sql<{ id: number; name: string }>`
      SELECT id, name FROM advisers WHERE id = ${editableAdviserId}
    `;
    if ((r.rowCount ?? 0) > 0) editableAdviser = r.rows[0];
  }

  return NextResponse.json({
    username: session.username,
    role,
    canClawback:       isClawbackUser(session.username),
    isClawbackAdmin:   isClawbackAdmin(session.username),
    isSeniorSeller:    isSeniorSeller(session.username),
    isJuniorSeller:    isJuniorSeller(session.username),
    isClawbackSeller:  isClawbackSeller(session.username),
    isClawbackViewer:  isClawbackViewer(session.username),
    canEditClawback:   canEditClawback(session.username),
    canEditAnyCase:    canEditAnyCase(session.username),
    canUploadEbah:     canUploadEbah(session.username),
    canNotifyCam:      canNotifyCam(session.username),
    // For junior sellers: the adviser_id whose cases they're allowed to
    // edit. Null for admins / senior sellers (can edit all) and viewers
    // (can edit none). The dashboard uses this to gate the "Take action"
    // button per row.
    editableAdviserId:   editableAdviser?.id ?? null,
    editableAdviserName: editableAdviser?.name ?? null,
    // Legacy aliases kept so existing callers that reference
    // clawbackAdviserId / clawbackAdviserName still work. Same value as
    // editableAdviserId today.
    clawbackAdviserId:   editableAdviser?.id ?? null,
    clawbackAdviserName: editableAdviser?.name ?? null,
  });
}
