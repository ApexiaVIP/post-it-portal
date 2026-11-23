/**
 * The documents the advice check works from (Guy, 22 Nov 2026), from
 * qa_rulesets: the eight Guy put in the Project knowledge, each in the
 * version in force on the date of the fact find call, and his instructions
 * for the check, always the latest version.
 */
import { sql } from "@vercel/postgres";
import type { CaseType } from "@/lib/qa/shared";
import type { StandardUsed } from "@/lib/qa/analyse";

const COMMON = [
  "advice_framework", "kyc_aide_memoire", "observation_form", "observation_criteria",
  "factfind_sheet", "adviser_scenarios", "openwork_expectations",
];
/** The call guide that goes with the case type (Guy's set has the Fact Find and One Call guides). */
const GUIDE: Record<CaseType, string> = { two_call: "factfind_script", one_call: "onecall_script" };
const INSTRUCTIONS = "advice_check_instructions";

export interface AdviceStandards {
  /** Guy's instructions for the check. */
  instructions: string;
  /** The reference documents, each wrapped in a <standard> tag. */
  text: string;
  /** The blank Fact Find sheet in force, for reading the seller's pages against. */
  blankSheet: string | null;
  used: StandardUsed[];
}

export async function loadAdviceStandards(caseType: CaseType, factFindDate: string): Promise<AdviceStandards> {
  const docs = [...COMMON, GUIDE[caseType], INSTRUCTIONS];
  const r = await sql.query<{ doc: string; title: string; content: string; effective_from: string }>(
    `SELECT doc, title, content, effective_from::text AS effective_from
       FROM qa_rulesets
      WHERE retired_at IS NULL AND doc = ANY($1::text[])
      ORDER BY sort_order, doc, effective_from`, [docs],
  );
  const byDoc = new Map<string, typeof r.rows>();
  for (const row of r.rows) byDoc.set(row.doc, [...(byDoc.get(row.doc) ?? []), row]);

  const instr = byDoc.get(INSTRUCTIONS);
  if (!instr?.length) throw new Error("The advice check instructions have not been loaded yet.");
  const missing = docs.filter((d) => !byDoc.has(d));
  if (missing.length) throw new Error(`These documents for the advice check have not been loaded yet: ${missing.join(", ")}.`);

  const instructions = instr[instr.length - 1];
  const used: StandardUsed[] = [{ doc: instructions.doc, title: instructions.title, effective_from: instructions.effective_from, call_date: null }];
  const blocks: string[] = [];
  let blankSheet: string | null = null;
  for (const [doc, versions] of Array.from(byDoc.entries())) {
    if (doc === INSTRUCTIONS) continue;
    // A call before the earliest version on file uses that earliest one.
    const inForce = versions.filter((v) => v.effective_from <= factFindDate);
    const v = inForce[inForce.length - 1] ?? versions[0];
    used.push({ doc: v.doc, title: v.title, effective_from: v.effective_from, call_date: factFindDate });
    if (doc === "factfind_sheet") blankSheet = v.content;
    blocks.push(`<standard doc="${v.doc}" title="${v.title}" in_force_from="${v.effective_from}">\n${v.content}\n</standard>`);
  }
  return {
    instructions: instructions.content,
    text: `Each document below is the version in force on the date of the fact find call (${factFindDate}).\n\n${blocks.join("\n\n")}`,
    blankSheet,
    used,
  };
}
