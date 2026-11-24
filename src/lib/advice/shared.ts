/**
 * Advice check (Guy, 22 Nov 2026): labels, types and helpers safe to use in
 * the browser. The check itself is in lib/advice/run.ts.
 *
 * Guy's instructions produce five parts: Part 0, can this advice be given
 * (matched to his scenario sheet); Part 1, the gap check; Part 2, the
 * justification of the advice; Part 3, the Concert Hub page
 * (concert-hub.ts); Part 4, every statement in Parts 2 and 3 with where it
 * came from, for the check against the recording.
 */
import { hubGaps, type HubPage } from "./concert-hub";

export const SCENARIO_ROWS = [
  "working_to_retirement", "working_past_retirement", "retired_couple", "funeral_over_50",
  "legacy", "replacing_cover", "details_missing",
] as const;
export type ScenarioRow = (typeof SCENARIO_ROWS)[number];

/** The rows of Guy's scenario sheet of 20 Nov 2026, as his instructions name them. */
export const SCENARIO_LABEL: Record<ScenarioRow, string> = {
  working_to_retirement: "Working client, cover to retirement age, lump sum for dependants",
  working_past_retirement: "Working client, cover past retirement",
  retired_couple: "Retired couple, modest lump sum for the survivor",
  funeral_over_50: "Funeral costs, client over 50",
  legacy: "Money for adult children or others who are not financially dependent",
  replacing_cover: "Replacing cover that is about to end",
  details_missing: "Partner's details not obtained, or the client declined savings or pension figures",
};

export const VERDICTS = ["CAN_ADVISE", "CAN_ADVISE_IF", "SPEAK_TO_GUY", "CANNOT_ADVISE"] as const;
export type Verdict = (typeof VERDICTS)[number];
export const VERDICT_LABEL: Record<Verdict, string> = {
  CAN_ADVISE: "Within our licence",
  CAN_ADVISE_IF: "Within our licence, if the conditions are met",
  SPEAK_TO_GUY: "Speak to Guy first",
  CANNOT_ADVISE: "Not within our licence",
};

export const FITS = ["FITS", "DOES_NOT_FIT", "CANNOT_TELL"] as const;
export type Fit = (typeof FITS)[number];

/** The gap check items, in the order of Guy's instructions. */
export const GAP_ITEMS = [
  "joint_fact_find", "dependants", "income_outgoings", "employment_benefits", "retirement", "survivor",
  "assets", "existing_cover", "need_in_words", "needs_priorities", "budget", "sum_assured", "term",
  "lifelong_need", "trust", "cheaper_options", "declined", "vulnerability", "health",
] as const;
export type GapItem = (typeof GAP_ITEMS)[number];
export const GAP_LABEL: Record<GapItem, string> = {
  joint_fact_find: "Joint fact find where there is a partner, or the reason not",
  dependants: "Each dependant, the type of dependency and how long it lasts",
  income_outgoings: "Income and outgoings, disposable income, and where any surplus goes",
  employment_benefits: "Employment benefits: sick pay, death in service, pension scheme",
  retirement: "Retirement age, and pensions and affordability where cover runs past it",
  survivor: "The survivor's position on each death",
  assets: "Savings, investments, property value, other assets, liabilities and emergency fund",
  existing_cover: "Existing cover: what is kept, what is replaced and why",
  need_in_words: "What the money is for, who relies on it and until when, in the client's words",
  needs_priorities: "Needs and priorities, short-term needs first",
  budget: "Budget: the figure, how it was set, agreement if the premium is above it",
  sum_assured: "Sum assured: the reason, tied to the need",
  term: "Term: the reason, tied to when the need ends",
  lifelong_need: "A need with no fixed end: whole of life illustration, decision and referral",
  trust: "Trust for single life plans",
  cheaper_options: "Cheaper options discussed",
  declined: "Anything the client declined to share",
  vulnerability: "Signs of vulnerability and how they were handled",
  health: "Health information to check against the application answers",
};

/**
 * The red lines (Jimmy, Guy and Poz, 24 Nov 2026: pick out the absolute
 * priorities, don't list everything). The check works them out for each case.
 * These few, the need, the options and the reasons Openwork has failed cases
 * on, are always red lines when missing, so they can't be left off.
 */
export const ALWAYS_RED: readonly GapItem[] = ["need_in_words", "dependants", "lifelong_need", "sum_assured", "term"];
export const RED_LINE_KINDS = ["ASK_CLIENT", "FIX_SHEET", "SPEAK_TO_GUY"] as const;
export type RedLineKind = (typeof RED_LINE_KINDS)[number];
export const RED_LINE_KIND_LABEL: Record<RedLineKind, string> = {
  ASK_CLIENT: "Ask the client",
  FIX_SHEET: "Put it on the sheet",
  SPEAK_TO_GUY: "Speak to Guy",
};

/**
 * A two call case is checked before the advice call (can we advise, and the
 * red lines) and again after it, for the Concert Hub page and justification.
 * A one call case has had its advice, so it gets everything at once.
 */
export type Stage = "before_advice" | "after_advice";
export function stageOf(c: { case_type: string; presented: boolean }): Stage {
  return c.case_type === "two_call" && !c.presented ? "before_advice" : "after_advice";
}

export const GAP_STATUS = ["RECORDED", "MISSING", "CLIENT_DECLINED", "ON_ADVICE_CALL", "NOT_APPLICABLE"] as const;
export type GapStatus = (typeof GAP_STATUS)[number];
export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  RECORDED: "Recorded",
  MISSING: "Missing",
  CLIENT_DECLINED: "Client declined",
  ON_ADVICE_CALL: "For the advice call",
  NOT_APPLICABLE: "Doesn't apply",
};

/** Part 2, in Guy's order. */
export const JUSTIFICATION_KEYS = [
  "circumstances", "need", "options", "recommendation", "affordability", "needs_not_met", "replacement",
] as const;
export type JustificationKey = (typeof JUSTIFICATION_KEYS)[number];
export const JUSTIFICATION_HEADING: Record<JustificationKey, string> = {
  circumstances: "Circumstances",
  need: "Need",
  options: "Options considered",
  recommendation: "Recommendation",
  affordability: "Affordability",
  needs_not_met: "Needs not met",
  replacement: "Replacement",
};

export interface AdviceCheckResult {
  stage?: Stage;
  part0: {
    rows: ScenarioRow[];
    verdict: Verdict;
    summary: string;
    speak_to_guy: boolean;
    recommendation: { policy: string; lives: string; product: string; sum_assured: string; term: string; premium: string; other: string }[];
    fit: { result: Fit; explanation: string };
  };
  gaps: { item: GapItem; status: GapStatus; detail: string; source: string }[];
  red_lines: { action: string; kind: RedLineKind; items: GapItem[] }[];
  questions: string[];
  not_on_sheet: { statement: string; note: string }[];
  documents_differ: string[];
  justification: { key: JustificationKey; text: string; cites: string }[];
  /** Part 3, after the advice call. */
  hub: HubPage;
  statements: { n: number; text: string; where: string; from_adviser: boolean }[];
}

export type CheckStatus = "draft" | "running" | "done" | "failed";

/** Guy's closing line, added to every check by the portal. */
export const CLOSING_LINE = "This is a checking and drafting aid. The adviser is responsible for the advice and the record. Standards: ICOB SAF (current version), Openwork's feedback to TopQuote of 17th to 20th November 2026, ICOBS 5.3 and the Consumer Duty. Where the retired couple row applies, speak to Guy before recommending term cover.";

export type Readiness = "doesnt_fit" | "speak_to_guy" | "no_recommendation" | "unclear" | "red_lines" | "missing" | "confirm" | "ready";

export interface CheckSummary {
  readiness: Readiness;
  redLines: number;
  /** Missing, but not a red line. */
  smaller: number;
  /** On the Concert Hub page, but not backed by the sheet. */
  onPage: number;
  missing: number;
  declined: number;
  notOnSheet: number;
  label: string;
}

/** One line for a finished check: what the seller does next. */
export function summarise(r: AdviceCheckResult | null | undefined): CheckSummary | null {
  if (!r?.part0 || !Array.isArray(r.gaps)) return null;
  const missing = r.gaps.filter((g) => g.status === "MISSING").length;
  const redLines = (r.red_lines ?? []).length;
  const covered = new Set((r.red_lines ?? []).flatMap((x) => x.items));
  const smaller = r.gaps.filter((g) => g.status === "MISSING" && !covered.has(g.item)).length;
  const declined = r.gaps.filter((g) => g.status === "CLIENT_DECLINED").length;
  const notOnSheet = (r.not_on_sheet ?? []).length;
  const onPage = hubGaps(r.hub);
  const gaps = smaller + onPage;
  const readiness: Readiness =
    r.part0.fit?.result === "DOES_NOT_FIT" ? "doesnt_fit"
    : r.part0.speak_to_guy || r.part0.verdict === "SPEAK_TO_GUY" || r.part0.verdict === "CANNOT_ADVISE" ? "speak_to_guy"
    : r.part0.recommendation?.length === 0 ? "no_recommendation"
    : redLines > 0 ? "red_lines"
    : r.part0.fit?.result === "CANNOT_TELL" ? "unclear"
    : missing > 0 || onPage > 0 ? "missing"
    : notOnSheet > 0 ? "confirm"
    : "ready";
  const label =
    readiness === "doesnt_fit" ? "Recommendation doesn't fit"
    : readiness === "speak_to_guy" ? (r.part0.verdict === "CANNOT_ADVISE" ? "Not within our licence" : "Speak to Guy first")
    : readiness === "no_recommendation" ? "No recommendation on the sheet"
    : readiness === "unclear" ? "Recommendation not clear"
    : readiness === "red_lines" ? `${redLines} red line${redLines === 1 ? "" : "s"}`
    : readiness === "missing" ? `No red lines, ${gaps} smaller gap${gaps === 1 ? "" : "s"}`
    : readiness === "confirm" ? `Confirm ${notOnSheet} point${notOnSheet === 1 ? "" : "s"}`
    : r.stage === "before_advice" ? "Ready for the advice call" : "Ready";
  return { readiness, redLines, smaller, onPage, missing, declined, notOnSheet, label };
}

export const READINESS_STYLE: Record<Readiness, string> = {
  doesnt_fit: "bg-red-100 text-red-800",
  speak_to_guy: "bg-red-100 text-red-800",
  no_recommendation: "bg-amber-100 text-amber-900",
  unclear: "bg-amber-100 text-amber-900",
  red_lines: "bg-red-100 text-red-800",
  missing: "bg-amber-100 text-amber-900",
  confirm: "bg-amber-100 text-amber-900",
  ready: "bg-emerald-100 text-emerald-800",
};

/** What the reading of the photos wasn't sure of, for the seller to type in. */
export function unreadable(sheetText: string | null): string[] {
  if (!sheetText?.startsWith("READ FROM THE ADVISER'S PHOTOS")) return [];
  const read = sheetText.split("\n\nTYPED BY THE ADVISER")[0];
  const block = read.split("\n\nNOT READ WITH CONFIDENCE\n")[1];
  return block ? block.split("\n").map((l) => l.replace(/^- /, "").trim()).filter(Boolean) : [];
}

/** Part 2 as plain text, for copying. */
export function justificationText(r: AdviceCheckResult): string {
  return [...r.justification]
    .sort((a, b) => JUSTIFICATION_KEYS.indexOf(a.key) - JUSTIFICATION_KEYS.indexOf(b.key))
    .map((j) => `${JUSTIFICATION_HEADING[j.key].toUpperCase()}\n${j.text.trim()}${j.cites ? ` (${j.cites})` : ""}`)
    .join("\n\n");
}
