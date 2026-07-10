/**
 * Old / New Openwork classification from L&G Master Agent Code.
 *
 * Pauline confirmed (June 2026): one master code (5930268) represents
 * New Openwork business -- policies sold under the new proposition,
 * inside the 4-year indemnity period, that ALWAYS have a clawback
 * exposure that needs looking at immediately. The other two master
 * codes (8674533, 8976516) are Old Openwork -- usually 4+ years old
 * with minimal or zero clawback exposure.
 *
 * Mappings are env-driven so codes can be added without a code change:
 *   NEW_OW_MASTER_CODES   comma-separated, default: "5930268"
 *   OLD_OW_MASTER_CODES   comma-separated, default: "8674533,8976516"
 *
 * Anything outside both lists returns null -- the source stays
 * unflagged, but Pauline can still set it manually from the drawer.
 */

function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const NEW_OW = parseList(process.env.NEW_OW_MASTER_CODES ?? "5930268");
const OLD_OW = parseList(process.env.OLD_OW_MASTER_CODES ?? "8674533,8976516");

export type SourceTag = "new_ow" | "old_ow" | "other";

/**
 * Returns the source tag for the given master agent code, or null when
 * the code isn't recognised (caller leaves source untouched).
 */
export function sourceForMasterCode(code: string | null | undefined): SourceTag | null {
  if (!code) return null;
  const t = code.trim();
  if (!t) return null;
  if (NEW_OW.includes(t)) return "new_ow";
  if (OLD_OW.includes(t)) return "old_ow";
  return null;
}

/**
 * Convenience: a case is "urgent New OW" if it's tagged new_ow, still
 * carries a clawback, and hasn't been worked to an outcome yet.
 * Drives the red URGENT pill + row tint on the dashboard. V2 statuses
 * (10 Jul 2026): only 'open' still needs urgency; any worked status
 * (positive, negative, closed) drops the flag.
 */
export function isUrgentNewOw(
  source: SourceTag | string | null,
  clawbackDue: number | string | null,
  status: string | null,
): boolean {
  if (source !== "new_ow") return false;
  const cb = typeof clawbackDue === "string" ? Number(clawbackDue) : clawbackDue ?? 0;
  if (!(cb > 0)) return false;
  return status === "open";
}
