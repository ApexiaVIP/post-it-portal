import { NextResponse } from "next/server";
import { getSession, verifyCredentials, isDashboardUser } from "@/lib/auth";

export async function POST(req: Request) {
  const { username, password } = (await req.json().catch(() => ({}))) as {
    username?: string;
    password?: string;
  };
  if (!username || !password) {
    return NextResponse.json({ error: "username and password required" }, { status: 400 });
  }
  const ok = await verifyCredentials(username, password);
  if (!ok) {
    return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
  }
  // Allowlist gate: even valid credentials are rejected if the user isn't in
  // DASHBOARD_USERNAMES. Don't create a session.
  if (!isDashboardUser(username)) {
    return NextResponse.json(
      { error: "This account does not have access to the portal." },
      { status: 403 },
    );
  }
  const session = await getSession();
  session.username = username;
  session.loginAt = Date.now();
  await session.save();
  return NextResponse.json({ ok: true, username });
}
