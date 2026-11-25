#!/usr/bin/env node
/**
 * Load the Call QA standards into qa_rulesets from text exports of the
 * source documents: the Openwork observation form and Openwork's criteria for
 * it, TopQuote's call scripts and the Fact Find sheet.
 *
 *   node --env-file=.env.local scripts/seed-qa-rulesets.mjs <dir> [<dir2> ...]
 *
 * Each file is looked up in the directories in order. Every issued version
 * of a document is kept: a call is checked against the version in force on
 * the day it was made (see loadStandards in src/lib/qa/analyse.ts). To add a
 * new version, export it with scripts/qa-docx-text.py, add a line below with
 * its issue date and run this again. Re-running replaces content in place.
 *
 * The in-between versions were rebuilt from Guy's 4 Nov 2026 marked-up
 * copies with the changes undone: One Call script 21 Oct, Fact Find script
 * 29 Oct, Fact Find sheet 7 Oct. The 6 Oct call guides are retired: from
 * 17 Nov 2026 the checks use the scripts themselves.
 *
 * Documents marked applies: "advice_check" are used only by the advice check
 * (Guy, 22 Nov 2026), not by the call checks: Openwork's Suitable Advice
 * Framework and KYC aide memoire, Openwork's November expectations, Guy's
 * scenario sheet and his instructions for the check. The framework is
 * confidential to the Openwork network: its text stays out of this repo.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: seed-qa-rulesets.mjs <dir> [<dir2> ...]");
  process.exit(1);
}

// applies: "all" = every case; "one_call" / "two_call" = that case type only; "advice_check" = the advice check only.
// datedBy: which call's date picks the version, the fact find (first) or the advice (last).
const FORM = "Openwork ICOBS Competency Assessment Observation Form, telephone sales advice (June 2023 v5)";
const CRITERIA = "Openwork ICOB assessment criteria (v1, April 2026): what each standard on the observation form should consist of";
const VERSIONS = [
  { key: "observation_form", doc: "observation_form", from: "2023-06-01", title: FORM, file: "icob-competency-assessment-observation-form-telephone-sales-v5.txt", source: "icob-competency-assessment-observation-form-telephone-sales-v5.docx", sort: 0, applies: "all", datedBy: "fact_find" },
  // Openwork's criteria for the form, sent by Poz on 19 Nov 2026. Written for face-to-face role plays, with its
  // own numbering: the checks match each criterion to the form standard it covers by subject.
  { doc: "observation_criteria", from: "2026-04-01", title: CRITERIA, file: "observation_criteria_2026-04.txt", source: "openwork-icob-assessment-criteria-document-v1-april-2026.docx", sort: 1, applies: "all", datedBy: "fact_find" },

  { doc: "factfind_script", from: "2026-10-06", title: "TopQuote Fact Find call script, issued 6 Oct 2026", file: "factfind_script_2026-10-06.txt", source: "TopQuote_FactFind_Script_06.10.26.docx", sort: 2, applies: "two_call", datedBy: "fact_find" },
  { doc: "factfind_script", from: "2026-10-29", title: "TopQuote Fact Find call script, issued 29 Oct 2026", file: "factfind_script_2026-10-29.txt", source: "TopQuote_FactFind_Script_04.11.26_TRACKED.docx, 4 Nov changes undone", sort: 2, applies: "two_call", datedBy: "fact_find" },
  { doc: "factfind_script", from: "2026-11-04", title: "TopQuote Fact Find call script, issued 4 Nov 2026", file: "factfind_script_2026-11-04.txt", source: "TopQuote_FactFind_Script_04.11.26_CLEAN.docx", sort: 2, applies: "two_call", datedBy: "fact_find" },
  // Issued 19 Nov 2026 as the "Fact Find call guide": the full script under a new name (Poz, 19 Nov 2026).
  // Brings in the 18 Nov One Call additions (pension incl. state pension, other assets, level of cover,
  // funeral WOL whether or not the client has savings) and adds Life 2 for any partner.
  { doc: "factfind_script", from: "2026-11-19", title: "TopQuote Fact Find call guide (the full call script), issued 19 Nov 2026", file: "factfind_script_2026-11-19.txt", source: "TopQuote_FactFind_Call_Guide_19.11.26.docx", sort: 2, applies: "two_call", datedBy: "fact_find" },
  // Reissued 20 Nov 2026 (Guy's advice check set, 22 Nov): the client is told missing partner details may affect
  // the recommendation (and a partner being covered must be on the advice call), and the same for a declined
  // savings figure, which is recorded with the reason.
  { doc: "factfind_script", from: "2026-11-20", title: "TopQuote Fact Find call guide (the full call script), issued 20 Nov 2026", file: "factfind_script_2026-11-20.txt", source: "TopQuote_FactFind_Call_Guide_20.11.26.docx", sort: 2, applies: "two_call", datedBy: "fact_find" },
  // Reissued 25 Nov 2026 (James Evans): only the wording before the client's details are reconfirmed is new. The
  // other passages highlighted in that copy were already in the 20 Nov issue.
  { doc: "factfind_script", from: "2026-11-25", title: "TopQuote Fact Find call guide (the full call script), issued 25 Nov 2026", file: "factfind_script_2026-11-25.txt", source: "TopQuote_FactFind_Call_Guide_25.11.26_HIGHLIGHTED.docx", sort: 2, applies: "two_call", datedBy: "fact_find" },

  { doc: "onecall_script", from: "2026-10-06", title: "TopQuote Fact Find and Advice call script, one call, issued 6 Oct 2026", file: "onecall_script_2026-10-06.txt", source: "TopQuote_OneCall_Script_06.10.26.docx", sort: 2, applies: "one_call", datedBy: "fact_find" },
  { doc: "onecall_script", from: "2026-10-21", title: "TopQuote Fact Find and Advice call script, one call, issued 21 Oct 2026", file: "onecall_script_2026-10-21.txt", source: "TopQuote_OneCall_Script_04.11.26_TRACKED.docx, 4 Nov changes undone", sort: 2, applies: "one_call", datedBy: "fact_find" },
  { doc: "onecall_script", from: "2026-11-04", title: "TopQuote Fact Find and Advice call script, one call, issued 4 Nov 2026", file: "onecall_script_2026-11-04.txt", source: "TopQuote_OneCall_Script_04.11.26_CLEAN.docx", sort: 2, applies: "one_call", datedBy: "fact_find" },
  // Reissued 18 Nov: the 4 Nov copy was not fully updated (Poz, 18 Nov 2026). Puts back the ID check,
  // privacy notice, accident and sickness and funeral wording; adds pension, assets and level of cover questions.
  { doc: "onecall_script", from: "2026-11-18", title: "TopQuote Fact Find and Advice call script, one call, issued 18 Nov 2026", file: "onecall_script_2026-11-18.txt", source: "TopQuote_OneCall_Script_18.11.26_CLEAN.docx", sort: 2, applies: "one_call", datedBy: "fact_find" },
  // Reissued 20 Nov 2026 as the "One Call guide": the same partner and savings wording as the Fact Find guide,
  // "what would the money be for, and who would be relying on it?", and funeral whole of life offered to clients
  // over 50 whether or not they have savings.
  { doc: "onecall_script", from: "2026-11-20", title: "TopQuote Fact Find and Advice call script (One Call guide), issued 20 Nov 2026", file: "onecall_script_2026-11-20.txt", source: "TopQuote_OneCall_Guide_20.11.26.docx", sort: 2, applies: "one_call", datedBy: "fact_find" },
  // Reissued 25 Nov 2026 (James Evans): the same changes as the Fact Find and Advice guides of that date. It leaves
  // out two things the 20 Nov issue brought in ("what would the money be for", and funeral cover whether or not the
  // client has savings): asked James whether that was meant. Loaded as issued.
  { doc: "onecall_script", from: "2026-11-25", title: "TopQuote Fact Find and Advice call script (One Call guide), issued 25 Nov 2026", file: "onecall_script_2026-11-25.txt", source: "TopQuote_OneCall_Guide_25.11.26_HIGHLIGHTED.docx", sort: 2, applies: "one_call", datedBy: "fact_find" },

  { doc: "advice_script", from: "2026-10-06", title: "TopQuote Advice and Recommendation call script, issued 6 Oct 2026", file: "advice_script_2026-10-06.txt", source: "TopQuote_AdviceCall_Script_06.10.26.docx", sort: 3, applies: "two_call", datedBy: "advice" },
  { doc: "advice_script", from: "2026-11-04", title: "TopQuote Advice and Recommendation call script, issued 4 Nov 2026", file: "advice_script_2026-11-04.txt", source: "TopQuote_AdviceCall_Script_04.11.26_CLEAN.docx", sort: 3, applies: "two_call", datedBy: "advice" },
  // Reissued 25 Nov 2026 as the "Advice Call guide" (James Evans): what term does and doesn't pay is said where there
  // are dependants, and term in place of whole of life is the adviser's recommendation, with the reason in figures
  // (budget, the £15,000 limit or health), not the client's choice.
  { doc: "advice_script", from: "2026-11-25", title: "TopQuote Advice and Recommendation call script (Advice Call guide), issued 25 Nov 2026", file: "advice_script_2026-11-25.txt", source: "TopQuote_AdviceCall_Guide_25.11.26_HIGHLIGHTED.docx", sort: 3, applies: "two_call", datedBy: "advice" },

  { doc: "factfind_sheet", from: "2026-10-07", title: "TopQuote Fact Find sheet (completed by the adviser on the call), issued 7 Oct 2026", file: "factfind_sheet_2026-10-07.txt", source: "TopQuote_FactFind_Sheet_04.11.26_LARGE_PRINT_TRACKED.docx, 4 Nov changes undone", sort: 4, applies: "all", datedBy: "fact_find" },
  // The Word copy still says 7 October in its heading; the issued (printed) sheet says 4 November.
  { doc: "factfind_sheet", from: "2026-11-04", title: "TopQuote Fact Find sheet (completed by the adviser on the call), issued 4 Nov 2026", file: "factfind_sheet_2026-11-04.txt", source: "TopQuote_FactFind_Sheet_04.11.26_LARGE_PRINT_CLEAN.docx", sort: 4, applies: "all", datedBy: "fact_find", relabel: [["7th October 2026", "4th November 2026"]] },
  { doc: "factfind_sheet", from: "2026-11-19", title: "TopQuote Fact Find sheet (completed by the adviser on the call), issued 19 Nov 2026", file: "factfind_sheet_2026-11-19.txt", source: "TopQuote_FactFind_Sheet_19.11.26.docx", sort: 4, applies: "all", datedBy: "fact_find" },
  // Sent to the sellers on 20 Nov 2026 (Poz forwarded it the same day), as a PDF only. The text is the 19 Nov
  // export with the 20 Nov changes made: the client is told missing partner details may affect the
  // recommendation, the property's approximate value, and the client is told that declining to give savings
  // may affect what can be recommended. Guy's Word copy (22 Nov) matches it. The call guides were reissued
  // on 20 Nov too (above).
  { doc: "factfind_sheet", from: "2026-11-20", title: "TopQuote Fact Find sheet (completed by the adviser on the call), issued 20 Nov 2026", file: "factfind_sheet_2026-11-20.txt", source: "TopQuote_FactFind_Sheet_20.11.26_FORMATTED.pdf", sort: 4, applies: "all", datedBy: "fact_find" },

  // The advice check only (Guy, 22 Nov 2026).
  { doc: "advice_framework", from: "2026-05-11", title: "Openwork ICOB Suitable Advice Framework v55 (11 May 2026)", file: "advice_framework_2026-05-11.txt", source: "ICOB Suitable Advice Framework v55 11.05.26.pdf", sort: 5, applies: "advice_check", datedBy: "fact_find" },
  // A scanned blank form with no issue date of its own: dated by the scan. Typed up from the scan once.
  { doc: "kyc_aide_memoire", from: "2026-11-19", title: "Openwork KYC Aide Memoire: the fields Openwork expects captured (scanned copy of 19 Nov 2026)", file: "kyc_aide_memoire_2026-11-19.txt", source: "Openwork KYC Aide Memoire.pdf", sort: 6, applies: "advice_check", datedBy: "fact_find" },
  { doc: "openwork_expectations", from: "2026-11-20", title: "Openwork's stated expectations, November 2026 (Paul Laycock and David Kelly, to 20 Nov 2026)", file: "openwork_expectations_2026-11-20.txt", source: "Openwork expectations November 2026.txt", sort: 7, applies: "advice_check", datedBy: "fact_find" },
  { doc: "adviser_scenarios", from: "2026-11-20", title: "TopQuote adviser scenario sheet: what we can advise on, and what we need to justify it, 20 Nov 2026", file: "adviser_scenarios_2026-11-20.txt", source: "TopQuote_Adviser_Scenarios_20.11.26.docx", sort: 8, applies: "advice_check", datedBy: "fact_find" },
  // Guy's instructions for the check itself: always the latest version, whatever the call date.
  { doc: "advice_check_instructions", from: "2026-11-22", title: "TopQuote advice check and Concert Hub notes assistant, instructions v2.0 (Guy, 22 Nov 2026)", file: "advice_check_instructions_2026-11-22.txt", source: "Assistant instructions v2.txt", sort: 9, applies: "advice_check", datedBy: "fact_find" },
];

// No longer used: the checks read the scripts themselves.
const RETIRED = ["factfind_guide", "advice_guide", "onecall_guide"];

function find(file) {
  const hit = dirs.map((d) => path.join(d, file)).find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`${file} not found in ${dirs.join(", ")}`);
  return hit;
}

for (const v of VERSIONS) {
  let content = fs.readFileSync(find(v.file), "utf8")
    // Tidy the export: non-breaking and zero-width spaces, trailing spaces, blank runs.
    .replace(/ /g, " ").replace(/[​-‍﻿]/g, "")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  for (const [from, to] of v.relabel ?? []) content = content.split(from).join(to);
  const key = v.key ?? `${v.doc}@${v.from}`;
  await sql`
    INSERT INTO qa_rulesets (key, doc, effective_from, dated_by, title, content, source_filename, sort_order, applies_to, updated_by, retired_at)
    VALUES (${key}, ${v.doc}, ${v.from}, ${v.datedBy}, ${v.title}, ${content}, ${v.source}, ${v.sort}, ${v.applies}, 'jimmy', NULL)
    ON CONFLICT (key) DO UPDATE SET doc = EXCLUDED.doc, effective_from = EXCLUDED.effective_from,
      dated_by = EXCLUDED.dated_by, title = EXCLUDED.title, content = EXCLUDED.content,
      source_filename = EXCLUDED.source_filename, sort_order = EXCLUDED.sort_order,
      applies_to = EXCLUDED.applies_to, updated_by = EXCLUDED.updated_by, retired_at = NULL, updated_at = now()`;
  console.log(`${key} (${v.applies}, by ${v.datedBy} call): ${content.length} chars`);
}

const retired = await sql.query(
  `UPDATE qa_rulesets SET retired_at = now(), updated_at = now()
    WHERE key = ANY($1::text[]) AND retired_at IS NULL RETURNING key`, [RETIRED]);
for (const r of retired.rows) console.log(`retired ${r.key}`);
process.exit(0);
