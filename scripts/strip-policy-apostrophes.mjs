#!/usr/bin/env node
/**
 * One-off cleanup: strip stray leading or trailing apostrophes from
 * clawback_cases.policy_number. L&G's EBAH wraps policy numbers in
 * apostrophes for Excel text-mode and the parser was only stripping the
 * leading one. The trailing one ended up in the DB and broke the
 * "Open this case" deep links in the Notify / Resolved emails.
 *
 *   node --env-file=.env.local scripts/strip-policy-apostrophes.mjs
 */
import { sql } from "@vercel/postgres";

const APOS = String.fromCharCode(39); // ' single quote

const before = await sql`
  SELECT id, policy_number
  FROM clawback_cases
  WHERE policy_number LIKE '%' || ${APOS} || '%'
  ORDER BY id
`;
console.log(`Found ${before.rowCount} cases with apostrophe(s) in policy_number.`);
for (const r of before.rows.slice(0, 5)) {
  console.log(`  e.g. id=${r.id}  ${JSON.stringify(r.policy_number)}`);
}

if ((before.rowCount ?? 0) === 0) {
  console.log("Nothing to do.");
  process.exit(0);
}

const updated = await sql`
  UPDATE clawback_cases
  SET policy_number = TRIM(BOTH ${APOS} FROM policy_number)
  WHERE policy_number LIKE '%' || ${APOS} || '%'
  RETURNING id, policy_number
`;
console.log(`Cleaned ${updated.rowCount} rows.`);
for (const r of updated.rows.slice(0, 5)) {
  console.log(`  e.g. id=${r.id}  ${JSON.stringify(r.policy_number)}`);
}
