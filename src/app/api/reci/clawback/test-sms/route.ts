/**
 * POST /api/reci/clawback/test-sms
 *
 * Admin-only smoke test for the Webex Interact SMS adapter (16 Jul
 * 2026, first live test with Guy + Poz in the room). Sends a short
 * test message to the given number and returns the raw provider
 * response so payload-shape problems are visible immediately.
 *
 * Body: { to: string, text?: string }
 */
import { NextResponse } from "next/server";
import { getSession, isClawbackUser, isClawbackAdmin, verifyApiToken } from "@/lib/auth";
import { sendSms, normaliseUkMobile } from "@/lib/reci/sms";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  // Admin session OR the machine API token (so the first live test can
  // be driven from the CLI while the team watches the phone).
  const tokenOk = verifyApiToken(req.headers.get("authorization"));
  const session = await getSession();
  const sessionOk = isClawbackUser(session.username) && isClawbackAdmin(session.username);
  if (!tokenOk && !sessionOk) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const body = await req.json().catch(() => ({})) as { to?: unknown; text?: unknown };
  const to = typeof body.to === "string" ? body.to.trim() : "";
  if (!to) {
    return NextResponse.json({ error: "to (mobile number) required" }, { status: 400 });
  }
  const text = typeof body.text === "string" && body.text.trim()
    ? body.text.trim().slice(0, 320)
    : "Test message from the Top Quote portal (Webex Interact). If you can read this, SMS is working.";

  const result = await sendSms(to, text, `test-by-${session.username || "api-token"}`);
  return NextResponse.json({
    ok: result.sent,
    normalisedTo: normaliseUkMobile(to),
    status: result.status ?? null,
    providerResponse: result.providerResponse ?? null,
    reason: result.reason ?? null,
  }, { status: result.sent ? 200 : 502 });
}
