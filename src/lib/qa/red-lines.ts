/**
 * The red lines of a call report (Guy and Poz, 24 Nov 2026): the few points
 * that decide whether the sale gets through compliance. The call check's
 * shortfalls are numbered, the priorities picked out from them, and the
 * callback list cut down to those. Safe to use in the browser.
 *
 * A failed mandatory (asterisked) standard fails its section on Openwork's
 * form, so one that was left off is always put back.
 */
import { TOPIC_LABEL, type CallbackItem, type Topic, type Triage, type TriageLine } from "./triage";
import type { RedLinesResult, RedLinesRunResult } from "./schemas";

/** The points a red line can come from, numbered P1, P2... in report order. */
export function numberedLines(t: Triage): Map<string, TriageLine> {
  const out = new Map<string, TriageLine>();
  let n = 0;
  for (const l of t.lines) {
    if (l.area === "Suitability report") continue;
    if (l.route === "callback" || l.route === "coach" || l.route === "decide") out.set(`P${++n}`, l);
  }
  return out;
}

/** The points as the red lines check is given them. */
export function redLinesMaterial(t: Triage): string {
  return Array.from(numberedLines(t)).map(([id, l]) => [
    `${id}. ${l.ref ? `[form ${l.ref}${l.ref.includes("*") ? ", mandatory" : ""}] ` : ""}[${l.area}] [rated ${l.rag}] ${l.title}`,
    ...(l.why ? [`   Finding: ${l.why}`] : []),
    ...l.points.map((p) => `   Script wording ${p.result}: ${p.label}${p.detail ? ` (${p.detail})` : ""}`),
    ...l.details.filter((d) => !l.points.some((p) => p.label.startsWith(d.slice(0, 20)))).map((d) => `   ${d}`),
  ].join("\n")).join("\n");
}

const TOPIC: Record<RedLinesResult["items"][number]["area"], Topic> = {
  NEED: "needs", OPTIONS: "options", ADVICE: "plan", DISCLOSURES: "rights", APPLICATION: "application",
};
const AREA_OF: Partial<Record<Topic, RedLinesResult["items"][number]["area"]>> = {
  needs: "NEED", options: "OPTIONS", plan: "ADVICE", rights: "DISCLOSURES", application: "APPLICATION",
};

/** Puts back any failed mandatory standard the red lines left off. */
export function completeRedLines(t: Triage, red: RedLinesResult): RedLinesResult {
  const byId = numberedLines(t);
  const items = red.items.map((x) => ({ ...x, covers: x.covers.filter((c) => byId.has(c)) }));
  const covered = new Set(items.flatMap((x) => x.covers));
  const left = Array.from(byId).filter(([id, l]) => !covered.has(id) && l.route === "callback" && l.rag === "red" && !!l.ref?.includes("*"));
  return {
    ...red,
    items: [...items, ...left.map(([id, l]) => ({
      action: l.ask, why: l.title, area: AREA_OF[l.topic ?? "needs"] ?? ("NEED" as const), points: l.details.slice(0, 3), covers: [id],
    }))],
  };
}

/** The red lines run, if it read this call check. */
export function currentRedLines(run: { id: number; status: string; result: unknown } | null | undefined, gate1RunId: number | null | undefined):
  { id: number; red: RedLinesResult } | null {
  const r = run?.status === "done" ? (run.result as RedLinesRunResult | null) : null;
  return run && r && gate1RunId && r.from_run === gate1RunId ? { id: run.id, red: r.red } : null;
}

/** Cuts the callback list down to the red lines. */
export function withRedLines(t: Triage, cur: { red: RedLinesResult } | null): Triage {
  if (!cur) return t;
  const byId = numberedLines(t);
  const red = completeRedLines(t, cur.red);
  const covered = new Set(red.items.flatMap((x) => x.covers));
  const groups: { topic: Topic; label: string; items: CallbackItem[] }[] = [];
  // Most serious first: the groups come in the order their first red line does.
  for (const x of red.items) {
    const lines = x.covers.map((c) => byId.get(c)).filter((l): l is TriageLine => !!l);
    // A point only Pauline can settle stays in her own section.
    if (lines.length > 0 && lines.every((l) => l.route === "decide")) continue;
    const topic = TOPIC[x.area];
    let g = groups.find((y) => y.topic === topic);
    if (!g) { g = { topic, label: TOPIC_LABEL[topic], items: [] }; groups.push(g); }
    g.items.push({
      ask: x.action, why: x.why, details: x.points,
      evidence: lines.flatMap((l) => l.evidence.slice(0, 1)).slice(0, 3),
      adviceCheck: lines.some((l) => l.adviceCheck),
    });
  }
  const smaller = Array.from(byId).filter(([id, l]) => l.route === "callback" && !covered.has(id)).map(([, l]) => l);
  return {
    ...t,
    callback: groups,
    red: { summary: red.summary, coaching: red.coaching.slice(0, 3) },
    smaller,
    outcome: t.routes.decide > 0 ? "decide"
      : groups.some((g) => g.items.some((i) => i.adviceCheck)) ? "callback_review"
      : groups.length > 0 ? "callback" : "clear",
  };
}
