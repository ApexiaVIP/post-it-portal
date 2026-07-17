/**
 * SMS via Webex Interact (Top Quote's existing account), 16 Jul 2026.
 *
 * Contract per https://docs.webexinteract.com/reference/authentication.md
 * and /reference/sms-api.md:
 *
 *   POST https://api.webexinteract.com/v1/sms
 *   Header  X-AUTH-KEY: <access token>   (from Developers -> API project)
 *   Body    { message_body, from, to: [{ phone: ["+44..."] }] }
 *
 * Env (set in Vercel):
 *   WEBEX_SMS_API_KEY   -- the API project's access/production token
 *   WEBEX_SMS_FROM      -- sender ID (e.g. "TOPQUOTE")
 *   WEBEX_SMS_URL       -- endpoint override; defaults to the URL above
 *
 * We deliberately do NOT set skip_optout_check, so Interact's own
 * "Reply STOP" opt-out register is honoured on every send and the
 * portal doesn't need its own opt-out list for v1.
 *
 * The adapter logs the raw provider response (via console.error so
 * Vercel keeps it) and returns it to callers like the /api/sms-test
 * endpoint, so payload problems are visible immediately.
 */

const DEFAULT_URL = "https://api.webexinteract.com/v1/sms";

export interface SmsResult {
  sent: boolean;
  status?: number;
  providerResponse?: unknown;
  reason?: string;
}

/** Normalise a UK number to E.164 (+44...). Returns null if hopeless. */
export function normaliseUkMobile(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+44")) return digits;
  if (digits.startsWith("44")) return `+${digits}`;
  if (digits.startsWith("07") && digits.length === 11) return `+44${digits.slice(1)}`;
  if (digits.startsWith("7") && digits.length === 10) return `+44${digits}`;
  return null;
}

export async function sendSms(to: string, text: string, label: string): Promise<SmsResult> {
  const apiKey = process.env.WEBEX_SMS_API_KEY;
  const from = process.env.WEBEX_SMS_FROM;
  if (!apiKey || !from) {
    console.error(`[sms:${label}] WEBEX_SMS_API_KEY / WEBEX_SMS_FROM not configured`);
    return { sent: false, reason: "SMS credentials not configured" };
  }
  const url = process.env.WEBEX_SMS_URL || DEFAULT_URL;
  const dest = normaliseUkMobile(to);
  if (!dest) {
    console.error(`[sms:${label}] unusable destination number`, { to });
    return { sent: false, reason: `unusable destination number: ${to}` };
  }

  const payload = {
    message_body: text,
    from,
    to: [{ phone: [dest] }],
  };
  console.error(`[sms:${label}] sending`, { url, from, to: dest, chars: text.length });
  try {
    const r = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-AUTH-KEY": apiKey,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000),
    });
    let body: unknown = null;
    try { body = await r.json(); } catch { body = await r.text().catch(() => null); }
    console.error(`[sms:${label}] response`, { status: r.status, body });
    if (!r.ok) {
      return { sent: false, status: r.status, providerResponse: body, reason: `provider returned ${r.status}` };
    }
    return { sent: true, status: r.status, providerResponse: body };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[sms:${label}] FAILED`, { reason });
    return { sent: false, reason };
  }
}
