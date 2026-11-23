/**
 * Advice check (Guy, 22 Nov 2026): labels, types and helpers safe to use in
 * the browser. The check itself is in lib/advice/run.ts.
 *
 * Guy's instructions produce five parts: Part 0, can this advice be given
 * (matched to his scenario sheet); Part 1, the gap check; Part 2, the
 * justification of the advice; Part 3, the Concert Hub notes; Part 4, every
 * statement in Parts 2 and 3 with where it came from, for the check against
 * the recording.
 */

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

export const GAP_STATUS = ["RECORDED", "MISSING", "CLIENT_DECLINED", "NOT_APPLICABLE"] as const;
export type GapStatus = (typeof GAP_STATUS)[number];
export const GAP_STATUS_LABEL: Record<GapStatus, string> = {
  RECORDED: "Recorded",
  MISSING: "Missing",
  CLIENT_DECLINED: "Client declined",
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

/** Part 3: the Concert Hub headings, in Guy's order. */
export const NOTE_KEYS = ["circumstances", "needs", "budget", "recommendation", "options", "decision", "not_met"] as const;
export type NoteKey = (typeof NOTE_KEYS)[number];
export const NOTE_HEADING: Record<NoteKey, string> = {
  circumstances: "Client circumstances",
  needs: "Needs and priorities (client's words)",
  budget: "Budget",
  recommendation: "Recommendation and reasons (product, sum assured, term, trust)",
  options: "Options considered and why not recommended (with the quoted premiums)",
  decision: "Client's decision and reasons",
  not_met: "Needs not met and follow up",
};

export interface AdviceCheckResult {
  part0: {
    rows: ScenarioRow[];
    verdict: Verdict;
    summary: string;
    speak_to_guy: boolean;
    fit: { result: Fit; explanation: string };
  };
  gaps: { item: GapItem; status: GapStatus; detail: string; source: string }[];
  questions: string[];
  not_on_sheet: { statement: string; note: string }[];
  documents_differ: string[];
  justification: { key: JustificationKey; text: string; cites: string }[];
  notes: { key: NoteKey; text: string }[];
  dropdown_tips: string[];
  statements: { n: number; text: string; where: string; from_adviser: boolean }[];
}

export type CheckStatus = "draft" | "running" | "done" | "failed";

/** Guy's closing line, added to every check by the portal. */
export const CLOSING_LINE = "This is a checking and drafting aid. The adviser is responsible for the advice and the record. Standards: ICOB SAF (current version), Openwork's feedback to TopQuote of 17th to 20th November 2026, ICOBS 5.3 and the Consumer Duty. Where the retired couple row applies, speak to Guy before recommending term cover.";

export type Readiness = "doesnt_fit" | "speak_to_guy" | "missing" | "confirm" | "ready";

export interface CheckSummary {
  readiness: Readiness;
  missing: number;
  declined: number;
  notOnSheet: number;
  label: string;
}

/** One line for a finished check: what the seller does next. */
export function summarise(r: AdviceCheckResult | null | undefined): CheckSummary | null {
  if (!r?.part0 || !Array.isArray(r.gaps)) return null;
  const missing = r.gaps.filter((g) => g.status === "MISSING").length;
  const declined = r.gaps.filter((g) => g.status === "CLIENT_DECLINED").length;
  const notOnSheet = (r.not_on_sheet ?? []).length;
  const readiness: Readiness =
    r.part0.fit?.result === "DOES_NOT_FIT" ? "doesnt_fit"
    : r.part0.speak_to_guy || r.part0.verdict === "SPEAK_TO_GUY" || r.part0.verdict === "CANNOT_ADVISE" ? "speak_to_guy"
    : missing > 0 ? "missing"
    : notOnSheet > 0 ? "confirm"
    : "ready";
  const label =
    readiness === "doesnt_fit" ? "Recommendation doesn't fit"
    : readiness === "speak_to_guy" ? (r.part0.verdict === "CANNOT_ADVISE" ? "Not within our licence" : "Speak to Guy first")
    : readiness === "missing" ? `Not ready: ${missing} missing`
    : readiness === "confirm" ? `Confirm ${notOnSheet} point${notOnSheet === 1 ? "" : "s"}`
    : "Ready";
  return { readiness, missing, declined, notOnSheet, label };
}

export const READINESS_STYLE: Record<Readiness, string> = {
  doesnt_fit: "bg-red-100 text-red-800",
  speak_to_guy: "bg-red-100 text-red-800",
  missing: "bg-amber-100 text-amber-900",
  confirm: "bg-amber-100 text-amber-900",
  ready: "bg-emerald-100 text-emerald-800",
};

/** Part 2 as plain text, for copying. */
export function justificationText(r: AdviceCheckResult): string {
  return [...r.justification]
    .sort((a, b) => JUSTIFICATION_KEYS.indexOf(a.key) - JUSTIFICATION_KEYS.indexOf(b.key))
    .map((j) => `${JUSTIFICATION_HEADING[j.key].toUpperCase()}\n${j.text.trim()}${j.cites ? ` (${j.cites})` : ""}`)
    .join("\n\n");
}

/** Part 3 as plain text, for copying into Concert Hub. */
export function notesText(r: AdviceCheckResult): string {
  return [...r.notes]
    .sort((a, b) => NOTE_KEYS.indexOf(a.key) - NOTE_KEYS.indexOf(b.key))
    .map((n) => `${NOTE_HEADING[n.key].toUpperCase()}\n${n.text.trim()}`)
    .join("\n\n");
}
