/**
 * Reviewer sign-off rules, shared by the case page and the API so both
 * agree on what can be reviewed and how agreement is scored.
 *
 * Reviewable items: each Openwork observation standard and each
 * mandatory disclosure (Gate 1), and each suitability finding (Gate 2).
 * Items are keyed by position within their run's result, so a re-run
 * starts a fresh review.
 */
import type { Gate1Result, Gate2Result } from "./schemas";

export type ReviewSection = "observation" | "disclosure" | "suitability";

export interface ReviewableItem {
  key: string;
  section: ReviewSection;
  ref: string | null;
  label: string;
  mandatory: boolean;
  aiResult: string;
}

export const CONFIRM_OPTIONS: Record<ReviewSection, string[]> = {
  observation: ["PASS", "FAIL", "NOT_APPLICABLE"],
  disclosure: ["DELIVERED_IN_FULL", "PARTIAL", "MISSING", "NOT_APPLICABLE"],
  suitability: ["OK", "ISSUE"],
};

export const CONFIRM_LABELS: Record<string, string> = {
  PASS: "Pass", FAIL: "Fail", NOT_APPLICABLE: "N/A",
  DELIVERED_IN_FULL: "In full", PARTIAL: "Partial", MISSING: "Missing",
  OK: "OK", ISSUE: "Issue",
};

export function gate1Items(r: Partial<Gate1Result> | null): ReviewableItem[] {
  const out: ReviewableItem[] = [];
  (r?.observation?.checks ?? []).forEach((c, i) => out.push({
    key: `obs:${i}`, section: "observation", ref: c.ref, label: c.requirement,
    mandatory: c.mandatory, aiResult: c.result,
  }));
  (r?.disclosures?.disclosures ?? []).forEach((d, i) => out.push({
    key: `disc:${i}`, section: "disclosure", ref: d.form_refs.join(", ") || null, label: d.name,
    mandatory: false, aiResult: d.result,
  }));
  return out;
}

export function gate2Items(r: Partial<Gate2Result> | null): ReviewableItem[] {
  return (r?.suitability?.findings ?? []).map((f, i) => ({
    key: `suit:${i}`, section: "suitability" as const, ref: f.area, label: f.report_location || f.area,
    mandatory: false, aiResult: f.result,
  }));
}

/** The AI's result expressed in the reviewer's options, or null if the AI asked for review. */
export function aiAsConfirmed(section: ReviewSection, aiResult: string): string | null {
  if (aiResult === "REVIEW_REQUIRED") return null;
  if (section === "suitability") return aiResult === "MATCHES" ? "OK" : "ISSUE";
  return aiResult;
}

/** "agree" / "disagree" when the AI gave a verdict; "resolved" when it asked for review. */
export function agreement(section: ReviewSection, aiResult: string, confirmed: string): "agree" | "disagree" | "resolved" {
  const ai = aiAsConfirmed(section, aiResult);
  if (ai === null) return "resolved";
  return ai === confirmed ? "agree" : "disagree";
}
