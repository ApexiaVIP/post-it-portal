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

/** Mandatory disclosures: the SAY AS WRITTEN passages in the call guides. */
export const DisclosureOutput = z.object({
  disclosures: z.array(z.object({
    name: z.string(),
    source: z.string().describe("Guide and section the required wording comes from"),
    form_refs: z.array(z.string()),
    result: z.enum(["DELIVERED_IN_FULL", "PARTIAL", "MISSING", "REVIEW_REQUIRED", "NOT_APPLICABLE"]),
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
