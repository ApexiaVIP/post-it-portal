/**
 * L&G EBAH ("Event_Download_*") xlsx parser.
 *
 * The file ships with:
 *   row 1  : title cell "Policies at Risk at DD/MM/YYYY. Date From / Date To"
 *   row 2  : blank
 *   row 3  : column headers
 *   row 4+ : 1 row per policy at risk
 *
 * 25 columns; the ones we care about are mapped in COL below. Anything
 * else is preserved in `raw` for debugging.
 *
 * Sales agent names look like:
 *   "TOP QUOTE LIMITED - T HUSSAIN     "
 *   "TOP QUOTE LIMITED H MANSOOR       "
 *   "BANK OF IRELAND TRUST - M STEW TERM"
 *
 * `canonicaliseAgent` collapses the trailing-whitespace / hyphen variants
 * into a normalised form so they hash consistently into the agent map.
 *
 * `extractAdviserKey` returns the trailing surname-like fragment so we can
 * fuzzy-match to an active adviser. Returns null when the prefix isn't
 * "TOP QUOTE LIMITED" -- those rows get bucketed as 'legacy' upstream.
 */
import * as XLSX from "xlsx";

export interface EbahRow {
  rowIndex: number;             // 1-based, for error messages
  policy_number: string;
  client_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_dob: string | null;    // ISO YYYY-MM-DD
  client_email: string | null;
  client_phone: string | null;
  address: string | null;
  postcode: string | null;
  policy_type: string | null;
  warning: string | null;
  net_premium: number | null;
  premium_outstanding: number | null;
  clawback_due: number;
  clawback_date: string | null;
  policy_start_date: string | null;
  off_risk_date: string | null;
  ebah_agent_name: string;
  master_agent_no: string | null;
  agent_no: string | null;
  raw: Record<string, unknown>;
}

export interface ParseResult {
  reportDate: string | null;   // YYYY-MM-DD parsed from the title
  rows: EbahRow[];
  errors: { rowIndex: number; reason: string }[];
}

// Header row column positions (0-indexed)
const COL = {
  master_agent_no:   0,
  agent_no:          1,
  policy_number:     2,
  client_name:       3,
  dob:               4,
  email:             5,
  phone:             6,
  address_1:         7,
  address_2:         8,
  address_3:         9,
  address_4:         10,
  postcode:          11,
  policy_type:       12,
  warning:           13,
  last_full_paid:    14,
  net_premium:       15,
  premium_os:        16,
  clawback_due:      17,
  clawback_date:     18,
  policy_start_date: 19,
  off_risk_date:     20,
  sales_agent_name:  21,
  servicing_agent:   22,
  frn:               23,
  reqs_to_save:      24,
};

export function parseEbahXlsx(buf: Buffer | ArrayBuffer): ParseResult {
  const wb = XLSX.read(buf, { type: "buffer", cellDates: false });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { reportDate: null, rows: [], errors: [{ rowIndex: 0, reason: "no sheet" }] };
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: null });

  // Title row (0) -> report date
  const titleRow = grid[0]?.[0];
  const reportDate = parseReportDate(typeof titleRow === "string" ? titleRow : null);

  const rows: EbahRow[] = [];
  const errors: { rowIndex: number; reason: string }[] = [];

  // Data starts at row index 3 (0=title, 1=blank, 2=headers, 3+=data).
  //
  // The file finishes with a footer row that looks like a policy row at a
  // glance but is L&G's grand total:
  //   Agent No   = "Total Policies"
  //   Policy No  = <count of policies in the file>
  //   PremOS     = "Total Clawback Due"
  //   CB Due     = <the grand total>
  // Recognise it explicitly so a future L&G layout change can't sneak it
  // into the case table.
  for (let i = 3; i < grid.length; i++) {
    const r = grid[i];
    if (!r) continue;
    const agentNoCell = toStr(r[COL.agent_no]);
    const premOsCell  = toStr(r[COL.premium_os]);
    if (agentNoCell === "Total Policies" || premOsCell === "Total Clawback Due") {
      continue; // footer row
    }
    const policyRaw = stripLeadingApostrophe(toStr(r[COL.policy_number]));
    if (!policyRaw) continue; // blank row
    const clientName = toStr(r[COL.client_name]);
    if (!clientName) {
      errors.push({ rowIndex: i + 1, reason: "missing client name" });
      continue;
    }
    const { first, last } = splitClientName(clientName);
    const address = joinNonEmpty([
      toStr(r[COL.address_1]),
      toStr(r[COL.address_2]),
      toStr(r[COL.address_3]),
      toStr(r[COL.address_4]),
    ]);
    const agentRaw = toStr(r[COL.sales_agent_name]);
    rows.push({
      rowIndex: i + 1,
      policy_number: policyRaw,
      client_name: clientName,
      client_first_name: first,
      client_last_name: last,
      client_dob: parseDateCell(r[COL.dob]),
      client_email: toStr(r[COL.email]),
      client_phone: stripLeadingApostrophe(toStr(r[COL.phone])),
      address,
      postcode: toStr(r[COL.postcode]),
      policy_type: toStr(r[COL.policy_type]),
      warning: toStr(r[COL.warning]),
      net_premium: toNum(r[COL.net_premium]),
      premium_outstanding: toNum(r[COL.premium_os]),
      clawback_due: toNum(r[COL.clawback_due]) ?? 0,
      clawback_date: parseDateCell(r[COL.clawback_date]),
      policy_start_date: parseDateCell(r[COL.policy_start_date]),
      off_risk_date: parseDateCell(r[COL.off_risk_date]),
      ebah_agent_name: canonicaliseAgent(agentRaw ?? ""),
      master_agent_no: stripLeadingApostrophe(toStr(r[COL.master_agent_no])),
      agent_no:        stripLeadingApostrophe(toStr(r[COL.agent_no])),
      raw: {
        // Poz confirmed we don't need Servicing Agent -- Sales Agent is the
        // only one that matters for clawback ownership. Field still exists
        // on the EBAH schema (COL.servicing_agent) but we stop carrying it.
        frn:             toStr(r[COL.frn]),
        reqs_to_save:    toStr(r[COL.reqs_to_save]),
        last_full_paid:  parseDateCell(r[COL.last_full_paid]),
      },
    });
  }

  return { reportDate, rows, errors };
}

// -- agent-name canonicaliser ------------------------------------------------

export function canonicaliseAgent(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

// Pull the surname-like fragment off a TOP QUOTE LIMITED string so we can
// match against the active-adviser roster. Returns null when the prefix
// isn't "TOP QUOTE LIMITED" -- those are non-TQL legacy book.
//
// Examples:
//   "TOP QUOTE LIMITED - T HUSSAIN"     -> "T HUSSAIN"
//   "TOP QUOTE LIMITED H MANSOOR"       -> "H MANSOOR"
//   "TOP QUOTE LIMITED RICHARD ROGERS"  -> "RICHARD ROGERS"
//   "BANK OF IRELAND TRUST - M STEW"    -> null (not Top Quote)
export function extractAdviserKey(canonical: string): string | null {
  if (!canonical) return null;
  const m = canonical.match(/^TOP QUOTE LIMITED\s*-?\s*(.+?)\.?$/i);
  if (!m) return null;
  return m[1].trim().toUpperCase().replace(/\s+/g, " ");
}

// Known name fragments per active adviser. Used on first-time-seen agent
// strings to seed clawback_agent_map. Anything not in this list lands in
// 'xstaff' (if Top Quote) or 'legacy' (non-TQL).
//
// Add fragments here when a new adviser joins. The match is "agent string
// contains this fragment as whole word".
export const ADVISER_NAME_FRAGMENTS: Record<string, string[]> = {
  Tan:     ["T HUSSAIN", "TAN HUSSAIN", "TANWEER HUSSAIN"],
  Hayder:  ["H MANSOOR", "HAYDER MANSOOR"],
  Gurdaht: ["G SINGH", "GURDAHT SINGH"],
  Atikur:  ["A SABUR", "ATIKUR SABUR"],
  Jack:    ["J SHEPLEY", "JACK SHEPLEY"],
};

export interface AdviserLookup {
  id: number;
  name: string;
  /** L&G seller codes belonging to this adviser. May be empty. */
  seller_codes?: string[];
}

/**
 * Authoritative bucketing by L&G seller code (column 2 "Agent No" on the
 * EBAH). Codes are stable -- L&G assigns one (or two, for advised vs
 * non-advised) per seller and never reuses them. Use this BEFORE falling
 * back to bucketAgentString().
 *
 * Returns null when the code isn't recognised -- caller falls back to
 * the name-fragment matcher (or treats it as Xstaff / Legacy).
 */
export function bucketAgentByCode(
  agentNo: string | null,
  advisers: AdviserLookup[],
): { bucket: "adviser"; adviser_id: number } | null {
  if (!agentNo) return null;
  const trimmed = agentNo.trim();
  if (!trimmed) return null;
  for (const a of advisers) {
    if (a.seller_codes && a.seller_codes.includes(trimmed)) {
      return { bucket: "adviser", adviser_id: a.id };
    }
  }
  return null;
}

export function bucketAgentString(
  canonical: string,
  advisers: AdviserLookup[],
): { bucket: "adviser" | "xstaff" | "legacy" | "needs_review"; adviser_id: number | null } {
  const key = extractAdviserKey(canonical);
  if (!key) return { bucket: "legacy", adviser_id: null };
  for (const a of advisers) {
    const fragments = ADVISER_NAME_FRAGMENTS[a.name];
    if (!fragments) continue;
    for (const frag of fragments) {
      if (key === frag || key.endsWith(" " + frag) || key.startsWith(frag + " ") || key === frag.replace(/\s+/g, " ")) {
        return { bucket: "adviser", adviser_id: a.id };
      }
    }
  }
  return { bucket: "xstaff", adviser_id: null };
}

// -- helpers -----------------------------------------------------------------

function toStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s.length === 0 ? null : s;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[,£]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function stripLeadingApostrophe(s: string | null): string | null {
  if (s === null) return null;
  // L&G prefixes IDs / phone numbers with a literal "'" so Excel treats them
  // as text, and SOMETIMES wraps them ('0123456789') with a trailing one too.
  // Both are display artefacts -- the policy number itself is just digits.
  return s.replace(/^'/, "").replace(/'$/, "");
}

function joinNonEmpty(parts: (string | null)[]): string | null {
  const out = parts.filter((p): p is string => !!p && p.length > 0);
  return out.length === 0 ? null : out.join(", ");
}

function splitClientName(full: string): { first: string | null; last: string | null } {
  // "Mr Darren Fowler" -> first=Darren last=Fowler
  // "Mrs Caroline McMinn" -> first=Caroline last=McMinn
  // "Miss Philomena McDonnell" -> first=Philomena last=McDonnell
  const TITLES = new Set(["MR", "MRS", "MISS", "MS", "DR", "MX", "REV", "PROF"]);
  const parts = full.replace(/\s+/g, " ").trim().split(" ");
  let i = 0;
  if (parts[0] && TITLES.has(parts[0].toUpperCase().replace(/\./g, ""))) i = 1;
  const rest = parts.slice(i);
  if (rest.length === 0) return { first: null, last: null };
  if (rest.length === 1) return { first: null, last: rest[0] };
  return { first: rest[0], last: rest.slice(1).join(" ") };
}

function parseDateCell(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  // xlsx returns dates as numbers (Excel serial) when cellDates:false. Convert.
  if (typeof v === "number") {
    const d = XLSX.SSF.parse_date_code(v);
    if (!d) return null;
    return `${pad4(d.y)}-${pad2(d.m)}-${pad2(d.d)}`;
  }
  if (typeof v === "string") {
    // "21/01/2026" -> 2026-01-21
    const m = v.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
    if (m) {
      const dd = pad2(Number(m[1]));
      const mm = pad2(Number(m[2]));
      const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
      return `${yy}-${mm}-${dd}`;
    }
    // ISO already?
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return v.slice(0, 10);
  }
  return null;
}

function parseReportDate(title: string | null): string | null {
  if (!title) return null;
  const m = title.match(/Policies at Risk at\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})/i);
  if (!m) return null;
  const dd = pad2(Number(m[1]));
  const mm = pad2(Number(m[2]));
  const yy = m[3].length === 2 ? `20${m[3]}` : m[3];
  return `${yy}-${mm}-${dd}`;
}

function pad2(n: number) { return String(n).padStart(2, "0"); }
function pad4(n: number) { return String(n).padStart(4, "0"); }
