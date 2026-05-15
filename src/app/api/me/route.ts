import { NextResponse } from "next/server";
import { getSession, roleFor } from "@/lib/auth";

export const dynamic = "force-dynamic";

/**
 * Returns the current user's username and role ("admin" | "data-entry"), so
 * the client can adapt the UI (e.g. hide admin nav links from data-entry
 * users). Returns 401 if not signed in or 403 if signed in with no role.
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
  return NextResponse.json({ username: session.username, role });
}
