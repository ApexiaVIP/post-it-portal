/**
 * Call QA summary (Poz and Guy, 19 Nov 2026). The full report runs to about
 * 60 pages and lists the same shortfall in several places, and a list of
 * failures still leaves Pauline to work out what to do about each one. So
 * every issue is given a route, and each sale comes down to one decision:
 *
 *   callback  the seller calls the client back and covers it. Sales sit in
 *             Not Yet Submitted for about two days, so most shortfalls can
 *             be put right before the application goes to the insurer.
 *   decide    only Pauline can settle it (vulnerability, the suitability
 *             report).
 *   coach     no client contact needed: a learning point for the seller.
 *   script    the script doesn't cover it: for Guy, not the seller.
 *   met       nothing to do.
 *
 * It reads the checker's existing results, so a sale needs no re-run.
 * Red / amber / green is kept as the at-a-glance rating: red follows
 * Openwork's rule that failing an asterisked standard fails the section,
 * plus a client priority left unaddressed, a consistency finding the
 * checker rated high, and a suitability report that doesn't match the calls.
 */
import type { EvidenceItem, Gate1Result, Gate2Result } from "./schemas";

export type Rag = "red" | "amber" | "green" | "script";
export type Route = "callback" | "decide" | "coach" | "script" | "met";
/**
 * "letter" holds points only the draft suitability report needs (see lib/qa/letter.ts);
 * "notes" holds the seller's advice check statements the calls don't back up (lib/qa/notes-check.ts).
 */
export type Topic = "needs" | "options" | "plan" | "rights" | "application" | "notes" | "letter";

export const TOPIC_LABEL: Record<Topic, string> = {
  needs: "Their needs, budget and cover",
  options: "The options for their cover",
  plan: "The plan you recommended",
  rights: "Their rights and our disclosures",
  application: "The application and medical answers",
  notes: "Your notes against the call",
  letter: "For the suitability report",
};
const TOPIC_ORDER: Topic[] = ["needs", "options", "plan", "rights", "application"];

export interface TriagePoint {
  label: string;
  result: string;
  detail: string;
  evidence: EvidenceItem[];
}

export interface TriageLine {
  rag: Rag;
  route: Route;
  /** Part of the call, e.g. "Fact find". */
  area: string;
  /** Openwork form reference, e.g. "3.1*". */
  ref: string | null;
  title: string;
  why: string;
  /** Script statements under this standard that were missed or only partly said. */
  points: TriagePoint[];
  evidence: EvidenceItem[];
  /** What the seller covers with the client on the callback. */
  ask: string;
  /** Lines with the same key are one item on the callback list. */
  askKey: string;
  /** The specifics under the ask: script wording missed, or the issue found. */
  details: string[];
  topic: Topic | null;
  /** About the advice itself: once the client has been called, check the recommendation still fits. */
  adviceCheck: boolean;
  /** For "decide" lines: what Pauline is deciding. */
  action: string;
  order: number;
}

export type Outcome = "clear" | "callback" | "callback_review" | "decide";

export interface Triage {
  verdict: "red" | "amber" | "green";
  outcome: Outcome;
  lines: TriageLine[];
  counts: Record<Rag, number>;
  routes: Record<Route, number>;
  /** The callback list, grouped by topic in the order a callback would run. */
  callback: { topic: Topic; label: string; items: CallbackItem[] }[];
}

export interface CallbackItem {
  ask: string;
  details: string[];
  evidence: EvidenceItem[];
  adviceCheck: boolean;
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

function topicFor(ref: string | null): Topic | null {
  if (!ref) return null;
  const r = baseRef(ref);
  if (r.startsWith("1")) return "rights";
  if (r.startsWith("2.1")) return "needs";
  if (r.startsWith("2.2")) return ref.includes("*") ? "needs" : "options";
  if (/^3\.(1|2)/.test(r) || r.startsWith("4")) return "plan";
  if (/^3\.(3|5|6)/.test(r)) return "rights";
  if (r.startsWith("3.4") || r.startsWith("6")) return "application";
  return null;
}

// What the seller covers on the callback, by form standard.
function askFor(ref: string | null, title: string): string {
  const r = ref ? baseRef(ref) : "";
  const starred = !!ref?.includes("*");
  if (r === "1.1") return "Remind them who you are and that calls are recorded.";
  if (r === "1.2") return "Check they are happy to get the full details by email, and send them.";
  if (r === "1.3") return "Explain the service we provide, how we are paid, how to complain and the FSCS.";
  if (r === "1.4") return "Explain how we use their data and that the privacy notice is coming.";
  if (r === "2.1") return `Ask about ${title.replace(/\s*\(.*\)\s*$/, "").toLowerCase()} and update the fact find.`;
  if (r === "2.2" && starred) return "Confirm what they need the cover for, and that the amount, type and term fit.";
  if (r === "2.2") return "Explain and offer the options: waiver of premium, TPD, indexation, guaranteed or reviewable premiums, trusts, and cover into retirement where relevant.";
  if (r === "3.1a") return "Compare the old and new plans, and tell them not to cancel the old cover until the new one is in force.";
  if (r.startsWith("3.1")) return "Go through the Key Features: aims, commitments, risks, exclusions and how to claim.";
  if (r.startsWith("3.2")) return "Confirm the monthly cost, the total over the term, and any cheaper options.";
  if (r.startsWith("3.3")) return "Explain their right to cancel and the deadline.";
  if (r.startsWith("3.4")) return "Remind them to answer the application fully and accurately, and what happens if they don't.";
  if (r.startsWith("3.5")) return "Tell them the insurer's privacy notice is coming.";
  if (r.startsWith("3.6")) return "Explain the identity check.";
  if (r.startsWith("4")) return "Correct anything you told them that was wrong.";
  if (r.startsWith("6")) return "Read back the medical answers, confirm they are complete and accurate, and remind them to tell the insurer about any changes before the policy starts.";
  return `Cover: ${title}.`;
}

// Words too common in the checker's wording to show two points are the same.
const STOP = new Set(["mandatory", "form", "item", "icobs", "script", "client", "clients", "adviser", "call", "with", "that", "this", "were", "from", "fully", "their", "about", "before", "after", "only", "partly", "addressed", "explained", "explain", "delivered", "requirements", "openwork", "asked", "question", "questions"]);

function words(s: string): Set<string> {
  return new Set((s.toLowerCase().match(/[a-z]{4,}/g) ?? []).filter((w) => !STOP.has(w)));
}
function overlap(a: string, b: string): number {
  const B = words(b);
  let n = 0;
  for (const w of Array.from(words(a))) if (B.has(w)) n++;
  return n;
}

const lower = (v: string) => v.replace(/_/g, " ").toLowerCase();
const ADVICE_ASK = "Go back over their needs and priorities with them. For each point below, put it right, quote for it, or note their choice.";

function shorten(s: string, max = 200): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 10);
  return `${s.slice(0, cut > 0 ? cut : max)}…`;
}
const VULNERABILITY = /special care|support for your client|vulnerab/i;

function blank(over: Partial<TriageLine> & Pick<TriageLine, "rag" | "route" | "area" | "title" | "order">): TriageLine {
  return { ref: null, why: "", points: [], evidence: [], ask: "", askKey: "", details: [], topic: null, adviceCheck: false, action: "", ...over };
}

export function triage(g1: Partial<Gate1Result> | null, g2: Partial<Gate2Result> | null): Triage {
  const lines: TriageLine[] = [];
  const formLines: TriageLine[] = [];

  // 1. Openwork form standards, one line each.
  for (const k of g1?.observation?.checks ?? []) {
    if (k.result === "NOT_APPLICABLE") continue;
    const mandatory = k.mandatory || k.ref.includes("*");
    const ref = mandatory && !k.ref.includes("*") ? `${k.ref}*` : k.ref;
    const shortfall = k.result === "FAIL" || k.result === "REVIEW_REQUIRED";
    const rag: Rag = k.script_gap && shortfall ? "script"
      : k.result === "FAIL" && mandatory ? "red"
      : shortfall ? "amber" : "green";
    const line = blank({
      rag, route: "met", area: areaFor(ref), ref,
      title: k.requirement,
      why: rag === "green" ? "" : k.result === "REVIEW_REQUIRED" ? `The checker couldn't tell from the call. ${k.finding}` : k.finding,
      evidence: k.evidence ?? [], order: orderFor(ref),
    });
    (line as TriageLine & { review?: boolean }).review = k.result === "REVIEW_REQUIRED";
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
      lines.push(blank({ rag: "script", route: "script", area: areaFor(ref0), ref: ref0, title: d.name, why: d.differences, evidence: d.evidence ?? [], order: orderFor(ref0) }));
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
      }
    } else {
      const mandatory = d.form_refs.some((r) => r.includes("*"));
      lines.push(blank({
        rag: d.result === "MISSING" && mandatory ? "red" : "amber", route: "met", area: areaFor(ref0), ref: ref0,
        title: d.name, why: d.differences, evidence: d.evidence ?? [], order: orderFor(ref0),
      }));
    }
  }

  // Routes for the form and script lines.
  for (const l of lines) {
    if (l.rag === "script") { l.route = "script"; continue; }
    if (l.rag === "green") { l.route = "met"; continue; }
    const review = (l as TriageLine & { review?: boolean }).review === true;
    const r = l.ref ? baseRef(l.ref) : "";
    const starred = !!l.ref?.includes("*");
    if (r.startsWith("2.1") && VULNERABILITY.test(l.title)) {
      l.route = "decide";
      l.action = "Decide whether the client needs extra support, or a different approach, before this goes any further.";
    } else if (l.rag === "red" || starred || r.startsWith("2.2") || r === "3.1a" || (r.startsWith("4") && !review)) {
      l.route = "callback";
      l.topic = topicFor(l.ref);
      l.ask = askFor(l.ref, l.title);
      l.askKey = l.ask;
      l.details = r.startsWith("4") ? [shorten(l.why)]
        : l.points.map((p) => p.label.replace(/\s*\((MANDATORY|form item)[^)]*\)\s*/gi, " ").replace(/\s+/g, " ").trim());
      l.adviceCheck = r.startsWith("2.2") && starred && l.rag === "red";
    } else {
      l.route = "coach";
    }
  }

  // 3. The advice: the client's priorities, consistency and needs.
  const cons = g1?.consistency;
  const pf = cons?.priorities_followthrough;
  if (pf) {
    if (pf.recap.result !== "DONE") {
      lines.push(blank({
        rag: "amber", route: "coach", area: "Advice", order: 7,
        title: pf.recap.result === "NOT_DONE" ? "Priorities and concerns not recapped at the end of the fact find" : "Priorities and concerns only partly recapped at the end of the fact find",
        why: pf.recap.finding, evidence: pf.recap.evidence ?? [],
      }));
    }
    for (const p of pf.items) {
      const what = p.kind === "CONCERN" ? "concern" : "priority";
      const gap = p.addressed === "NO" ? "not addressed"
        : p.addressed === "PARTIAL" ? "only partly addressed"
        : p.quoted === "NO" ? "not quoted for" : null;
      if (!gap) continue;
      lines.push(blank({
        rag: p.addressed === "NO" ? "red" : "amber", route: "callback", area: "Advice", order: 7.1,
        title: `Client's ${what} ${gap}: ${p.text}`, why: p.finding,
        evidence: [...(p.raised ?? []), ...(p.evidence ?? [])],
        topic: "needs", adviceCheck: p.addressed === "NO",
        ask: ADVICE_ASK, askKey: "advice", details: [`Their ${what} ${gap}: ${p.text}`],
      }));
    }
  }
  for (const f of cons?.consistency?.findings ?? []) {
    const red = f.severity === "HIGH";
    lines.push(blank({
      rag: red ? "red" : "amber", route: red ? "callback" : "coach", area: "Advice", order: 7.2,
      title: f.issue, why: f.explanation, evidence: f.evidence ?? [],
      topic: red ? "needs" : null, adviceCheck: red,
      ask: red ? ADVICE_ASK : "", askKey: red ? "advice" : "", details: red ? [f.issue.replace(/\.$/, "")] : [],
    }));
  }
  const nna = cons?.needs_not_addressed ?? [];
  if (nna.length > 0) {
    lines.push(blank({
      rag: "amber", route: "callback", area: "Advice", order: 7.3,
      title: `Needs raised but not addressed (${nna.length})`,
      points: nna.map((n) => ({ label: n.need, result: "not addressed", detail: n.reason_given, evidence: n.evidence ?? [] })),
      topic: "needs", ask: ADVICE_ASK, askKey: "advice",
      details: nna.map((n) => `Need not addressed: ${n.need}`),
    }));
  }

  // 4. Gate 2: the suitability report against the calls. Fixed in the report, not with the client.
  for (const f of g2?.suitability?.findings ?? []) {
    if (f.result === "MATCHES") continue;
    const red = f.result !== "REVIEW_REQUIRED";
    lines.push(blank({
      rag: red ? "red" : "amber", route: "decide", area: "Suitability report", order: 8,
      title: `${lower(f.area)}: ${lower(f.result)}`, why: f.explanation, evidence: f.evidence ?? [],
      action: red ? "Correct the suitability report before it is issued." : "Check the report against the calls before it is issued.",
    }));
  }

  // An advice point that repeats a standard already on the callback list
  // (the Key Features, the replacement comparison...) goes under that item
  // instead of being asked twice.
  const formCallback = lines.filter((l) => l.route === "callback" && l.area !== "Advice");
  for (const l of lines.filter((x) => x.route === "callback" && x.askKey === "advice" && !x.title.startsWith("Needs raised"))) {
    const best = formCallback
      .map((f) => ({ f, score: overlap(l.title, `${f.title} ${f.points.map((p) => p.label).join(" ")}`) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 2) {
      l.topic = best.f.topic;
      l.ask = best.f.ask;
      l.askKey = best.f.askKey;
      l.adviceCheck = false;
    }
  }

  lines.sort((a, b) => a.order - b.order);
  const counts: Record<Rag, number> = { red: 0, amber: 0, green: 0, script: 0 };
  const routes: Record<Route, number> = { callback: 0, decide: 0, coach: 0, script: 0, met: 0 };
  for (const l of lines) { counts[l.rag]++; routes[l.route]++; }
  const verdict = counts.red > 0 ? "red" : counts.amber > 0 ? "amber" : "green";

  const cb = lines.filter((l) => l.route === "callback");
  const callback = TOPIC_ORDER.map((topic) => {
    const items: CallbackItem[] = [];
    const byKey = new Map<string, CallbackItem>();
    for (const l of cb.filter((x) => (x.topic ?? "needs") === topic)) {
      const key = l.askKey || l.ask;
      let item = byKey.get(key);
      if (!item) {
        item = { ask: l.ask, details: [], evidence: [], adviceCheck: false };
        byKey.set(key, item);
        items.push(item);
      }
      for (const d of l.details) if (d && !item.details.includes(d)) item.details.push(d);
      if (l.evidence[0]) item.evidence.push(l.evidence[0]);
      item.adviceCheck = item.adviceCheck || l.adviceCheck;
    }
    // The advice re-check runs last in its section, after the specific questions.
    items.sort((a, b) => Number(a.ask === ADVICE_ASK) - Number(b.ask === ADVICE_ASK));
    return { topic, label: TOPIC_LABEL[topic], items };
  }).filter((g) => g.items.length > 0);
  const outcome: Outcome = routes.decide > 0 ? "decide"
    : cb.some((l) => l.adviceCheck) ? "callback_review"
    : cb.length > 0 ? "callback" : "clear";
  return { verdict, outcome, lines, counts, routes, callback };
}

/**
 * The callback list as the seller receives it: what to cover with the
 * client, grouped by topic, with where it came up in the call, then the
 * learning points that need no client contact.
 */
export function callbackListText(t: Triage): string {
  const out: string[] = [];
  let n = 0;
  for (const g of t.callback) {
    out.push(g.label.toUpperCase());
    for (const item of g.items) {
      n++;
      const e = item.evidence[0];
      out.push(`${n}. ${item.ask}${e ? ` (call ${e.call} at ${e.time})` : ""}`);
      for (const d of item.details) out.push(`   - ${d}`);
    }
    out.push("");
  }
  const coach = t.lines.filter((l) => l.route === "coach");
  if (coach.length > 0) {
    out.push("FOR NEXT TIME (no need to contact the client about these)");
    for (const l of coach) out.push(`- ${l.ref ? `${l.ref} ` : ""}${l.title}`);
  }
  return out.join("\n").trim();
}
