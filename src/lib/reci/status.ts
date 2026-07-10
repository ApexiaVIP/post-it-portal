/**
 * Clawback case status taxonomy, v2 (Guy's spec, agreed 10 Jul 2026).
 *
 * Statuses come in Off/On pairs mirroring the EBAH trigger categories:
 * every negative (commission Off) has a positive (commission On /
 * saved) counterpart, except the two "other" negatives which have no
 * On side. "open" renders as "Not worked"; "closed" is admin-only.
 *
 *   Negative (Off)              Positive (On)
 *   lost_cfo                    saved_cfo
 *   lost_lapse                  saved_lapse
 *   resold_off (replaced        resold_on (we rewrote it)
 *     elsewhere, not by us)
 *   redraw_off (redraw          redraw_on (redrawn on new terms)
 *     declined)
 *   dd_cancelled                dd_reinstated
 *   bp_off (bounced premium     bp_saved (collected)
 *     unrecovered)
 *   dead_client (claim declined; no On counterpart)
 *   post_completion (medical decline; no On counterpart)
 *
 * Net position = exposure minus positives (confirmed by Guy), which
 * means unworked cases count against the number until worked.
 *
 * This module is framework-free so both API routes and client pages
 * can import it.
 */

export const CASE_STATUSES = [
  "open",
  "saved_cfo", "saved_lapse", "resold_on", "redraw_on", "dd_reinstated", "bp_saved",
  "lost_cfo", "lost_lapse", "resold_off", "redraw_off", "dd_cancelled", "bp_off",
  "dead_client", "post_completion",
  "closed",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export function isCaseStatus(s: unknown): s is CaseStatus {
  return typeof s === "string" && (CASE_STATUSES as readonly string[]).includes(s);
}

export const POSITIVE_STATUSES = [
  "saved_cfo", "saved_lapse", "resold_on", "redraw_on", "dd_reinstated", "bp_saved",
] as const;

export const NEGATIVE_STATUSES = [
  "lost_cfo", "lost_lapse", "resold_off", "redraw_off", "dd_cancelled", "bp_off",
  "dead_client", "post_completion",
] as const;

/** Negatives with no On counterpart; grouped as "Other" in Guy's report. */
export const OTHER_NEGATIVE_STATUSES = ["dead_client", "post_completion"] as const;

/** Statuses that still need working. */
export const ACTIVE_STATUSES = ["open"] as const;

export const STATUS_LABELS: Record<CaseStatus, string> = {
  open:            "Not worked",
  saved_cfo:       "Saved CFO",
  saved_lapse:     "Saved Lapse",
  resold_on:       "Resold On",
  redraw_on:       "Redraw On",
  dd_reinstated:   "DD Reinstated",
  bp_saved:        "BP Saved",
  lost_cfo:        "Lost CFO",
  lost_lapse:      "Lost Lapse",
  resold_off:      "Resold Off",
  redraw_off:      "Redraw Off",
  dd_cancelled:    "DD Mandate Cancelled",
  bp_off:          "Bounced Premium Off",
  dead_client:     "Dead Client - Claim Declined",
  post_completion: "Post Completion - Medical Decline",
  closed:          "Closed",
};

export type StatusGroup = "none" | "pos" | "neg" | "admin";
export function statusGroup(s: string): StatusGroup {
  if ((POSITIVE_STATUSES as readonly string[]).includes(s)) return "pos";
  if ((NEGATIVE_STATUSES as readonly string[]).includes(s)) return "neg";
  if (s === "closed") return "admin";
  return "none";
}

/**
 * Legacy (pre-10 Jul 2026) status values that may still appear in
 * clawback_history old/new_value strings. Display-only fallback.
 */
export const LEGACY_STATUS_LABELS: Record<string, string> = {
  saved: "Saved (legacy)",
  resold: "Resold (legacy)",
  dead: "Lost (legacy)",
  reinstated: "Reinstated (legacy)",
  redraw: "Redraw (legacy)",
};

export function statusLabel(s: string): string {
  return (STATUS_LABELS as Record<string, string>)[s]
    ?? LEGACY_STATUS_LABELS[s]
    ?? s;
}

/**
 * Which Off/On pair does an EBAH warning belong to? Used to pick the
 * right saved_* / lost_* status when auto-flipping from a £ entry, and
 * to default the picker in the Mark as LOST panel.
 */
export type WarningPair = "cfo" | "lapse" | "dd" | "bp";
export function pairForWarning(warning: string | null | undefined): WarningPair {
  const w = (warning || "").toLowerCase();
  if (w.includes("outset")) return "cfo";
  if (w.includes("bounce")) return "bp";
  if (w.includes("dd") || w.includes("mandate") || w.includes("direct debit")) return "dd";
  return "lapse"; // Lapse is the commonest EBAH category; safe default
}

export function savedStatusForWarning(warning: string | null | undefined): CaseStatus {
  switch (pairForWarning(warning)) {
    case "cfo": return "saved_cfo";
    case "bp":  return "bp_saved";
    case "dd":  return "dd_reinstated";
    default:    return "saved_lapse";
  }
}

export function lostStatusForWarning(warning: string | null | undefined): CaseStatus {
  switch (pairForWarning(warning)) {
    case "cfo": return "lost_cfo";
    case "bp":  return "bp_off";
    case "dd":  return "dd_cancelled";
    default:    return "lost_lapse";
  }
}
