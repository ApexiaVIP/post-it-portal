/**
 * Display helpers shared across the Clawback Dashboard pages.
 * Keeps date/currency formatting consistent so we don't get a mix of
 * ISO and en-GB on different screens.
 */

/**
 * Convert an ISO date like "2026-07-15" (or "2026-07-15T..." or null) to
 * UK format "15/07/2026". Returns the em-dash placeholder for null/empty.
 *
 * Deliberately string-based -- avoids Date() timezone shifts on bare
 * yyyy-mm-dd values (the Postgres DATE column has no time, but new Date()
 * would treat it as UTC midnight and convert to a different day in BST).
 */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso; // pass through anything that doesn't look like ISO
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Currency formatter used everywhere (£ amounts). */
export function fmtGbp(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", {
    style: "currency", currency: "GBP",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}
