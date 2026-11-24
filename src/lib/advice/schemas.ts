/**
 * Output shapes for the advice check (Guy, 22 Nov 2026). The model records
 * each step through a single tool and the result is validated before it is
 * saved, as for the Call QA checks.
 */
import { z } from "zod";
import {
  SCENARIO_ROWS, VERDICTS, FITS, GAP_ITEMS, GAP_STATUS, RED_LINE_KINDS, JUSTIFICATION_KEYS,
} from "./shared";
import { HUB_NEEDS, HUB_NOTE_HOLDS, NEED_OUTCOMES, PROVIDER_REASONS, REPLACE_LOSSES, REPLACE_REASONS } from "./concert-hub";

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
    items: z.array(z.enum(GAP_ITEMS)).describe("The gap check items it settles. Empty for a licence or fit problem, a disclosure under CALL CHECKS, or unused budget"),
    uncovered: z.boolean().describe("True if it is about an identified need the recommendation leaves uncovered, or unused budget"),
  })).describe("Only the absolute red lines, most serious first, normally five or fewer. Empty if there are none"),
  questions: z.array(z.string()).describe("Other questions worth asking on the same call that are not red lines, one short line each, most useful first. Empty if none."),
  not_on_sheet: z.array(z.object({
    statement: z.string().describe("The fact about the client the adviser gave that isn't on the sheet"),
    note: z.string().describe("What the adviser should do: confirm it was said on the recorded call, add it to the sheet and run the check again"),
  })),
  documents_differ: z.array(z.string()).describe("Where the documents differ, or Openwork's stated expectation goes beyond the written framework, as it bears on this case. Empty if none."),
  justification: z.array(z.object({
    key: z.enum(JUSTIFICATION_KEYS),
    text: z.string().describe("One short paragraph in the first person, as the adviser, 60 words at most"),
    cites: z.string().describe("The framework section or Openwork expectation the paragraph answers"),
  })).describe("Part 2. Empty before the advice call, when the case isn't ready and the adviser hasn't asked for the complete parts, or the recommendation doesn't fit."),
  hub: z.object({
    needs: z.array(z.object({
      client: z.string().describe("First name"),
      need: z.enum(HUB_NEEDS),
      outcome: z.enum(NEED_OUTCOMES).describe("MET: identified, and a recommended policy covers this client for it. NOT_MET: identified, and nothing recommended does. COVERED: existing cover or benefits already meet it. NOT_IDENTIFIED: considered and discounted. NOT_ON_SHEET: the sheet doesn't say."),
      met_by: z.string().describe("MET: the policy or policies, as named in policies, e.g. Policy 1. Otherwise empty"),
      pick: z.string().describe("NOT_MET: the Reason Not Addressed option that says the client's reason. Empty if none does, or for any other outcome"),
      why: z.string().describe("What the sheet says, 20 words at most. NOT_MET: the reason this client's need isn't covered. COVERED: what covers it. NOT_IDENTIFIED: the reason. MET: empty, unless only part of the need is met, then what is left. Empty if the sheet doesn't say"),
    })).describe("All seven need areas for each client on the fact find"),
    deferred: z.array(z.object({
      client: z.string().describe("First name"),
      period: z.string().describe("The Deferred Period option for the one the sheet records. Empty if it doesn't record one"),
      why: z.string().describe("What the sheet shows about sick pay, 15 words at most. Empty if nothing"),
    })).describe("One line for each client whose income_sickness need is MET or NOT_MET. Empty if none"),
    policies: z.array(z.object({
      policy: z.string().describe("Policy 1, Policy 2 and so on, as on the sheet"),
      client: z.string().describe("First name of the life covered. Both first names joined with and for a joint life plan"),
      product: z.string().describe("e.g. Life cover, level"),
      amount_pick: z.string().describe("The Benefit Amount option the sheet backs. Empty if it doesn't give the size of the need"),
      amount_why: z.string().describe("Why this sum assured, as the sheet gives it, 25 words at most. Empty if it doesn't"),
      term_pick: z.string().describe("The Product Term option the sheet backs. Empty if it doesn't give when the need ends"),
      term_why: z.string().describe("Why this term, as the sheet gives it, 25 words at most. Empty if it doesn't"),
      trust: z.string().describe("Yes, or No with the reason, as the sheet gives it. 'No, joint life' for a joint life plan. Empty if the sheet doesn't say"),
      extras: z.string().describe("Additional benefits agreed with the client. None where the sheet says there are none. Empty if it doesn't say"),
      provider: z.string().describe("The provider, if the sheet names it. Otherwise empty"),
      provider_reasons: z.array(z.enum(PROVIDER_REASONS)).describe("The provider reasons to switch to Yes. Only those the sheet gives. Empty if it gives none"),
      provider_why: z.string().describe("Anything the sheet adds about why this provider, 20 words at most. Otherwise empty"),
    })).describe("One line for each recommended policy and life"),
    replacements: z.array(z.object({
      policy: z.string().describe("The existing policy being replaced: whose, provider, type, sum assured and remaining term. No policy number"),
      still_suitable: z.enum(["YES", "NO", "NOT_ON_SHEET"]).describe("Does the existing plan remain suitable to meet the identified need?"),
      reasons: z.array(z.enum(REPLACE_REASONS)).describe("Why it is suitable to replace. Only those the sheet shows"),
      facilitate: z.enum(["YES", "NO", "NOT_ON_SHEET"]).describe("Does the existing plan have any features that could be used to make the change instead?"),
      losses: z.array(z.enum(REPLACE_LOSSES)).describe("Consequences of replacing it. none only where the sheet says nothing is lost. Empty if the sheet doesn't say"),
      outweigh: z.string().describe("Why the benefits outweigh the disadvantages, first person, two sentences at most, ready to paste. Empty if the sheet doesn't show it"),
    })).describe("One line for each existing policy being replaced. Empty if none"),
    notes: z.object({
      needs: z.string().describe(`80 words at most, so leave things out. ${HUB_NOTE_HOLDS.needs}`),
      outgoings: z.string().describe(`60 words at most, so leave things out. ${HUB_NOTE_HOLDS.outgoings}`),
      recommendation: z.string().describe(`180 words at most, plus 40 for each policy after the second, so leave things out. ${HUB_NOTE_HOLDS.recommendation}`),
    }).describe("The three notes, first person, short plain factual sentences, ready to paste"),
    budget: z.object({
      agreed: z.string().describe("The monthly budget the client gave, with the £ sign. Empty if the sheet doesn't say"),
      premiums: z.string().describe("The monthly premiums recommended, added up, with the £ sign"),
      unused_why: z.string().describe("If the premiums come to less than the budget: why the rest wasn't used, as the sheet shows it. It has to account for every need that is NOT_MET. Empty if the sheet doesn't say, or nothing is left"),
    }),
  }).describe("Part 3, the Concert Hub page. Every list empty in the same cases as Part 2."),
  statements: z.array(z.object({
    n: z.number().int(),
    text: z.string().describe("One factual statement from Parts 2 and 3"),
    where: z.string().describe("Where on the sheet it comes from (section and field), or \"recommendation field\""),
    from_adviser: z.boolean().describe("True if it came only from the recommendation and reasons field rather than the sheet"),
  })).describe("Part 4: every factual statement in Parts 2 and 3, numbered from 1. Empty when Parts 2 and 3 are."),
});
