import { NextResponse } from "next/server";
import { getSession, roleFor, isClawbackUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Returns the current user's username, role, and granular feature flags.
 * `canClawback` is true for Poz / Jimmy only -- nav uses this to show
 * the Clawback link to them and hide it from everyone else (incl. other
 * admin users like Pauline if she logs in as a different alias).
 */
export async function GET() {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const role = roleFor(session.username);
  if (role === "none") {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  return NextResponse.json({
    username: session.username,
    role,
    canClawback: isClawbackUser(session.username),
  });
}
