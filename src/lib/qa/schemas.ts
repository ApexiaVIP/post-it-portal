/**
 * Output shapes for the Call QA checks (Guy's brief, 6 Oct 2026). Each
 * check returns structured data so the report renders consistently and
 * every finding carries its evidence (call number, timestamp, quote).
 */
import { z } from "zod";

export const Evidence = z.object({
  call: z.number().int().describe("Call number as given in the transcript header"),
  time: z.string().describe("Timestamp from the transcript, e.g. 00:12:34"),
  quote: z.string().describe("Short verbatim quote from the transcript"),
});

export const Label = z.enum(["FACT", "INFERENCE", "NOT_ESTABLISHED"]);

/**
 * Poz, 13 Nov 2026: the check must be fair to the seller. A shortfall that
 * comes from the script (no wording for something the form needs, or the
 * script's own wording falls short) is flagged as a script gap, not counted
 * against the adviser.
 */
const ScriptGap = z.boolean().describe(
  "True when the shortfall traces back to the script in force rather than the adviser: the script gives the adviser nothing to say to the client on the call about this (an \"Adviser:\" note alone, or an instruction to cover it outside the call such as in the follow-up email, does not count), or the adviser followed the script and its wording falls short. False where the script tells the adviser to cover it on the call in their own words, and for every pass.",
);

export const Exception = z.object({
  title: z.string(),
  detail: z.string(),
  severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
  evidence: z.array(Evidence),
});

/** Check 1: the Openwork observation form, numbered. */
export const ObservationOutput = z.object({
  checks: z.array(z.object({
    ref: z.string().describe("Form reference exactly as on the form, e.g. 1.1, 1.3*, 2.1"),
    stage: z.string().describe("Form stage, e.g. Introduction and Disclosure"),
    requirement: z.string(),
    mandatory: z.boolean().describe("True for asterisked standards"),
    result: z.enum(["PASS", "FAIL", "REVIEW_REQUIRED", "NOT_APPLICABLE"]),
    script_gap: ScriptGap,
    finding: z.string().describe("One or two plain-English sentences"),
    evidence: z.array(Evidence),
  })),
  stage_outcomes: z.array(z.object({
    stage: z.string(),
    result: z.enum(["PASS", "FAIL", "REVIEW_REQUIRED"]),
    note: z.string(),
  })),
  exceptions: z.array(Exception),
});

/** Mandatory disclosures: the wording the call script gives the adviser to say. */
export const DisclosureOutput = z.object({
  disclosures: z.array(z.object({
    name: z.string(),
    source: z.string().describe("Script (with its issue date) and section the required wording comes from"),
    form_refs: z.array(z.string()),
    result: z.enum(["DELIVERED_IN_FULL", "PARTIAL", "MISSING", "REVIEW_REQUIRED", "NOT_APPLICABLE"]),
    script_gap: ScriptGap,
    differences: z.string().describe("What was missing or changed; empty if delivered in full"),
    evidence: z.array(Evidence),
  })),
  exceptions: z.array(Exception),
});

export const FACT_CATEGORIES = [
  "CLIENT_AND_FAMILY", "EMPLOYMENT_AND_INCOME", "HEALTH_AND_LIFESTYLE",
  "MORTGAGE_AND_PROPERTY", "OUTGOINGS_AND_LIABILITIES", "SAVINGS_AND_EMERGENCY_FUND",
  "BUDGET", "EXISTING_COVER", "KNOWN_CHANGES", "VULNERABILITY",
  "NEEDS_IDENTIFIED", "ALTERNATIVES_DISCUSSED", "AGREED_BUSINESS", "OTHER",
] as const;

/** Check 2: what the client told us, plus priorities and concerns. */
export const FactsOutput = z.object({
  facts: z.array(z.object({
    category: z.enum(FACT_CATEGORIES),
    item: z.string(),
    label: Label,
    evidence: z.array(Evidence),
  })),
  priorities: z.array(z.object({ text: z.string(), label: Label, evidence: z.array(Evidence) })),
  concerns: z.array(z.object({ text: z.string(), label: Label, evidence: z.array(Evidence) })),
  exceptions: z.array(Exception),
});

/** Check 3: recommendation, rationale and whether it all tells one story. */
export const ConsistencyOutput = z.object({
  recommendations: z.array(z.object({
    product: z.string(),
    provider: z.string(),
    life_assured: z.string(),
    benefit_amount: z.string(),
    term: z.string(),
    premium: z.string(),
    outcome: z.enum(["AGREED", "DECLINED", "DEFERRED", "NOT_ESTABLISHED"]),
    label: Label,
    evidence: z.array(Evidence),
  })),
  rationale: z.array(z.object({ reason: z.string(), label: Label, evidence: z.array(Evidence) })),
  needs_not_addressed: z.array(z.object({
    need: z.string(),
    reason_given: z.string(),
    label: Label,
    evidence: z.array(Evidence),
  })),
  /**
   * Poz, 13 Nov 2026: the adviser recaps the client's priorities and concerns
   * at the end of the fact find, and every one of them is then quoted for,
   * addressed and sold (or declined) on the advice call.
   */
  priorities_followthrough: z.object({
    recap: z.object({
      result: z.enum(["DONE", "PARTIAL", "NOT_DONE", "REVIEW_REQUIRED"]),
      finding: z.string(),
      evidence: z.array(Evidence),
    }).describe("Whether the adviser recapped the client's priorities and concerns at the end of the fact find"),
    items: z.array(z.object({
      text: z.string().describe("The priority or concern in one plain sentence, as the client expressed it"),
      kind: z.enum(["PRIORITY", "CONCERN"]),
      raised: z.array(Evidence).describe("Where the client raised it"),
      recapped: z.enum(["YES", "PARTIAL", "NO", "REVIEW_REQUIRED"]),
      quoted: z.enum(["YES", "NO", "NOT_APPLICABLE", "REVIEW_REQUIRED"]),
      addressed: z.enum(["YES", "PARTIAL", "NO", "REVIEW_REQUIRED"]),
      sold: z.enum(["YES", "DECLINED", "DEFERRED", "NO", "NOT_APPLICABLE", "REVIEW_REQUIRED"]),
      finding: z.string(),
      evidence: z.array(Evidence).describe("Evidence from the advice for how it was quoted, addressed and sold"),
    })),
    result: z.enum(["PASS", "FAIL", "REVIEW_REQUIRED"]),
    summary: z.string(),
  }),
  consistency: z.object({
    result: z.enum(["CONSISTENT", "ISSUES_FOUND", "REVIEW_REQUIRED"]),
    summary: z.string(),
    findings: z.array(z.object({
      issue: z.string(),
      severity: z.enum(["HIGH", "MEDIUM", "LOW"]),
      explanation: z.string(),
      evidence: z.array(Evidence),
    })),
  }),
  exceptions: z.array(Exception),
});

/** Check 4 (Gate 2): the suitability report against the calls, both ways. */
export const SuitabilityOutput = z.object({
  findings: z.array(z.object({
    area: z.enum([
      "CLIENT_CIRCUMSTANCES", "NEEDS", "NEEDS_NOT_ADDRESSED", "RECOMMENDATION",
      "RATIONALE", "REPLACEMENT_BUSINESS", "OTHER",
    ]),
    result: z.enum([
      "MATCHES", "DOES_NOT_MATCH", "IN_REPORT_NOT_SUPPORTED_BY_CALL",
      "ON_CALL_MISSING_FROM_REPORT", "REVIEW_REQUIRED",
    ]),
    report_says: z.string(),
    call_says: z.string(),
    report_location: z.string().describe("Report section or page, e.g. 3. Replacement plans"),
    explanation: z.string(),
    evidence: z.array(Evidence),
  })),
  summary: z.string(),
  exceptions: z.array(Exception),
});

/**
 * The draft suitability report wording (Guy, 20 Nov 2026): written from the
 * calls for the seller to check and use in ConcertHub. It goes to the seller
 * and Pauline only. Where the calls didn't establish something a section
 * needs, the text carries "[To confirm: ...]" and a gap says what to ask.
 */
export const LETTER_SECTIONS = [
  "circumstances", "needs", "budget", "recommendation", "reasons", "not_recommended", "existing_cover",
] as const;
export type LetterSection = (typeof LETTER_SECTIONS)[number];

export const LetterOutput = z.object({
  sections: z.array(z.object({
    key: z.enum(LETTER_SECTIONS),
    text: z.string().describe("The wording for this section, as the adviser writing to the client. Plain paragraphs, with [To confirm: ...] wherever the calls didn't establish what is needed."),
    evidence: z.array(Evidence).describe("The main moments in the calls this section is written from, up to four"),
  })),
  gaps: z.array(z.object({
    section: z.enum(LETTER_SECTIONS),
    missing: z.string().describe("What the section needs that the calls didn't establish, in one plain sentence"),
    ask: z.string().describe("What the adviser should ask or tell the client on the callback, in one plain sentence"),
    callback_point: z.number().int().nullable().describe("The number of the callback point this is part of, or null if it isn't on the callback list"),
  })),
  seller_notes: z.array(z.string()).describe("Anything the adviser must check before using the wording, such as a name or figure the transcript may have misheard. Empty if none."),
});

/**
 * Gate 4 (23 Nov 2026): the seller's advice check against the calls. Each
 * statement it drafted from the sheet is tested against the recording, as
 * Openwork's supervision team will.
 */
export const STATEMENT_RESULTS = ["SUPPORTED", "NOT_ON_CALL", "CONTRADICTED", "REVIEW_REQUIRED"] as const;
export const StatementsOutput = z.object({
  statements: z.array(z.object({
    n: z.number().int().describe("The statement's number as given"),
    result: z.enum(STATEMENT_RESULTS),
    call_says: z.string().describe("What the calls show on this point, in one plain sentence; for SUPPORTED a few words is enough"),
    evidence: z.array(Evidence),
  })),
  missing_from_notes: z.array(z.object({
    item: z.string().describe("What the client said that the sheet and notes leave out, in one plain sentence"),
    evidence: z.array(Evidence),
  })),
  summary: z.string(),
});

export type ObservationResult = z.infer<typeof ObservationOutput>;
export type DisclosureResult = z.infer<typeof DisclosureOutput>;
export type FactsResult = z.infer<typeof FactsOutput>;
export type ConsistencyResult = z.infer<typeof ConsistencyOutput>;
export type SuitabilityResult = z.infer<typeof SuitabilityOutput>;
export type ExceptionItem = z.infer<typeof Exception>;
export type EvidenceItem = z.infer<typeof Evidence>;

export interface Gate1Result {
  observation: ObservationResult;
  disclosures: DisclosureResult;
  facts: FactsResult;
  consistency: ConsistencyResult;
}
export interface Gate2Result {
  suitability: SuitabilityResult;
}
/** A letter run (gate 3): the draft, and the call check it was written alongside. */
export interface LetterResult {
  letter: z.infer<typeof LetterOutput>;
  /** The Gate 1 run whose callback list the gaps are numbered against. */
  from_run: number;
  /** The seller's advice check it was also written from, if one was linked (23 Nov 2026). */
  advice_check?: number;
}
export type StatementsResult = z.infer<typeof StatementsOutput>;
/** A statements run (gate 4): the advice check it tested and what the calls showed. */
export interface StatementsRunResult {
  statements: StatementsResult;
  from_check: number;
}
