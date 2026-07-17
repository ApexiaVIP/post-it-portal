#!/usr/bin/env node
/**
 * One-off ingestion script: parse the 5 per-adviser RECI CSVs Pauline
 * exported, map each row to a `deals` insert payload, and cross-check
 * totals against the Business Tracker CSVs.
 *
 *   node scripts/import-reci-2026.mjs                  # dry run, no DB
 *   node scripts/import-reci-2026.mjs --insert         # actually inserts
 *
 * --insert requires POSTGRES_URL in env (via .env.local).
 *
 * Rules of the road (per Pauline + the schema):
 *   - Status is derived from WHICH commission column has the value:
 *       COMMS PAID            -> "paid"
 *       COMMS ON RISK NYP     -> "on_risk_nyp"
 *       COMMS IN PROCESSING   -> "in_processing"
 *       COMMS NYS             -> "not_yet_submitted"
 *       COMMS CXL             -> "cancelled"
 *     The free-text STATUS OF APP column is informational only EXCEPT
 *     for cancelled rows where it carries the reason (NPW/Declined/Postponed).
 *   - Year is hard-coded to 2026 (the dataset we're ingesting).
 *   - Multi-column rows (data error in source): we take the first populated
 *     column and emit a warning.
 *   - Rows with no commission populated: skipped + warning.
 */
import fs from "node:fs";
import path from "node:path";

const DOWNLOADS = "/Users/jimmyacton/Downloads/rerekisforeachseller_";
const YEAR = 2026;

const ADVISERS = [
  { slug: "tan",     detail: "TAN RECI - Live(TAN RECI 2026) (1).csv",     tracker: "TAN RECI - Live(TAN BUSINESS TRACKER).csv" },
  { slug: "hayder",  detail: "HAYDER RECI - Live(HAYDER - RECI 2026).csv", tracker: "HAYDER RECI - Live(HAYDER BUSINESS TRACKER).csv" },
  { slug: "gurdaht", detail: "GURDAHT RECI - Live(Gurdaht RECI 2026).csv", tracker: "GURDAHT RECI - Live(GURDAHT - BUSINESS TRACKER).csv" },
  { slug: "jack",    detail: "JACK RECI - Live(Jack Reci - 2026).csv",     tracker: "JACK RECI - Live(Jack - Business Tracker).csv" },
  { slug: "atikur",  detail: "ATIKUR RECI - Live(Atikur - Reci 2026).csv", tracker: "ATIKUR RECI - Live(Atikur - Business Tracker).csv" },
];

// ----------------------------------------------------------------------------
// CSV parser (handles quoted fields with internal commas).
// ----------------------------------------------------------------------------
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { inQuotes = false; }
      } else {
        field += c;
      }
    } else {
      if (c === '"') { inQuotes = true; }
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n' || c === '\r') {
        if (field !== "" || row.length > 0) { row.push(field); rows.push(row); row = []; field = ""; }
        if (c === '\r' && text[i + 1] === '\n') i++;
      } else {
        field += c;
      }
    }
  }
  if (field !== "" || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

// Strip currency symbols (£ and the replacement-char '�' the CSV uses),
// thousand separators and whitespace; parse as a number. Empty -> 0.
function parseMoney(s) {
  if (s == null) return 0;
  const cleaned = String(s).replace(/[£��$£Â\s,]/g, "").trim();
  if (!cleaned) return 0;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : 0;
}

// Find which commission column (0..4 -> paid..cancelled) the row uses.
const COMM_COLUMNS = [
  { idx: 11, status: "paid" },
  { idx: 12, status: "on_risk_nyp" },
  { idx: 13, status: "in_processing" },
  { idx: 14, status: "not_yet_submitted" },
  { idx: 15, status: "cancelled" },
];

function deriveSplitsFromRow(row) {
  const populated = [];
  for (const c of COMM_COLUMNS) {
    const v = parseMoney(row[c.idx]);
    if (v > 0) populated.push({ status: c.status, value: v });
  }
  if (populated.length === 0) return null;
  if (populated.length === 1) return { splits: populated, kind: "single" };

  // Multiple columns populated. If all values are equal (within 1p) -> this is
  // a duplicate entry in the source spreadsheet (same commission appears in
  // two columns by mistake). Take the rightmost column (more conservative
  // status: cxl > nys > in_processing > on_risk_nyp > paid).
  const v0 = populated[0].value;
  const allSame = populated.every((p) => Math.abs(p.value - v0) < 0.01);
  if (allSame) {
    return { splits: [populated[populated.length - 1]], kind: "dedupe", originalCols: populated };
  }
  // Different values -> the source row represents multiple outcomes from one
  // multi-deal client. Emit a separate deal per populated column.
  return { splits: populated, kind: "split", originalCols: populated };
}

// Distribute a total across n splits; remainder to the first.
function splitInts(total, n) {
  const base = Math.floor(total / n);
  const rem  = total % n;
  const out  = Array(n).fill(base);
  for (let i = 0; i < rem; i++) out[i]++;
  return out;
}

function deriveReason(statusText) {
  const s = String(statusText || "").toUpperCase().trim();
  if (s.includes("NPW"))      return "npw";
  if (s.includes("DECLINE"))  return "declined";
  if (s.includes("POSTPONE")) return "postponed";
  return "other";
}

const IN_PROC_STAGES = ["checked", "gpr", "misc", "ns", "rfi", "sot"];
function deriveInProcessingStage(statusText) {
  const s = String(statusText || "").toLowerCase().trim();
  return IN_PROC_STAGES.includes(s) ? s : null;
}

// ----------------------------------------------------------------------------
// Detail CSV parser.
// Column layout (0-indexed):
//   0=CLIENT 1=POSTCODE 2=NO_OF_DEALS 3=PROVIDER 4=PREMIUM 5=CONFIRMED
//   6=POZ_LISTENED 7=MISCELLANEOUS 8=SUBMITTED 9=ACC/REF 10=STATUS_OF_APP
//   11=COMMS_PAID 12=COMMS_ON_RISK_NYP 13=COMMS_IN_PROCESSING
//   14=COMMS_NYS 15=COMMS_CXL 16=NOTES 17=GL_SP 18=GL_TXT 19=TRUST_DONE 20=TRUST_SENT
// ----------------------------------------------------------------------------
function parseDetailCSV(filepath, adviserSlug) {
  const text = fs.readFileSync(filepath, "utf8");
  const rows = parseCSV(text);
  let currentWeek = null;
  const deals = [];
  const warnings = [];

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.length === 0) continue;
    const first = (row[0] || "").trim();
    if (!first) continue;

    const weekMatch = first.match(/^Week\s+0*(\d{1,2})/i);
    if (weekMatch) {
      currentWeek = parseInt(weekMatch[1], 10);
      continue;
    }

    if (/^total\b/i.test(first)) continue;
    if (currentWeek === null) {
      warnings.push(`Row ${i + 1}: data row before any Week header (${first})`);
      continue;
    }

    const splitInfo = deriveSplitsFromRow(row);
    if (!splitInfo) {
      const looksEmpty = !row.slice(11, 16).some((x) => x && x.trim());
      if (!looksEmpty) {
        warnings.push(`Row ${i + 1} (${first}, wk ${currentWeek}): commission columns parsed to zero, skipping`);
      }
      continue;
    }

    const statusOfApp = (row[10] || "").trim();
    const notes = (row[16] || "").trim();
    const noOfDealsTotal = parseInt((row[2] || "0").trim(), 10) || 0;

    if (splitInfo.kind === "dedupe") {
      warnings.push(
        `Row ${i + 1} (${first}, wk ${currentWeek}): duplicate value in ${splitInfo.originalCols.length} columns ` +
        `(${splitInfo.originalCols.map((c) => c.status).join(", ")}) -> using ${splitInfo.splits[0].status}`,
      );
    } else if (splitInfo.kind === "split") {
      warnings.push(
        `Row ${i + 1} (${first}, wk ${currentWeek}): row split into ${splitInfo.splits.length} deals: ` +
        splitInfo.originalCols.map((c) => `${c.status}=£${c.value.toFixed(2)}`).join(", "),
      );
    }

    const noOfDealsPerSplit = splitInts(noOfDealsTotal, splitInfo.splits.length);

    for (let s = 0; s < splitInfo.splits.length; s++) {
      const split = splitInfo.splits[s];
      const isCancelled = split.status === "cancelled";
      const cancellation_reason = isCancelled ? deriveReason(statusOfApp) : null;
      // For split-row cancelled deals when status text doesn't match (e.g. Riley
      // wk 12 says "In Processing" but has a cancelled split), reason defaults
      // to "other" via deriveReason -- correct default; Pauline can refine.

      deals.push({
        adviser_slug: adviserSlug,
        year: YEAR,
        week: currentWeek,
        client: first.slice(0, 200),
        postcode: (row[1] || "").trim() || null,
        no_of_deals: noOfDealsPerSplit[s],
        provider: (row[3] || "").trim() || null,
        premium: parseMoney(row[4]) || null,
        confirmed_date: (row[5] || "").trim() || null,
        poz_listened: (row[6] || "").trim() || null,
        miscellaneous: (row[7] || "").trim() || null,
        submitted: (row[8] || "").trim() || null,
        acc_ref: (row[9] || "").trim().toUpperCase() || null,
        status: split.status,
        commission: split.value,
        notes: isCancelled ? null : (notes || null),
        gl_sp: (row[17] || "").trim() || null,
        gl_txt: (row[18] || "").trim() || null,
        trust_done: (row[19] || "").trim() || null,
        trust_sent: (row[20] || "").trim() || null,
        cancellation_reason,
        cancellation_notes: isCancelled ? (notes || null) : null,
        in_processing_stage: split.status === "in_processing" ? deriveInProcessingStage(statusOfApp) : null,
      });
    }
  }

  return { deals, warnings };
}

// ----------------------------------------------------------------------------
// Business Tracker CSV (for cross-check). Finds the 2026 section and extracts
// per-week + total figures.
// ----------------------------------------------------------------------------
function parseTrackerCSV(filepath, year) {
  if (!fs.existsSync(filepath)) return { total: {}, byWeek: {} };
  const text = fs.readFileSync(filepath, "utf8");
  const rows = parseCSV(text);
  const result = { total: {}, byWeek: {} };

  const yearMarker = String(year);
  let inSection = false;
  let headerSeen = false;

  for (const row of rows) {
    const first = (row[0] || "").trim();
    if (!first) continue;

    if (!inSection && first.includes(yearMarker)) {
      inSection = true;
      headerSeen = false;
      continue;
    }
    if (!inSection) continue;

    if (first.toUpperCase() === "WEEK") { headerSeen = true; continue; }
    if (!headerSeen) continue;

    if (/^total$/i.test(first)) {
      result.total = {
        paid:              parseMoney(row[1]),
        on_risk_nyp:       parseMoney(row[3]),
        in_processing:     parseMoney(row[5]),
        not_yet_submitted: parseMoney(row[7]),
        cancelled:         parseMoney(row[9]),
      };
      inSection = false;
      continue;
    }
    const wkMatch = first.match(/^Week\s+0*(\d{1,2})/i);
    if (wkMatch) {
      const wk = parseInt(wkMatch[1], 10);
      result.byWeek[wk] = {
        paid:              parseMoney(row[1]),
        on_risk_nyp:       parseMoney(row[3]),
        in_processing:     parseMoney(row[5]),
        not_yet_submitted: parseMoney(row[7]),
        cancelled:         parseMoney(row[9]),
      };
    }
  }
  return result;
}

// ----------------------------------------------------------------------------
// Formatting
// ----------------------------------------------------------------------------
function gbp(n) {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return sign + "£" + abs.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
async function main() {
  const args = process.argv.slice(2);
  const doInsert = args.includes("--insert");

  console.log("=========================================================");
  console.log(`RECI CSV ingest — ${doInsert ? "INSERT MODE" : "dry run"}`);
  console.log("=========================================================\n");

  let totalDeals = 0;
  let totalWarnings = 0;
  const allDeals = [];
  const allDiscrepancies = [];

  for (const a of ADVISERS) {
    const detailPath = path.join(DOWNLOADS, a.detail);
    const trackerPath = path.join(DOWNLOADS, a.tracker);

    console.log(`--- ${a.slug.toUpperCase()} ---`);

    if (!fs.existsSync(detailPath)) {
      console.log(`  MISSING DETAIL FILE: ${detailPath}\n`);
      continue;
    }

    const { deals, warnings } = parseDetailCSV(detailPath, a.slug);
    const tracker = parseTrackerCSV(trackerPath, YEAR);

    const parsed = { paid: 0, on_risk_nyp: 0, in_processing: 0, not_yet_submitted: 0, cancelled: 0 };
    for (const d of deals) parsed[d.status] += d.commission;

    console.log(`  Parsed: ${deals.length} deals; warnings: ${warnings.length}`);
    for (const w of warnings.slice(0, 5)) console.log(`    ! ${w}`);
    if (warnings.length > 5) console.log(`    (+${warnings.length - 5} more warnings)`);
    console.log("");

    console.log(`  Status totals (parsed  vs  tracker):`);
    for (const s of ["paid", "on_risk_nyp", "in_processing", "not_yet_submitted", "cancelled"]) {
      const p = parsed[s];
      const t = tracker.total ? (tracker.total[s] || 0) : 0;
      const diff = p - t;
      const flag = Math.abs(diff) < 1 ? " " : "!";
      console.log(`    ${flag} ${s.padEnd(20)} ${gbp(p).padStart(14)}    ${gbp(t).padStart(14)}    diff=${gbp(diff)}`);
      if (Math.abs(diff) >= 1) {
        allDiscrepancies.push({ adviser: a.slug, status: s, parsed: p, tracker: t, diff });
      }
    }
    console.log("");

    totalDeals += deals.length;
    totalWarnings += warnings.length;
    allDeals.push(...deals);
  }

  console.log("=========================================================");
  console.log(`SUMMARY: ${totalDeals} deals, ${totalWarnings} warnings, ${allDiscrepancies.length} status-total discrepancies`);
  console.log("=========================================================\n");

  // Cross-adviser status totals
  const grand = { paid: 0, on_risk_nyp: 0, in_processing: 0, not_yet_submitted: 0, cancelled: 0 };
  for (const d of allDeals) grand[d.status] += d.commission;
  console.log("Grand totals across all 5 advisers (parsed):");
  for (const s of Object.keys(grand)) console.log(`  ${s.padEnd(20)} ${gbp(grand[s])}`);

  if (allDiscrepancies.length > 0) {
    console.log("\nDiscrepancies vs Business Tracker (worth Pauline's eye):");
    for (const d of allDiscrepancies) {
      console.log(`  ${d.adviser.padEnd(8)} ${d.status.padEnd(20)} parsed=${gbp(d.parsed)} tracker=${gbp(d.tracker)} diff=${gbp(d.diff)}`);
    }
  }

  console.log("\nSample of first 3 parsed deals:");
  for (const d of allDeals.slice(0, 3)) {
    console.log("  " + JSON.stringify(d));
  }

  if (!doInsert) {
    console.log("\n[dry-run] No data was written. Re-run with --insert to proceed (requires POSTGRES_URL).");
    return;
  }

  // ---------------------------------------------------------------------
  // INSERT MODE -- requires POSTGRES_URL.
  // Sequence: backup -> truncate -> insert -> verify -> commit.
  // ---------------------------------------------------------------------
  if (!process.env.POSTGRES_URL && !process.env.POSTGRES_PRISMA_URL && !process.env.DATABASE_URL) {
    console.error("\nERROR: --insert was passed but POSTGRES_URL is not set in env.");
    console.error("       Run `vercel env pull .env.local` from the project root,");
    console.error("       then `node --env-file=.env.local scripts/import-reci-2026.mjs --insert`.");
    process.exit(1);
  }

  // Lazy import so dry-run never needs the pg client.
  const pg = await import("@vercel/postgres");
  const sql = pg.sql;

  console.log("\nConnecting to Postgres...");
  // sanity check
  const ping = await sql`SELECT current_database() AS db, now() AS now`;
  console.log(`  Connected to ${ping.rows[0].db} at ${ping.rows[0].now}`);

  // Step 1: resolve adviser slugs -> ids
  const slugs = [...new Set(allDeals.map((d) => d.adviser_slug))];
  const { rows: advRows } = await sql.query(
    `SELECT id, slug, name FROM advisers WHERE slug = ANY($1::text[])`,
    [slugs],
  );
  const slugToId = new Map(advRows.map((r) => [r.slug, r.id]));
  const missing = slugs.filter((s) => !slugToId.has(s));
  if (missing.length > 0) {
    console.error(`\nERROR: these adviser slugs are not in the advisers table:`);
    for (const s of missing) console.error(`  - ${s}`);
    console.error("Aborting. Either add the advisers first or fix the slug mapping in the script.");
    process.exit(1);
  }
  console.log(`  Resolved ${slugs.length} adviser slugs:`);
  for (const r of advRows) console.log(`    ${r.slug.padEnd(10)} -> id=${r.id}  (${r.name})`);

  // Step 2: backup (idempotent -- IF NOT EXISTS)
  const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const backupDeals   = `deals_backup_${stamp}`;
  const backupHistory = `deal_history_backup_${stamp}`;
  console.log(`\nBacking up to ${backupDeals} and ${backupHistory}...`);
  await sql.query(`CREATE TABLE IF NOT EXISTS ${backupDeals} AS SELECT * FROM deals WHERE FALSE`);
  await sql.query(`CREATE TABLE IF NOT EXISTS ${backupHistory} AS SELECT * FROM deal_history WHERE FALSE`);
  // Populate the backups (idempotent: if backup already non-empty, skip the second populate).
  const { rows: bkChk } = await sql.query(`SELECT COUNT(*)::int AS n FROM ${backupDeals}`);
  if (bkChk[0].n === 0) {
    await sql.query(`INSERT INTO ${backupDeals}   SELECT * FROM deals`);
    await sql.query(`INSERT INTO ${backupHistory} SELECT * FROM deal_history`);
  } else {
    console.log(`  Backup tables already populated (${bkChk[0].n} rows). Not overwriting.`);
  }
  const { rows: bDeals } = await sql.query(`SELECT COUNT(*)::int AS n FROM ${backupDeals}`);
  const { rows: bHist  } = await sql.query(`SELECT COUNT(*)::int AS n FROM ${backupHistory}`);
  const { rows: liveDeals } = await sql.query(`SELECT COUNT(*)::int AS n FROM deals`);
  const { rows: liveHist  } = await sql.query(`SELECT COUNT(*)::int AS n FROM deal_history`);
  console.log(`  Backup: deals=${bDeals[0].n}  deal_history=${bHist[0].n}`);
  console.log(`  Live:   deals=${liveDeals[0].n}  deal_history=${liveHist[0].n}`);

  // Step 3: confirm before truncate. Require an extra --i-have-the-backup flag.
  if (!args.includes("--i-have-the-backup")) {
    console.log("\nBackup tables are in place. To proceed with TRUNCATE + INSERT, re-run with:");
    console.log(`  node --env-file=.env.local scripts/import-reci-2026.mjs --insert --i-have-the-backup`);
    return;
  }

  console.log("\nTRUNCATE deals, deal_history...");
  await sql.query(`TRUNCATE deals, deal_history RESTART IDENTITY`);
  console.log("  Done.");

  // Step 4: insert deals
  console.log(`\nInserting ${allDeals.length} deals...`);
  const importer = "bulk_import_" + stamp;
  let insertedDeals = 0;
  for (const d of allDeals) {
    const adviser_id = slugToId.get(d.adviser_slug);
    const { rows: ins } = await sql.query(
      `INSERT INTO deals (
         adviser_id, year, week, client, postcode, no_of_deals, provider, premium,
         confirmed_date, poz_listened, miscellaneous, submitted, acc_ref,
         status, commission, notes, gl_sp, gl_txt, trust_done, trust_sent,
         cancellation_reason, cancellation_notes, in_processing_stage
       ) VALUES (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
       )
       RETURNING id`,
      [
        adviser_id, d.year, d.week, d.client, d.postcode, d.no_of_deals, d.provider, d.premium,
        d.confirmed_date, d.poz_listened, d.miscellaneous, d.submitted, d.acc_ref,
        d.status, d.commission, d.notes, d.gl_sp, d.gl_txt, d.trust_done, d.trust_sent,
        d.cancellation_reason, d.cancellation_notes, d.in_processing_stage,
      ],
    );
    const newId = ins[0].id;
    await sql.query(
      `INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, old_commission, new_commission, note)
       VALUES ($1, $2, NULL, $3, NULL, $4, 'created (bulk import)')`,
      [newId, importer, d.status, d.commission],
    );
    insertedDeals++;
  }
  console.log(`  Inserted ${insertedDeals} deals + history rows.`);

  // Step 5: verify
  console.log("\nVerifying live totals vs parsed:");
  const { rows: liveTotals } = await sql.query(
    `SELECT status, COUNT(*)::int AS n, COALESCE(SUM(commission),0)::numeric AS comm
     FROM deals WHERE year = $1 GROUP BY status ORDER BY status`,
    [YEAR],
  );
  const parsedByStatus = {};
  for (const d of allDeals) {
    parsedByStatus[d.status] = (parsedByStatus[d.status] || 0) + d.commission;
  }
  for (const row of liveTotals) {
    const p = parsedByStatus[row.status] || 0;
    const live = Number(row.comm);
    const diff = live - p;
    const flag = Math.abs(diff) < 0.01 ? " " : "!";
    console.log(`  ${flag} ${row.status.padEnd(20)} live=${gbp(live).padStart(14)} parsed=${gbp(p).padStart(14)} diff=${gbp(diff)}`);
  }
  console.log(`\nIngest complete. Backups remain in ${backupDeals} and ${backupHistory} for restore if needed.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
