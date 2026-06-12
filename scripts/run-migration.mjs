#!/usr/bin/env node
/**
 * Apply a SQL migration file against the database in POSTGRES_URL.
 *
 *   node --env-file=.env.local scripts/run-migration.mjs db/migrations/0006_clawback_cases.sql
 *
 * The script executes the whole file as one statement, splitting on the
 * top-level ';' that ends each statement. It is deliberately simple: don't
 * put dollar-quoted PL/pgSQL or copy-from blocks in migration files.
 */
import fs from "node:fs";
import { sql } from "@vercel/postgres";

const file = process.argv[2];
if (!file) {
  console.error("usage: run-migration.mjs <path/to/file.sql>");
  process.exit(1);
}

const text = fs.readFileSync(file, "utf8");

// Strip line comments + split on top-level ';'. Works for these IDEMPOTENT
// CREATE / ALTER blocks; refuse anything containing a $$ block.
if (/\$\$/.test(text)) {
  console.error("refusing: file contains $$ blocks, run those via psql directly");
  process.exit(1);
}
const stripped = text
  .split("\n")
  .map((l) => l.replace(/--.*$/, ""))
  .join("\n");
const statements = stripped
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

console.log(`Applying ${file} -> ${statements.length} statements`);
for (let i = 0; i < statements.length; i++) {
  const s = statements[i];
  const preview = s.replace(/\s+/g, " ").slice(0, 80);
  process.stdout.write(`  [${i + 1}/${statements.length}] ${preview}... `);
  try {
    await sql.query(s);
    console.log("ok");
  } catch (e) {
    console.log("FAIL");
    console.error(e.message);
    process.exit(2);
  }
}
console.log("done.");
