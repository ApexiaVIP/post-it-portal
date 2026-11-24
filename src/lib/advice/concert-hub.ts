/**
 * The Concert Hub page (Guy's screenshots, 24 Nov 2026): the few choices a
 * seller has to justify in Openwork's Concert Hub, in the order of its
 * screens, and three short notes. Safe to use in the browser.
 *
 * Concert Hub is mostly tick boxes and drop-downs, and those choices write
 * the suitability report, so each has to be backed by the Fact Find sheet.
 * Labels are Concert Hub's own wording.
 */

/** Protection screen: the need areas, marked identified or not for each client. */
export const HUB_NEEDS = [
  "mortgage_death", "mortgage_illness", "income_sickness", "dependants_death", "amount_illness", "funeral", "accident",
] as const;
export type HubNeed = (typeof HUB_NEEDS)[number];
export const HUB_NEED_LABEL: Record<HubNeed, string> = {
  mortgage_death: "Repay Mortgage on Death",
  mortgage_illness: "Repay Mortgage in the Event of Serious Illness",
  income_sickness: "Protect Income in the Event of Sickness",
  dependants_death: "Provide for Dependants on Death",
  amount_illness: "Provide an Amount in the Event of Serious Illness",
  funeral: "Provide for Funeral Expenses on Death",
  accident: "Provide a Lump Sum in the Event of Accident",
};

export const NEED_OUTCOMES = ["MET", "NOT_MET", "COVERED", "NOT_IDENTIFIED", "NOT_ON_SHEET"] as const;
export type NeedOutcome = (typeof NEED_OUTCOMES)[number];

/** Recommendation screen: the seven "Reasons Why - Provider" switches. */
export const PROVIDER_REASONS = [
  "additional_benefits", "cheapest_premium", "client_request", "health_issues", "most_comprehensive", "only_provider", "other",
] as const;
export type ProviderReason = (typeof PROVIDER_REASONS)[number];
export const PROVIDER_REASON_LABEL: Record<ProviderReason, string> = {
  additional_benefits: "Additional Benefits Provided",
  cheapest_premium: "Cheapest Premium Available",
  client_request: "Client Request",
  health_issues: "Existing Health Issues",
  most_comprehensive: "Most Comprehensive Cover Available",
  only_provider: "Only Provider Available",
  other: "Other",
};

/** Replacement screen. */
export const REPLACE_REASONS = ["amount_less", "amount_more", "term_less", "term_more", "other"] as const;
export type ReplaceReason = (typeof REPLACE_REASONS)[number];
export const REPLACE_REASON_LABEL: Record<ReplaceReason, string> = {
  amount_less: "Existing Benefit Amount is Less Than the Need",
  amount_more: "Existing Benefit Amount Exceeds the Need",
  term_less: "Existing Term is Less Than the Need",
  term_more: "Existing Term Exceeds the Need",
  other: "Other",
};
export const REPLACE_LOSSES = ["none", "guaranteed_rate", "renewability", "convertibility", "tpd", "trust", "other"] as const;
export type ReplaceLoss = (typeof REPLACE_LOSSES)[number];
export const REPLACE_LOSS_LABEL: Record<ReplaceLoss, string> = {
  none: "No Consequences",
  guaranteed_rate: "Loss of Guaranteed Rate",
  renewability: "Loss of Renewability",
  convertibility: "Loss of Convertability",
  tpd: "Loss of TPD (Total Permanent Disability)",
  trust: "Loss of Trust",
  other: "Other",
};

/** Concert Hub's drop-downs, as its screens list them (James Evans, 24 Nov 2026). None has an Other. */
const AGAINST_NEED = ["Less Than Need", "Matches Need", "Exceeds Need"];
export const HUB_DROPDOWNS = {
  deferred_period: {
    label: "Deferred Period Required for any Income Protection",
    options: ["0 Weeks", "1 Week", "2 Weeks", "1 Month", "2 Months", "3 Months", "6 Months", "12 Months", "24 Months"],
  },
  benefit_amount: { label: "Benefit Amount", options: AGAINST_NEED },
  product_term: { label: "Product Term", options: AGAINST_NEED },
  reason_not_addressed: {
    label: "Reason Not Addressed",
    options: [
      "Recommendation on Another Engagement", "In Progress", "Rejected Recommendation", "Existing Arrangements to Meet the Need",
      "Adverse Health", "Not Eligible", "Insufficient Income", "Not Interested in Discussing", "Topping Up Existing Provision",
    ],
  },
};
/** What a need already covered goes down as: identified, and met by what they have. */
export const ALREADY_COVERED = "Existing Arrangements to Meet the Need";
export type HubDropdown = keyof typeof HUB_DROPDOWNS;

/** A drop-down option as Concert Hub words it, or "" if it isn't one we know of. */
export function hubOption(d: HubDropdown, pick: string): string {
  const p = pick.trim().toLowerCase();
  return p ? HUB_DROPDOWNS[d].options.find((o) => o.toLowerCase() === p) ?? "" : "";
}

/** Notes screen: the Note Types used, in place of the seven headings in Guy's instructions. */
export const HUB_NOTES = ["needs", "outgoings", "recommendation"] as const;
export type HubNote = (typeof HUB_NOTES)[number];
export const HUB_NOTE_LABEL: Record<HubNote, string> = { needs: "Needs", outgoings: "Outgoings", recommendation: "Recommendation" };
export const HUB_NOTE_HOLDS: Record<HubNote, string> = {
  needs: "who the clients are and who relies on them, what the money is for and until when, in the client's words, their priorities, and existing cover",
  outgoings: "income, outgoings and what is left over, savings and emergency fund, the budget and how it was set, and affordability now and, where the term runs past it, in retirement",
  recommendation: "policy by policy, why it meets the need and why that sum assured, term and trust; the other options considered, with the premiums quoted and why not; what the client decided and how they showed they understood; the needs not met, what they were told and any follow up",
};

export interface HubPage {
  needs: { client: string; need: HubNeed; outcome: NeedOutcome; met_by: string; pick: string; why: string }[];
  deferred: { client: string; period: string; why: string }[];
  policies: {
    policy: string; client: string; product: string;
    amount_pick: string; amount_why: string; term_pick: string; term_why: string;
    trust: string; extras: string;
    provider: string; provider_reasons: ProviderReason[]; provider_why: string;
  }[];
  replacements: {
    policy: string; still_suitable: "YES" | "NO" | "NOT_ON_SHEET"; reasons: ReplaceReason[];
    facilitate: "YES" | "NO" | "NOT_ON_SHEET"; losses: ReplaceLoss[]; outweigh: string;
  }[];
  notes: Record<HubNote, string>;
  /** Not a Concert Hub field: for the under budget red line. */
  budget: { agreed: string; premiums: string; unused_why: string };
}
export const EMPTY_HUB: HubPage = { needs: [], deferred: [], policies: [], replacements: [], notes: { needs: "", outgoings: "", recommendation: "" }, budget: { agreed: "", premiums: "", unused_why: "" } };

export function hubFilled(h: HubPage | null | undefined): h is HubPage {
  return !!h && (h.needs?.length > 0 || h.policies?.length > 0);
}
export const hubClients = (h: HubPage): string[] => Array.from(new Set(h.needs.map((n) => n.client)));
export const unmet = (h: HubPage) => h.needs.filter((n) => n.outcome === "NOT_MET");
/** Identified, with no recommendation for it: Concert Hub's Needs Validation screen. */
export const notAddressed = (h: HubPage) => h.needs.filter((n) => n.outcome === "NOT_MET" || n.outcome === "COVERED");
/** The needs a recommended policy meets, for its Need Areas Addressed. */
export function addressedBy(h: HubPage, p: HubPage["policies"][number]): { client: string; need: HubNeed }[] {
  return h.needs.filter((n) => n.outcome === "MET"
    && n.met_by.split(/,|\band\b|&/).some((m) => m.trim().toLowerCase() === p.policy.trim().toLowerCase())
    && p.client.toLowerCase().split(/,|\band\b|&/).some((c) => c.trim() === n.client.trim().toLowerCase()));
}

/** "[to complete after speaking to the client: ...]" is never an answer. */
const PLACEHOLDER = /\[to complete[^\]]*\]/gi;
const said = (s: string | undefined) => (s ?? "").replace(PLACEHOLDER, "").trim();

/**
 * Holds the page to the sheet: a drop-down choice is one Concert Hub has and
 * comes with the reason that backs it, and every need is there for each client.
 */
export function settleHub(h: HubPage): HubPage {
  if (!hubFilled(h)) return EMPTY_HUB;
  const needs = h.needs.map((n) => {
    const why = said(n.why);
    const pick = !why ? "" : n.outcome === "COVERED" ? ALREADY_COVERED : n.outcome === "NOT_MET" ? hubOption("reason_not_addressed", n.pick) : "";
    return { ...n, why, met_by: n.outcome === "MET" ? n.met_by : "", pick };
  });
  for (const client of hubClients(h)) {
    for (const need of HUB_NEEDS) {
      if (!needs.some((n) => n.client === client && n.need === need)) needs.push({ client, need, outcome: "NOT_ON_SHEET", met_by: "", pick: "", why: "" });
    }
  }
  const wantsPeriod = hubClients(h).filter((c) => needs.some((n) => n.client === c && n.need === "income_sickness" && (n.outcome === "MET" || n.outcome === "NOT_MET")));
  return {
    ...h,
    needs: needs.sort((a, b) => HUB_NEEDS.indexOf(a.need) - HUB_NEEDS.indexOf(b.need)),
    deferred: wantsPeriod.map((client) => {
      const d = h.deferred.find((x) => x.client === client);
      return { client, period: hubOption("deferred_period", said(d?.period)), why: said(d?.why) };
    }),
    policies: h.policies.map((p) => {
      const amount_why = said(p.amount_why);
      const term_why = said(p.term_why);
      return {
        ...p, amount_why, term_why, trust: said(p.trust), extras: said(p.extras), provider_why: said(p.provider_why),
        amount_pick: amount_why ? hubOption("benefit_amount", p.amount_pick) : "",
        term_pick: term_why ? hubOption("product_term", p.term_pick) : "",
      };
    }),
    replacements: h.replacements.map((r) => ({ ...r, outweigh: said(r.outweigh) })),
    budget: { ...h.budget, unused_why: said(h.budget?.unused_why) },
    // Nothing in a note but what happened: it's pasted as it stands.
    notes: Object.fromEntries(HUB_NOTES.map((k) => [k, (h.notes?.[k] ?? "").replace(PLACEHOLDER, "[to complete after speaking to the client]").trim()])) as HubPage["notes"],
  };
}

/** "£70 a month" as 70. */
function figure(s: string | undefined): number | null {
  const m = (s ?? "").replace(/,/g, "").match(/\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

/**
 * The red line for needs left uncovered. The reason goes into the suitability
 * report, so it has to be on the sheet, and TopQuote's guide makes under
 * budget with a need left uncovered a fail unless the reason is recorded.
 */
export function uncoveredRedLine(h: HubPage): string | null {
  const left = unmet(h);
  const list = left.filter((n) => !n.why);
  const agreed = figure(h.budget?.agreed);
  const total = figure(h.budget?.premiums);
  const spare = agreed !== null && total !== null && left.length > 0 && !h.budget.unused_why.trim() ? agreed - total : 0;
  const unused = spare > 0 ? `The premiums are £${spare.toFixed(2)} under the £${agreed!.toFixed(2)} budget` : "";
  if (list.length === 0) return unused ? `${unused}, with needs left uncovered. Use the rest, or put on the sheet why not.` : null;
  const which = HUB_NEEDS.filter((need) => list.some((n) => n.need === need))
    .map((need) => `${HUB_NEED_LABEL[need]} (${list.filter((n) => n.need === need).map((n) => n.client).join(", ")})`).join("; ");
  return `Put on the sheet why ${list.length === 1 ? "this need isn't" : "these needs aren't"} covered, in the client's words: ${which}. If you don't know, ask them.${unused ? ` ${unused}, so use the rest or say why not.` : ""}`;
}

/** The deferred period is on the sheet only where income protection is recommended. Otherwise it follows their sick pay. */
export function deferredFor(h: HubPage, client: string): "sheet" | "sick_pay" {
  return h.needs.some((n) => n.client === client && n.need === "income_sickness" && n.outcome === "MET") ? "sheet" : "sick_pay";
}

/** Everything else on the page the sheet doesn't back up yet. */
export function hubGaps(h: HubPage | null | undefined): number {
  if (!hubFilled(h)) return 0;
  return h.needs.filter((n) => n.outcome === "NOT_ON_SHEET" || (n.outcome === "COVERED" && !n.why) || (n.outcome === "NOT_MET" && n.why && !n.pick)).length
    + h.deferred.filter((d) => !d.period.trim() && (deferredFor(h, d.client) === "sheet" || !d.why.trim())).length
    + h.policies.reduce((n, p) => n + [p.amount_pick, p.term_pick, p.trust, p.extras, p.provider_reasons.length ? "x" : ""].filter((v) => !v.trim()).length, 0)
    + h.replacements.reduce((n, r) => n + (r.still_suitable === "NOT_ON_SHEET" ? 1 : 0) + (r.facilitate === "NOT_ON_SHEET" ? 1 : 0)
        + (r.losses.length ? 0 : 1) + (r.outweigh.trim() ? 0 : 1) + (r.still_suitable === "NO" && !r.reasons.length ? 1 : 0), 0);
}

const NOT_ON_SHEET = "not on the sheet";
const yn = (v: "YES" | "NO" | "NOT_ON_SHEET") => (v === "YES" ? "Yes" : v === "NO" ? "No" : NOT_ON_SHEET);

/** The page as plain text: for copying, and for the check against the calls. */
export function hubText(h: HubPage | null | undefined): string {
  if (!hubFilled(h)) return "";
  const out: string[] = [];
  out.push("PROTECTION", ...h.needs.map((n) => {
    const what = n.outcome === "MET" ? `Identified, met by ${n.met_by || "the recommendation"}`
      : n.outcome === "NOT_MET" ? `Identified, not met. Reason: ${[n.pick, n.why].filter(Boolean).join(". ") || NOT_ON_SHEET}`
      : n.outcome === "COVERED" ? `Identified, already covered (${ALREADY_COVERED})` : n.outcome === "NOT_IDENTIFIED" ? "Not identified" : NOT_ON_SHEET;
    return `${n.client}, ${HUB_NEED_LABEL[n.need]}: ${what}${n.outcome !== "NOT_MET" && n.why ? `. ${n.why}` : ""}`;
  }), ...h.deferred.map((d) => `${d.client}, deferred period: ${d.period || NOT_ON_SHEET}${d.why ? `. ${d.why}` : ""}`));
  for (const p of h.policies) {
    out.push("", `${p.policy.toUpperCase()}, ${p.client}: ${p.product}`,
      `Reason for the amount: ${[p.amount_pick, p.amount_why].filter(Boolean).join(". ") || NOT_ON_SHEET}`,
      `Reason for the term: ${[p.term_pick, p.term_why].filter(Boolean).join(". ") || NOT_ON_SHEET}`,
      `Held in trust: ${p.trust || NOT_ON_SHEET}`,
      `Additional benefits: ${p.extras || NOT_ON_SHEET}`,
      `Reasons for the provider${p.provider ? ` (${p.provider})` : ""}: ${[p.provider_reasons.map((r) => PROVIDER_REASON_LABEL[r]).join(", "), p.provider_why].filter(Boolean).join(". ") || NOT_ON_SHEET}`);
  }
  for (const r of h.replacements) {
    out.push("", `REPLACING: ${r.policy}`,
      `Still suitable: ${yn(r.still_suitable)}`, `Why replace: ${r.reasons.map((x) => REPLACE_REASON_LABEL[x]).join(", ") || NOT_ON_SHEET}`,
      `Features that can be used instead: ${yn(r.facilitate)}`, `Consequences: ${r.losses.map((x) => REPLACE_LOSS_LABEL[x]).join(", ") || NOT_ON_SHEET}`,
      `Why the benefits outweigh the disadvantages: ${r.outweigh || NOT_ON_SHEET}`);
  }
  for (const k of HUB_NOTES) if (h.notes[k]) out.push("", `NOTE: ${HUB_NOTE_LABEL[k].toUpperCase()}`, h.notes[k]);
  return out.join("\n");
}
