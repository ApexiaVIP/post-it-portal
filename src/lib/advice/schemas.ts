/**
 * Output shapes for the advice check (Guy, 22 Nov 2026). The model records
 * each step through a single tool and the result is validated before it is
 * saved, as for the Call QA checks.
 */
import { z } from "zod";
import {
  SCENARIO_ROWS, VERDICTS, FITS, GAP_ITEMS, GAP_STATUS, RED_LINE_KINDS, JUSTIFICATION_KEYS, NOTE_KEYS,
} from "./shared";

/** Step 1: the uploaded pages of the Fact Find sheet, written out. */
export const SheetOutput = z.object({
  text: z.string().describe("Everything filled in on the sheet, section by section in the sheet's order, each answer with its question or field."),
  unclear: z.array(z.string()).describe("Anything that couldn't be read with confidence, one line each, saying where on the sheet it is. Empty if none."),
});

/** Step 2: Parts 0 to 4 of Guy's instructions. */
export const AdviceCheckOutput = z.object({
  part0: z.object({
    rows: z.array(z.enum(SCENARIO_ROWS)).describe("The scenario sheet rows this case matches, the main one first. Empty if it fits none."),
    verdict: z.enum(VERDICTS).describe("CAN_ADVISE: within licence. CAN_ADVISE_IF: within licence if the row's conditions are met (say which in summary). SPEAK_TO_GUY: the retired couple row, a case that fits no row, or anything else the instructions send to Guy. CANNOT_ADVISE: outside the licence, for example a legacy need for term cover."),
    summary: z.string().describe("One or two lines: which row this is and what it means for this case"),
    speak_to_guy: z.boolean().describe("True whenever the adviser must speak to Guy before presenting, including every time the retired couple row applies"),
    recommendation: z.array(z.object({
      policy: z.string().describe("Which policy on the sheet, e.g. Policy 1"),
      lives: z.string().describe("First name(s) of who it covers"),
      product: z.string().describe("e.g. Life cover, decreasing; Critical illness, level; Whole of life"),
      sum_assured: z.string().describe("As written, with the £ sign. Not given if blank"),
      term: z.string().describe("As written, e.g. 24 years. Not given if blank"),
      premium: z.string().describe("As written, with the £ sign. Not given if blank"),
      other: z.string().describe("Guaranteed or reviewable, extras, joint or single life, trust, as given. Empty if none"),
    })).describe("What the adviser recommends, one line for each policy and life, from the policy pages and the recommendation and reasons field. Empty if no recommendation is given"),
    fit: z.object({
      result: z.enum(FITS),
      explanation: z.string().describe("One or two short sentences: whether the recommendation fits the framework, the licence and the scenario sheet, and if not, why not in a few words"),
    }),
  }),
  gaps: z.array(z.object({
    item: z.enum(GAP_ITEMS),
    status: z.enum(GAP_STATUS),
    detail: z.string().describe("What the sheet shows, or what to ask. One short line, 20 words at most."),
    source: z.string().describe("The standard the item answers, e.g. SAF 4.1; Openwork 20 Nov"),
  })).describe("Every gap check item exactly once, in the order given"),
  red_lines: z.array(z.object({
    action: z.string().describe("The one thing to do, plain and specific to this client. 25 words at most, no section numbers"),
    kind: z.enum(RED_LINE_KINDS),
    items: z.array(z.enum(GAP_ITEMS)).describe("The gap check items it settles. Empty for a licence or fit problem, or a disclosure under CALL CHECKS"),
  })).describe("Only the absolute red lines, most serious first, normally five or fewer. Empty if there are none"),
  questions: z.array(z.string()).describe("Other questions worth asking on the same call that are not red lines, one short line each, most useful first. Empty if none."),
  not_on_sheet: z.array(z.object({
    statement: z.string().describe("The fact about the client the adviser gave that isn't on the sheet"),
    note: z.string().describe("What the adviser should do: confirm it was said on the recorded call, add it to the sheet and run the check again"),
  })),
  documents_differ: z.array(z.string()).describe("Where the documents differ, or Openwork's stated expectation goes beyond the written framework, as it bears on this case. Empty if none."),
  justification: z.array(z.object({
    key: z.enum(JUSTIFICATION_KEYS),
    text: z.string().describe("One short paragraph in the first person, as the adviser"),
    cites: z.string().describe("The framework section or Openwork expectation the paragraph answers"),
  })).describe("Part 2. Empty before the advice call, when the case isn't ready and the adviser hasn't asked for the complete parts, or the recommendation doesn't fit."),
  notes: z.array(z.object({
    key: z.enum(NOTE_KEYS),
    text: z.string().describe("The note for this Concert Hub heading, first person, short plain factual sentences"),
  })).describe("Part 3, under the Concert Hub headings. Empty in the same cases as Part 2."),
  dropdown_tips: z.array(z.string()).describe("Where a Concert Hub drop-down doesn't fit, which one, telling the adviser to pick Other and rely on the note. Empty if none."),
  statements: z.array(z.object({
    n: z.number().int(),
    text: z.string().describe("One factual statement from Parts 2 and 3"),
    where: z.string().describe("Where on the sheet it comes from (section and field), or \"recommendation field\""),
    from_adviser: z.boolean().describe("True if it came only from the recommendation and reasons field rather than the sheet"),
  })).describe("Part 4: every factual statement in Parts 2 and 3, numbered from 1. Empty when Parts 2 and 3 are."),
});
