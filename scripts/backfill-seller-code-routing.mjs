#!/usr/bin/env node
/**
 * Walk every clawback case and re-assign adviser_id + agent_bucket using
 * the new authoritative seller-code lookup. If a case's agent_no matches
 * one of any adviser's seller_codes, that adviser owns the case (bucket
 * = 'adviser'). Cases whose agent_no doesn't match any adviser are left
 * alone -- they keep whatever bucketing the name-based matcher had
 * given them.
 *
 *   node --env-file=.env.local scripts/backfill-seller-code-routing.mjs
 */
import { sql } from "@vercel/postgres";

console.log("Fetching adviser roster + seller codes...");
const advisersR = await sql`SELECT id, name, seller_codes FROM advisers ORDER BY id`;
const codeToAdviser = new Map();
for (const a of advisersR.rows) {
  for (const c of (a.seller_codes ?? [])) {
    codeToAdviser.set(c, { id: a.id, name: a.name });
  }
}
console.log(`  ${codeToAdviser.size} seller code(s) across ${advisersR.rowCount} adviser(s).`);
for (const [c, a] of codeToAdviser) console.log(`  ${c} -> ${a.name} (id=${a.id})`);

console.log("\nFetching cases...");
const casesR = await sql`
  SELECT id, agent_no, ebah_agent_name, adviser_id, agent_bucket
  FROM clawback_cases
  WHERE agent_no IS NOT NULL
`;
console.log(`  ${casesR.rowCount} cases with an agent_no on file.`);

let changed = 0, alreadyCorrect = 0, noMatch = 0;
for (const c of casesR.rows) {
  const target = codeToAdviser.get(c.agent_no);
  if (!target) {
    noMatch++;
    continue;
  }
  if (c.adviser_id === target.id && c.agent_bucket === "adviser") {
    alreadyCorrect++;
    continue;
  }
  await sql`
    UPDATE clawback_cases
    SET adviser_id = ${target.id}, agent_bucket = 'adviser', updated_at = now()
    WHERE id = ${c.id}
  `;
  changed++;
}

console.log(`\nResults:`);
console.log(`  Re-routed:        ${changed}`);
console.log(`  Already correct:  ${alreadyCorrect}`);
console.log(`  No code match:    ${noMatch}  (kept their existing name-based bucket)`);

// Per-adviser summary so we can sanity-check
const summary = await sql`
  SELECT a.name, COUNT(c.id)::int AS cases
  FROM clawback_cases c
  JOIN advisers a ON a.id = c.adviser_id
  WHERE c.agent_bucket = 'adviser'
  GROUP BY a.name
  ORDER BY a.name
`;
console.log(`\nCases now assigned to each adviser:`);
for (const r of summary.rows) console.log(`  ${r.name.padEnd(10)} ${r.cases}`);
