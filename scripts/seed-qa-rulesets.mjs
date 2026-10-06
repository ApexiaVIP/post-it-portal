#!/usr/bin/env node
/**
 * Load the Call QA standards into qa_rulesets from text exports of the
 * source documents (Openwork observation form + TopQuote call guides).
 *
 *   node --env-file=.env.local scripts/seed-qa-rulesets.mjs <dir-with-txt-files>
 *
 * Re-running replaces the content, so it also updates the rulebook when a
 * new version of a form or guide arrives.
 */
import fs from "node:fs";
import path from "node:path";
import { sql } from "@vercel/postgres";

const dir = process.argv[2];
if (!dir) { console.error("usage: seed-qa-rulesets.mjs <dir>"); process.exit(1); }

const SETS = [
  { key: "observation_form", title: "Openwork ICOBS Competency Assessment Observation Form (telephone sales advice)", file: "icob-competency-assessment-observation-form-telephone-sales-v5.txt", sort: 1 },
  { key: "factfind_guide", title: "TopQuote Fact Find Call: Adviser Call Guide", file: "TopQuote_FactFind_Call_Guide_for_Openwork_3.txt", sort: 2 },
  { key: "advice_guide", title: "TopQuote Advice & Recommendation Call: Adviser Call Guide", file: "TopQuote_AdviceCall_Call_Guide_HOUSE_STYLE_A_boxes.txt", sort: 3 },
];

for (const s of SETS) {
  const raw = fs.readFileSync(path.join(dir, s.file), "utf8");
  // Tidy the Word export: drop form-field placeholders and runs of blank lines.
  const content = raw.replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  await sql`
    INSERT INTO qa_rulesets (key, title, content, source_filename, sort_order, updated_by)
    VALUES (${s.key}, ${s.title}, ${content}, ${s.file.replace(/\.txt$/, ".docx")}, ${s.sort}, 'jimmy')
    ON CONFLICT (key) DO UPDATE SET title = EXCLUDED.title, content = EXCLUDED.content,
      source_filename = EXCLUDED.source_filename, sort_order = EXCLUDED.sort_order,
      updated_by = EXCLUDED.updated_by, updated_at = now()`;
  console.log(`${s.key}: ${content.length} chars`);
}
process.exit(0);
