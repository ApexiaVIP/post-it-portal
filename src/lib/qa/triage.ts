/**
 * Call QA summary (Poz and Guy, 19 Nov 2026). The full report runs to about
 * 60 pages and lists the same shortfall in several places, so the front page
 * is built from it: one line per real issue, rated red / amber / green, with
 * what went wrong, where in the call and what to do about it. It reads the
 * checker's existing results, so a sale needs no re-run to get one.
 *
 * Red follows Openwork's own rule: failing an asterisked standard fails the
 * section. Also red: a client priority left unaddressed, a consistency
 * finding the checker rated high, and a suitability report that doesn't
 * match the calls. Script statements under a standard are listed on that
 * standard's line instead of as lines of their own. Script gaps go to Guy
 * and are not counted against the seller.
 */
import type { EvidenceItem, Gate1Result, Gate2Result } from "./schemas";

export type Rag = "red" | "amber" | "green" | "script";

export interface TriagePoint {
  label: string;
  result: string;
  detail: string;
  evidence: EvidenceItem[];
}

export interface TriageLine {
  rag: Rag;
  /** Part of the call, e.g. "Fact find". */
  area: string;
  /** Openwork form reference, e.g. "3.1*". */
  ref: string | null;
  title: string;
  why: string;
  /** Script statements under this standard that were missed or only partly said. */
  points: TriagePoint[];
  evidence: EvidenceItem[];
  action: string;
  order: number;
}

export interface Triage {
  verdict: "red" | "amber" | "green";
  lines: TriageLine[];
  counts: Record<Rag, number>;
}

const baseRef = (r: string) => r.replace(/\*/g, "").trim();

function areaFor(ref: string | null): string {
  const r = ref ? baseRef(ref) : "";
  if (r.startsWith("1")) return "Introduction and disclosure";
  if (r.startsWith("2.1")) return "Fact find";
  if (r.startsWith("2")) return "Needs and tailoring";
  if (r.startsWith("3")) return "Recommendation and application";
  if (r.startsWith("4")) return "Adviser knowledge";
  if (r.startsWith("5")) return "Documentation";
  if (r.startsWith("6")) return "Medical questions";
  return "Other";
}

function orderFor(ref: string | null): number {
  const m = ref ? baseRef(ref).match(/^(\d+)\.(\d+)/) : null;
  return m ? Number(m[1]) + Number(m[2]) / 100 : 9;
}

// What putting it right with the client looks like, by form standard.
const PUT_RIGHT: [RegExp, string][] = [
  [/^1\.1$/, "Make sure the client knows who called them and that the call was recorded."],
  [/^1\.2$/, "Send the client the full disclosures in writing, with the seller's contact details."],
  [/^1\.3$/, "Send the client the firm's disclosures in writing: the service, how we are paid, complaints and the FSCS."],
  [/^1\.4$/, "Send the client the privacy notice."],
  [/^2\.1$/, "Contact the client to fill the gap in the fact find, then check the recommendation still fits."],
  [/^2\.2$/, "Contact the client to confirm their needs, the cover amount and term, and the options, then check the recommendation still fits."],
  [/^3\.1a$/, "Contact the client before any existing cover is cancelled, to compare the old and new plans."],
  [/^3\.1$/, "Contact the client to go through the Key Features: aims, commitments, risks, exclusions and how to claim."],
  [/^3\.2$/, "Contact the client to confirm the cost of each plan, including the total over the term, and any cheaper options."],
  [/^3\.3$/, "Write to the client confirming their right to cancel and the deadline."],
  [/^3\.4$/, "Contact the client to confirm the application answers and remind them of their duty to answer fully and accurately."],
  [/^3\.5$/, "Send the client the provider's privacy notice."],
  [/^3\.6$/, "Tell the client in writing about the identity check."],
  [/^4/, "If the client was told something wrong, correct it in writing."],
  [/^5/, "Complete the file documentation."],
  [/^6/, "Contact the client to confirm the medical answers are complete and accurate, and that they must tell the insurer about any changes before the policy starts."],
];

function putRight(ref: string | null): string {
  const r = ref ? baseRef(ref) : "";
  return PUT_RIGHT.find(([re]) => re.test(r))?.[1] ?? "Decide whether the client needs contacting.";
}

const redAction = (fix: string) => `Put right with the client: ${fix} Then go through it with the seller.`;
const amberAction = (fix: string) => `Go through it with the seller. If you would rather put it right with the client: ${fix}`;
const SCRIPT_ACTION = "For Guy: add or fix this in the script. Not counted against the seller.";

function words(s: string): Set<string> {
  return new Set(s.toLowerCase().match(/[a-z]{4,}/g) ?? []);
}
function overlap(a: string, b: string): number {
  const B = words(b);
  let n = 0;
  for (const w of Array.from(words(a))) if (B.has(w)) n++;
  return n;
}

const lower = (v: string) => v.replace(/_/g, " ").toLowerCase();

export function triage(g1: Partial<Gate1Result> | null, g2: Partial<Gate2Result> | null): Triage {
  const lines: TriageLine[] = [];
  const formLines: TriageLine[] = [];

  // 1. Openwork form standards, one line each.
  for (const k of g1?.observation?.checks ?? []) {
    if (k.result === "NOT_APPLICABLE") continue;
    const mandatory = k.mandatory || k.ref.includes("*");
    const shortfall = k.result === "FAIL" || k.result === "REVIEW_REQUIRED";
    const rag: Rag = k.script_gap && shortfall ? "script"
      : k.result === "FAIL" && mandatory ? "red"
      : shortfall ? "amber" : "green";
    const fix = putRight(k.ref);
    const line: TriageLine = {
      rag, area: areaFor(k.ref), ref: k.ref,
      title: k.result === "REVIEW_REQUIRED" ? `${k.requirement} (the checker couldn't tell: check the recording)` : k.requirement,
      why: rag === "green" ? "" : k.finding,
      points: [], evidence: k.evidence ?? [],
      action: rag === "red" ? redAction(fix) : rag === "amber" ? amberAction(fix) : rag === "script" ? SCRIPT_ACTION : "",
      order: orderFor(k.ref),
    };
    lines.push(line);
    if (rag !== "script") formLines.push(line);
  }

  // 2. Script statements: listed under the standard they belong to, so the
  // same shortfall isn't counted twice.
  for (const d of g1?.disclosures?.disclosures ?? []) {
    if (d.result === "DELIVERED_IN_FULL" || d.result === "NOT_APPLICABLE") continue;
    const point: TriagePoint = { label: d.name, result: lower(d.result), detail: d.differences, evidence: d.evidence ?? [] };
    const ref0 = d.form_refs[0] ?? null;
    if (d.script_gap) {
      lines.push({ rag: "script", area: areaFor(ref0), ref: ref0, title: d.name, why: d.differences, points: [], evidence: d.evidence ?? [], action: SCRIPT_ACTION, order: orderFor(ref0) });
      continue;
    }
    let candidates = formLines.filter((l) => l.ref && d.form_refs.includes(l.ref));
    if (candidates.length === 0) candidates = formLines.filter((l) => l.ref && d.form_refs.map(baseRef).includes(baseRef(l.ref)));
    const target = candidates
      .map((l) => ({ l, score: (l.rag === "green" ? 0 : 100) + overlap(d.name, l.title) }))
      .sort((a, b) => b.score - a.score)[0]?.l;
    if (target) {
      target.points.push(point);
      if (target.rag === "green") {
        target.rag = "amber";
        target.why = "The standard was met overall, but script wording under it was missed or only partly said.";
        target.action = amberAction(putRight(target.ref));
      }
    } else {
      const mandatory = d.form_refs.some((r) => r.includes("*"));
      const rag: Rag = d.result === "MISSING" && mandatory ? "red" : "amber";
      const fix = putRight(ref0);
      lines.push({
        rag, area: areaFor(ref0), ref: ref0, title: d.name, why: d.differences, points: [], evidence: d.evidence ?? [],
        action: rag === "red" ? redAction(fix) : amberAction(fix), order: orderFor(ref0),
      });
    }
  }

  // 3. The advice: the client's priorities, consistency and needs.
  const cons = g1?.consistency;
  const pf = cons?.priorities_followthrough;
  if (pf) {
    if (pf.recap.result !== "DONE") {
      lines.push({
        rag: "amber", area: "Advice", ref: null,
        title: pf.recap.result === "NOT_DONE" ? "Priorities and concerns not recapped at the end of the fact find" : "Priorities and concerns only partly recapped at the end of the fact find",
        why: pf.recap.finding, points: [], evidence: pf.recap.evidence ?? [],
        action: "Go through it with the seller.", order: 7,
      });
    }
    for (const p of pf.items) {
      const what = p.kind === "CONCERN" ? "concern" : "priority";
      const gap = p.addressed === "NO" ? "not addressed"
        : p.addressed === "PARTIAL" ? "only partly addressed"
        : p.quoted === "NO" ? "not quoted for" : null;
      if (!gap) continue;
      const red = p.addressed === "NO";
      lines.push({
        rag: red ? "red" : "amber", area: "Advice", ref: null,
        title: `Client's ${what} ${gap}: ${p.text}`, why: p.finding, points: [],
        evidence: [...(p.raised ?? []), ...(p.evidence ?? [])],
        action: red
          ? "Put right with the client: contact them about this, and either quote for it or record that they chose not to cover it. Then go through it with the seller."
          : "Go through it with the seller. Check the client's choice is recorded on the file.",
        order: 7.1,
      });
    }
  }
  for (const f of cons?.consistency?.findings ?? []) {
    const red = f.severity === "HIGH";
    lines.push({
      rag: red ? "red" : "amber", area: "Advice", ref: null, title: f.issue, why: f.explanation, points: [], evidence: f.evidence ?? [],
      action: red
        ? "Check the recommendation against what the client said. If it doesn't fit, contact the client to re-advise; if it does, note why on the file. Then go through it with the seller."
        : "Go through it with the seller.",
      order: 7.2,
    });
  }
  const nna = cons?.needs_not_addressed ?? [];
  if (nna.length > 0) {
    lines.push({
      rag: "amber", area: "Advice", ref: null, title: `Needs raised but not addressed (${nna.length})`, why: "",
      points: nna.map((n) => ({ label: n.need, result: "not addressed", detail: n.reason_given, evidence: n.evidence ?? [] })),
      evidence: [],
      action: "Check each one was quoted for, or that the client's choice not to cover it is on the file. Go through it with the seller.",
      order: 7.3,
    });
  }

  // 4. Gate 2: the suitability report against the calls.
  for (const f of g2?.suitability?.findings ?? []) {
    if (f.result === "MATCHES") continue;
    const red = f.result !== "REVIEW_REQUIRED";
    lines.push({
      rag: red ? "red" : "amber", area: "Suitability report", ref: null,
      title: `${lower(f.area)}: ${lower(f.result)}`, why: f.explanation, points: [], evidence: f.evidence ?? [],
      action: red ? "Correct the suitability report before it is issued." : "Check the report against the calls before it is issued.",
      order: 8,
    });
  }

  lines.sort((a, b) => a.order - b.order);
  const counts: Record<Rag, number> = { red: 0, amber: 0, green: 0, script: 0 };
  for (const l of lines) counts[l.rag]++;
  const verdict = counts.red > 0 ? "red" : counts.amber > 0 ? "amber" : "green";
  return { verdict, lines, counts };
}
