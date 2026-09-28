/**
 * Parsing for the per-deal welcome email fields (Poz, 28 Sep 2026),
 * shared by the create (POST /api/reci/[slug]) and edit
 * (PATCH /api/reci/deals/[id]) routes. Only keys present in the body are
 * returned, so a PATCH that omits them leaves the stored values alone.
 */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseWelcomeFields(body: Record<string, unknown>): {
  client_email?: string | null;
  policy_number?: string | null;
  policy_start_date?: string | null;
  first_dd_date?: string | null;
} {
  const out: ReturnType<typeof parseWelcomeFields> = {};
  const text = (v: unknown, max: number) => {
    const s = v == null ? "" : String(v).trim();
    return s ? s.slice(0, max) : null;
  };
  const date = (v: unknown) => (typeof v === "string" && ISO_DATE.test(v) ? v : null);
  if ("client_email" in body) {
    const e = text(body.client_email, 200);
    out.client_email = e ? e.toLowerCase() : null;
  }
  if ("policy_number" in body) out.policy_number = text(body.policy_number, 60);
  if ("policy_start_date" in body) out.policy_start_date = date(body.policy_start_date);
  if ("first_dd_date" in body) out.first_dd_date = date(body.first_dd_date);
  return out;
}
