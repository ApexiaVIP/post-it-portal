#!/usr/bin/env node
/**
 * Load the Call QA standards into qa_rulesets from text exports of the
 * source documents (Openwork observation form + TopQuote call guides).
 *
 *   node --env-file=.env.local scripts/seed-qa-rulesets.mjs <dir> [<dir2> ...]
 *
 * Each file is looked up in the directories in order, so a folder of new
 * versions can be listed first and an unchanged document (the observation
 * form) still found in an older folder. Re-running replaces the content,
 * which is how the rulebook is updated when a new form or guide arrives.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";

const dirs = process.argv.slice(2);
if (dirs.length === 0) {
  console.error("usage: seed-qa-rulesets.mjs <dir> [<dir2> ...]");
  process.exit(1);
}

// applies: "all" = every case; "one_call" / "two_call" = that case type only.
const SETS = [
  { key: "observation_form", title: "Openwork ICOBS Competency Assessment Observation Form (telephone sales advice)", file: "icob-competency-assessment-observation-form-telephone-sales-v5.txt", sort: 1, applies: "all" },
  { key: "factfind_guide", title: "TopQuote Fact Find Call: Adviser Call Guide (6 Oct 2026)", file: "TopQuote_FactFind_Call_Guide_06.10.26.txt", sort: 2, applies: "two_call" },
  { key: "advice_guide", title: "TopQuote Advice & Recommendation Call: Adviser Call Guide (6 Oct 2026)", file: "TopQuote_AdviceCall_Call_Guide_06.10.26.txt", sort: 3, applies: "two_call" },
  { key: "onecall_guide", title: "TopQuote Fact Find and Advice Call, one call: Adviser Call Guide (6 Oct 2026)", file: "TopQuote_OneCall_Call_Guide_06.10.26.txt", sort: 4, applies: "one_call" },
];

function find(file) {
  const hit = dirs.map((d) => path.join(d, file)).find((p) => fs.existsSync(p));
  if (!hit) throw new Error(`${file} not found in ${dirs.join(", ")}`);
  return hit;
}

for (const s of SETS) {
  const raw = fs.readFileSync(find(s.file), "utf8");
  // Tidy the Word export: non-breaking spaces, trailing spaces, blank runs.
  const content = raw.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  await sql`
    INSERT INTO qa_rulesets (key, title, content, source_filename, sort_order, applies_to, updated_by)
    VALUES (${s.key}, ${s.title}, ${content}, ${s.file.replace(/\.txt$/, ".docx")}, ${s.sort}, ${s.applies}, 'jimmy')
    ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
      source_filename = EXCLUDED.source_filename, sort_order = EXCLUDED.sort_order,
      applies_to = EXCLUDED.applies_to, updated_by = EXCLUDED.updated_by, updated_at = now()`;
  console.log(`${s.key} (${s.applies}): ${content.length} chars`);
}
process.exit(0);
