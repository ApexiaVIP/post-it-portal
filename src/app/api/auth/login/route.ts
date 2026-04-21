import { NextResponse } from "next/server";
import { getSession, verifyCredentials } from "@/lib/auth";

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
  const session = await getSession();
  session.username = username;
  session.loginAt = Date.now();
  await session.save();
  return NextResponse.json({ ok: true, username });
}
