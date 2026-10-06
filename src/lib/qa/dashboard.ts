/**
 * Call QA MI, computed from reviewer-CONFIRMED results only
 * (qa_review_items on each case's latest run), never raw AI output. A
 * case's date is its first call date, falling back to when the case was
 * created. Used by GET /api/qa/dashboard.
 */
import { sql } from "@vercel/postgres";
import { agreement, type ReviewSection } from "./review";

interface CaseRow {
  id: number; adviser_id: number | null; adviser_name: string | null;
  case_date: string; outcome: string | null; deal_id: number | null; gate1_status: string | null;
}
interface ItemRow {
  case_id: number; section: ReviewSection; ref: string | null; label: string;
  mandatory: boolean; ai_result: string; confirmed_result: string;
}

export async function buildDashboard(from: string, to: string, adviserId: number | null) {
  const casesR = await sql.query<CaseRow>(
    `WITH latest AS (
       SELECT DISTINCT ON (case_id, gate) id, case_id, gate, status
         FROM qa_runs ORDER BY case_id, gate, started_at DESC
     ), c AS (
       SELECT c.id, c.adviser_id, a.name AS adviser_name, c.outcome, c.deal_id,
              COALESCE((SELECT MIN(k.call_date) FROM qa_calls k WHERE k.case_id = c.id AND k.deleted_at IS NULL),
                       c.created_at::date) AS case_date,
              (SELECT l.status FROM latest l WHERE l.case_id = c.id AND l.gate = 1) AS gate1_status
         FROM qa_cases c LEFT JOIN advisers a ON a.id = c.adviser_id
        WHERE c.deleted_at IS NULL
     )
     SELECT id, adviser_id, adviser_name, case_date::text AS case_date, outcome, deal_id, gate1_status
       FROM c
      WHERE case_date BETWEEN $1::date AND $2::date
        AND ($3::int IS NULL OR adviser_id = $3)`,
    [from, to, adviserId],
  );
  const cases = casesR.rows;
  const ids = cases.map((c) => c.id);

  const [itemsR, factsR, coverageR] = await Promise.all([
    ids.length
      ? sql.query<ItemRow>(
          `WITH latest AS (
             SELECT DISTINCT ON (case_id, gate) id FROM qa_runs ORDER BY case_id, gate, started_at DESC
           )
           SELECT i.case_id, i.section, i.ref, i.label, i.mandatory, i.ai_result, i.confirmed_result
             FROM qa_review_items i JOIN latest l ON l.id = i.run_id
            WHERE i.case_id = ANY($1::int[])`, [ids])
      : Promise.resolve({ rows: [] as ItemRow[] }),
    ids.length
      ? sql.query<{ case_id: number; vulnerable: boolean }>(
          `WITH latest AS (
             SELECT DISTINCT ON (case_id, gate) case_id, gate, result FROM qa_runs
              WHERE status = 'done' ORDER BY case_id, gate, started_at DESC
           )
           SELECT case_id,
                  EXISTS (SELECT 1 FROM jsonb_array_elements(COALESCE(result->'facts'->'facts', '[]'::jsonb)) f
                           WHERE f->>'category' = 'VULNERABILITY' AND f->>'label' = 'FACT') AS vulnerable
             FROM latest WHERE gate = 1 AND case_id = ANY($1::int[])`, [ids])
      : Promise.resolve({ rows: [] as { case_id: number; vulnerable: boolean }[] }),
    sql.query<{ adviser_id: number; name: string; total: number; checked: number }>(
      `SELECT a.id AS adviser_id, a.name, COUNT(*)::int AS total,
              COUNT(*) FILTER (WHERE EXISTS (SELECT 1 FROM qa_cases q WHERE q.deal_id = d.id AND q.deleted_at IS NULL))::int AS checked
         FROM deals d JOIN advisers a ON a.id = d.adviser_id
        WHERE COALESCE(d.booked_date, d.created_at::date) BETWEEN $1::date AND $2::date
          AND d.status <> 'cancelled' AND a.active = true
          AND ($3::int IS NULL OR d.adviser_id = $3)
        GROUP BY a.id, a.name, a.sort_order ORDER BY a.sort_order, a.name`,
      [from, to, adviserId],
    ),
  ]);
  const items = itemsR.rows;
  const advisersR = await sql<{ id: number; name: string }>`
    SELECT id, name FROM advisers WHERE active = true ORDER BY sort_order, name`;
  const caseById = new Map(cases.map((c) => [c.id, c]));

  // ---- per adviser + team ----
  interface Score {
    adviser_id: number | null; name: string;
    cases: number; reviewed: number; awaiting: number;
    outcomes: Record<string, number>;
    form_pass: number; form_fail: number; mandatory_fails: number;
    disc_full: number; disc_total: number;
    report_ok: number; report_total: number;
  }
  const blank = (adviser_id: number | null, name: string): Score => ({
    adviser_id, name, cases: 0, reviewed: 0, awaiting: 0,
    outcomes: { approved: 0, approved_with_actions: 0, returned: 0 },
    form_pass: 0, form_fail: 0, mandatory_fails: 0, disc_full: 0, disc_total: 0, report_ok: 0, report_total: 0,
  });
  const team = blank(null, "Team");
  const byAdviser = new Map<string, Score>();
  const scoreFor = (c: CaseRow) => {
    const key = c.adviser_name ?? "Unassigned";
    if (!byAdviser.has(key)) byAdviser.set(key, blank(c.adviser_id, key));
    return byAdviser.get(key)!;
  };
  const reviewedCases = new Set(items.map((i) => i.case_id));
  for (const c of cases) {
    for (const s of [team, scoreFor(c)]) {
      s.cases++;
      if (reviewedCases.has(c.id) || c.outcome) s.reviewed++;
      if (c.gate1_status === "done" && !c.outcome) s.awaiting++;
      if (c.outcome) s.outcomes[c.outcome] = (s.outcomes[c.outcome] ?? 0) + 1;
    }
  }
  for (const i of items) {
    const c = caseById.get(i.case_id);
    if (!c) continue;
    for (const s of [team, scoreFor(c)]) {
      if (i.section === "observation") {
        if (i.confirmed_result === "PASS") s.form_pass++;
        if (i.confirmed_result === "FAIL") { s.form_fail++; if (i.mandatory) s.mandatory_fails++; }
      } else if (i.section === "disclosure") {
        if (i.confirmed_result !== "NOT_APPLICABLE") {
          s.disc_total++;
          if (i.confirmed_result === "DELIVERED_IN_FULL") s.disc_full++;
        }
      } else {
        s.report_total++;
        if (i.confirmed_result === "OK") s.report_ok++;
      }
    }
  }

  // ---- monthly trend of the form pass rate ----
  const months = new Map<string, Map<string, { pass: number; fail: number }>>();
  for (const i of items) {
    if (i.section !== "observation" || (i.confirmed_result !== "PASS" && i.confirmed_result !== "FAIL")) continue;
    const c = caseById.get(i.case_id);
    if (!c) continue;
    const m = c.case_date.slice(0, 7);
    if (!months.has(m)) months.set(m, new Map());
    for (const who of ["Team", c.adviser_name ?? "Unassigned"]) {
      const row = months.get(m)!.get(who) ?? { pass: 0, fail: 0 };
      if (i.confirmed_result === "PASS") row.pass++; else row.fail++;
      months.get(m)!.set(who, row);
    }
  }
  const trend = Array.from(months.entries()).sort((a, b) => a[0].localeCompare(b[0])).map(([month, m]) => ({
    month,
    rates: Object.fromEntries(Array.from(m.entries()).map(([who, v]) => [who, v.pass + v.fail ? v.pass / (v.pass + v.fail) : null])),
  }));

  // ---- where the business is failing ----
  const failed = new Map<string, { ref: string | null; label: string; mandatory: boolean; fails: number; total: number }>();
  const missed = new Map<string, { label: string; missing: number; partial: number; total: number }>();
  const replacementCases = new Set<number>();
  for (const i of items) {
    if (i.section === "observation" && (i.confirmed_result === "PASS" || i.confirmed_result === "FAIL")) {
      const k = `${i.ref}|${i.label}`;
      const row = failed.get(k) ?? { ref: i.ref, label: i.label, mandatory: i.mandatory, fails: 0, total: 0 };
      row.total++;
      if (i.confirmed_result === "FAIL") row.fails++;
      failed.set(k, row);
      if ((i.ref ?? "").startsWith("3.1a")) replacementCases.add(i.case_id);
    }
    if (i.section === "disclosure" && i.confirmed_result !== "NOT_APPLICABLE") {
      const row = missed.get(i.label) ?? { label: i.label, missing: 0, partial: 0, total: 0 };
      row.total++;
      if (i.confirmed_result === "MISSING") row.missing++;
      if (i.confirmed_result === "PARTIAL") row.partial++;
      missed.set(i.label, row);
    }
  }

  // ---- AI accuracy against the reviewer ----
  const acc = { agree: 0, disagree: 0, resolved: 0 };
  const accBySection: Record<string, { agree: number; disagree: number; resolved: number }> = {};
  const accByItem = new Map<string, { section: string; ref: string | null; label: string; agree: number; disagree: number }>();
  for (const i of items) {
    const a = agreement(i.section, i.ai_result, i.confirmed_result);
    acc[a]++;
    accBySection[i.section] ??= { agree: 0, disagree: 0, resolved: 0 };
    accBySection[i.section][a]++;
    if (a !== "resolved") {
      const k = `${i.section}|${i.ref}|${i.label}`;
      const row = accByItem.get(k) ?? { section: i.section, ref: i.ref, label: i.label, agree: 0, disagree: 0 };
      row[a]++;
      accByItem.set(k, row);
    }
  }

  return {
    range: { from, to, adviser_id: adviserId },
    // Fixed order for colour assignment: a filter must never repaint an adviser.
    adviser_order: advisersR.rows,
    team,
    advisers: Array.from(byAdviser.values()).sort((a, b) => b.cases - a.cases || a.name.localeCompare(b.name)),
    trend,
    failed_standards: Array.from(failed.values()).filter((r) => r.fails > 0)
      .sort((a, b) => b.fails - a.fails || b.fails / b.total - a.fails / a.total).slice(0, 15),
    missed_disclosures: Array.from(missed.values()).filter((r) => r.missing + r.partial > 0)
      .sort((a, b) => (b.missing + b.partial) - (a.missing + a.partial)).slice(0, 15),
    ai_accuracy: {
      overall: acc,
      by_section: accBySection,
      most_disagreed: Array.from(accByItem.values()).filter((r) => r.disagree > 0)
        .sort((a, b) => b.disagree - a.disagree).slice(0, 10),
    },
    flags: {
      vulnerability_cases: factsR.rows.filter((r) => r.vulnerable).length,
      replacement_cases: replacementCases.size,
    },
    coverage: coverageR.rows,
  };
}
