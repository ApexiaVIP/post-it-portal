/**
 * SMS via Webex Interact (Top Quote's existing account), 16 Jul 2026.
 *
 * Env (set in Vercel):
 *   WEBEX_SMS_API_KEY   -- Interact API key
 *   WEBEX_SMS_FROM      -- sender ID or number (e.g. "TopQuote")
 *   WEBEX_SMS_URL       -- override endpoint; defaults to the standard
 *                          Interact messaging endpoint below
 *
 * The adapter deliberately logs the raw provider response (via
 * console.error so Vercel keeps it) because Interact deployments vary;
 * the test-sms endpoint surfaces the same detail so we can adjust the
 * payload shape live during the first test rather than guessing.
 *
 * STOP/opt-out handling happens inside Webex Interact itself: it
 * suppresses sends to numbers that have replied STOP to the sender ID,
 * so the portal doesn't need its own opt-out register for v1.
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
    from,
    to: [dest],
    content: text,
    content_type: "text",
  };

  // Webex's messaging products disagree on how the key travels:
  // Interact wants an x-api-key header, Connect wants `key`, some
  // gateways want a Bearer, and Textlocal-era accounts (Interact is
  // Textlocal's UK successor, keys are ~31 chars) only work on the
  // LEGACY endpoint with the key form-encoded in the body. On an auth
  // rejection we fall through to the next style and log the one that
  // worked, so the first live test discovers the right shape without a
  // redeploy per guess. WEBEX_SMS_AUTH pins a single style once known
  // ("x-api-key" | "bearer" | "key" | "textlocal").
  type Attempt = { name: string; run: () => Promise<{ ok: boolean; status: number; body: unknown; authRejection: boolean }> };

  const headerAttempt = (name: string, authHeaders: Record<string, string>): Attempt => ({
    name,
    run: async () => {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
      let body: unknown = null;
      try { body = await r.json(); } catch { body = await r.text().catch(() => null); }
      return { ok: r.ok, status: r.status, body, authRejection: r.status === 401 || r.status === 403 };
    },
  });

  const textlocalAttempt: Attempt = {
    name: "textlocal",
    run: async () => {
      const tlUrl = process.env.WEBEX_SMS_LEGACY_URL || "https://api.txtlocal.com/send/";
      const formBody = new URLSearchParams({
        apikey: apiKey,
        numbers: dest.replace(/^\+/, ""), // legacy API wants 447..., no +
        message: text,
        sender: from,
      });
      const r = await fetch(tlUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody.toString(),
        signal: AbortSignal.timeout(15_000),
      });
      let body: unknown = null;
      try { body = await r.json(); } catch { body = await r.text().catch(() => null); }
      // Textlocal answers HTTP 200 even on failure; status lives in the body.
      const bodyStatus = (body as { status?: string } | null)?.status;
      const ok = r.ok && bodyStatus === "success";
      const errCodes = JSON.stringify((body as { errors?: unknown } | null)?.errors ?? "");
      const authRejection = !ok && /"code":(3|4)\b/.test(errCodes); // 3 = invalid key, 4 = no such key
      return { ok, status: r.status, body, authRejection };
    },
  };

  const ALL: Attempt[] = [
    headerAttempt("x-api-key", { "x-api-key": apiKey }),
    headerAttempt("bearer", { Authorization: `Bearer ${apiKey}` }),
    headerAttempt("key", { key: apiKey }),
    textlocalAttempt,
  ];
  const pinned = (process.env.WEBEX_SMS_AUTH || "").trim().toLowerCase();
  const attempts = pinned ? ALL.filter((a) => a.name === pinned) : ALL;
  if (attempts.length === 0) {
    return { sent: false, reason: `unknown WEBEX_SMS_AUTH style: ${pinned}` };
  }

  console.error(`[sms:${label}] sending`, { url, from, to: dest, chars: text.length });
  let last: SmsResult = { sent: false, reason: "no auth style attempted" };
  for (const attempt of attempts) {
    try {
      const r = await attempt.run();
      console.error(`[sms:${label}] response (auth=${attempt.name})`, { status: r.status, body: r.body });
      if (r.ok) {
        return { sent: true, status: r.status, providerResponse: { authStyle: attempt.name, body: r.body } };
      }
      last = { sent: false, status: r.status, providerResponse: { authStyle: attempt.name, body: r.body }, reason: `provider rejected (auth=${attempt.name})` };
      // Only auth rejections justify trying the next style; anything
      // else (bad payload, bad number) is a real error to surface.
      if (!r.authRejection) return last;
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e);
      console.error(`[sms:${label}] FAILED (auth=${attempt.name})`, { reason });
      last = { sent: false, reason };
      return last;
    }
  }
  return last;
}
