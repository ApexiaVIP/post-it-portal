import { NextResponse } from "next/server";
import { getSession, verifyCredentials, roleFor, isClawbackUser } from "@/lib/auth";

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
  // Allowlist gate. Historically this only admitted the admin +
  // data-entry roles, which silently locked out anyone whose ONLY role
  // is clawback (junior sellers Gurdaht / Atikur, viewer Guy): their
  // passwords verified fine but login 403'd with "no access". Mirror
  // the /api/me gate instead: any primary role OR any clawback tier
  // gets a session; the middleware enforces which paths each role can
  // actually reach once they're in.
  if (roleFor(username) === "none" && !isClawbackUser(username)) {
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
