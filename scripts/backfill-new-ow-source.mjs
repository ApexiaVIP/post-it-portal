#!/usr/bin/env node
/**
 * Walk every clawback case and auto-set the `source` column from the
 * master_agent_no using the same env-driven mapping that the ingest
 * pipeline uses. Cases where Pauline has already manually set a source
 * are left alone (we only touch rows where source IS NULL).
 *
 *   node --env-file=.env.local scripts/backfill-new-ow-source.mjs
 */
import { sql } from "@vercel/postgres";

function parseList(raw) {
  return (raw ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}
const NEW_OW = parseList(process.env.NEW_OW_MASTER_CODES ?? "5930268");
const OLD_OW = parseList(process.env.OLD_OW_MASTER_CODES ?? "8674533,8976516");

console.log("Master code mapping:");
console.log(`  NEW_OW = [${NEW_OW.join(", ")}]`);
console.log(`  OLD_OW = [${OLD_OW.join(", ")}]`);

console.log("\nCases needing source set:");
const before = await sql`
  SELECT master_agent_no, COUNT(*)::int AS n,
         COALESCE(SUM(clawback_due), 0)::float AS cb
  FROM clawback_cases
  WHERE source IS NULL
    AND master_agent_no IS NOT NULL
  GROUP BY master_agent_no
  ORDER BY n DESC
`;
for (const r of before.rows) {
  const m = NEW_OW.includes(r.master_agent_no) ? "new_ow"
          : OLD_OW.includes(r.master_agent_no) ? "old_ow"
          : "(no mapping)";
  console.log(`  master=${r.master_agent_no.padEnd(10)} cases=${String(r.n).padStart(4)} cb=£${r.cb.toFixed(2).padStart(10)} -> ${m}`);
}

let newOwCount = 0, oldOwCount = 0;
if (NEW_OW.length > 0) {
  const r = await sql`
    UPDATE clawback_cases
    SET source = 'new_ow', updated_at = now()
    WHERE source IS NULL
      AND master_agent_no = ANY(${NEW_OW})
  `;
  newOwCount = r.rowCount ?? 0;
}
if (OLD_OW.length > 0) {
  const r = await sql`
    UPDATE clawback_cases
    SET source = 'old_ow', updated_at = now()
    WHERE source IS NULL
      AND master_agent_no = ANY(${OLD_OW})
  `;
  oldOwCount = r.rowCount ?? 0;
}

console.log(`\nUpdated:`);
console.log(`  new_ow: ${newOwCount}`);
console.log(`  old_ow: ${oldOwCount}`);

const urgent = await sql`
  SELECT COUNT(*)::int AS n,
         COALESCE(SUM(clawback_due), 0)::float AS cb
  FROM clawback_cases
  WHERE source = 'new_ow'
    AND clawback_due > 0
    AND status NOT IN ('saved','resold','closed')
`;
console.log(`\nUrgent New OW cases (red flag set on dashboard): ${urgent.rows[0].n}, total exposure £${urgent.rows[0].cb.toFixed(2)}`);
