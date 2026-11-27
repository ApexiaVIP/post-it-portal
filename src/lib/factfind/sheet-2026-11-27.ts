/**
 * TopQuote Fact Find data capture sheet, issued 20 Nov 2026 (Guy), laid out
 * on 27 Nov 2026 to match the paper question for question and in its order.
 * Sellers complete the paper on the call and type it in at the end, and
 * Openwork needn't approve the online form as long as it is the same as the
 * paper, in the same order (Guy, 26 Nov 2026).
 *
 * So the only differences are these. First names and ages replace surnames,
 * dates of birth, addresses and postcodes, which go straight into Concert.
 * The policy pages take any number of policies. Every box the paper has no
 * room for (needed by the advice check or Concert Hub) is in "Not on the paper
 * sheet" near the end, or at the foot of each policy card, and "After the
 * advice call" comes last. Answers are stored under the same keys as the
 * 20 Nov layout, so the checks read both the same way.
 */
import type { Block, Data, Field, Policy, Row, Sheet } from "./types";
import { HUB_DROPDOWNS } from "@/lib/advice/concert-hub";
import { blank, hasDependants, hasLife2, money, rowsOf, sumRows } from "./values";

const text = (key: string, label: string, hint?: string): Field => ({ key, label, input: { kind: "text", hint } });
const long = (key: string, label: string, rows = 2): Field => ({ key, label, input: { kind: "long", rows } });
const words = (key: string, label: string, must?: Field["must"]): Field => ({ key, label, input: { kind: "long", rows: 2, quote: true }, must });
const pounds = (key: string, label: string, per?: string): Field => ({ key, label, input: { kind: "money", per } });
const num = (key: string, label: string, unit?: string): Field => ({ key, label, input: { kind: "number", unit } });
const yn = (key: string, label: string): Field => ({ key, label, input: { kind: "yesno" } });
const one = (key: string, label: string, ...options: string[]): Field => ({ key, label, input: { kind: "one", options } });
const many = (key: string, label: string, ...options: string[]): Field => ({ key, label, input: { kind: "many", options } });
const must = (f: Field, when: Field["must"] = true): Field => ({ ...f, must: when });

/** Asked of Life 1 always, and of Life 2 wherever there is one. */
const eachLife = (d: Data, life?: 1 | 2) => life !== 2 || hasLife2(d);
const working = (d: Data, life?: 1 | 2) => eachLife(d, life) && d[`work.${life ?? 1}`] !== "No";
const mortgaged = (d: Data, life?: 1 | 2) => {
  const h = d[`housing.${life ?? 1}`];
  return Array.isArray(h) && h.includes("Mortgage");
};
const anyMortgage = (d: Data) => mortgaged(d, 1) || mortgaged(d, 2);
const LIFE = ["Life 1", "Life 2", "Joint"];
const replacing = (d: Data) => d.replaced6 === "Yes" || rowsOf(d, "existing").some((r) => r.keep === "Not Keeping");
const lifetime = (d: Data) => d["need.lifetime.identified"] === "Yes";

const NEEDS = [
  { key: "mortgage_death", label: "Mortgage on death" },
  { key: "mortgage_ci", label: "Mortgage on critical illness" },
  { key: "lump_sum", label: "Lump sum for dependants (life cover / family income benefit)" },
  { key: "ip", label: "Income protection" },
  { key: "lifetime", label: "Lifetime need (client wants cover paid out whenever they die: whole of life costed against term)" },
  { key: "funeral", label: "Funeral expenses (over 50: WOL up to £15,000, in trust, whether or not the client has savings)" },
  { key: "accident", label: "Accident and sickness (MetLife Multi-Protect)" },
];
// Not on the paper sheet: Concert Hub asks for it separately from the mortgage.
const EXTRA_NEEDS = [
  { key: "ci_lump", label: "Lump sum on serious illness, apart from the mortgage (critical illness capture)" },
];
const NEED_COLUMNS = [yn("identified", "Identified"), text("covered", "Already covered (policy / evidence)"), text("reason", "Considered and discounted: reason"), text("words", "Client's own words")];
const needBlank = (d: Data, row: string) => d[`need.${row}.identified`] !== "Yes" && blank(d[`need.${row}.covered`]) && blank(d[`need.${row}.reason`]);

const outgoings = (d: Data): number | null => {
  const parts = ["essential", "lifestyle", "regular_savings", "other_out"].map((k) => money(d[k]));
  return parts.every((p) => p === null) ? null : parts.reduce<number>((n, p) => n + (p ?? 0), 0);
};

const sections: Sheet["sections"] = [
  {
    key: "checks", title: "Call checks",
    blocks: [
      { type: "note", text: "Tick as delivered (observation form 1.1 to 1.4). The three disclosure pieces come before the first fact-find question." },
      { type: "checks", items: [
        { key: "purpose", label: "Purpose of the call stated: L&G service call and protection review; consent to short disclosures (1.2)" },
        { key: "recorded", label: "\"This call is recorded for training and quality purposes\"" },
        { key: "disc1", must: true, label: "Disclosure piece 1: Appointed Representative of The Openwork Partnership, authorised and regulated by the FCA, both on the FCA register; protection only, referral for mortgages, pensions, investments; we work for the client, not an insurer, and what they get from you is a personal recommendation based on their needs. Pause: \"Does that make sense so far?\"" },
        { key: "disc2", must: true, label: "Disclosure piece 2: specific panel of insurers, not the whole market, list to follow; no fee, insurer pays commission built into the premium, amount on the illustration. Pause: \"OK so far?\"" },
        { key: "disc3", must: true, label: "Disclosure piece 3: complaints to Openwork, then the Financial Ombudsman free of charge; FSCS: insurance advising and arranging covered for 90% of the claim, no upper limit (as in Our Insurance Proposition); the five documents to follow by email." },
        { key: "vuln_asked", must: true, label: "Vulnerability question asked: \"Is there anything like that I should know before we start?\" Answer and any support agreed recorded under Housing and mortgage." },
        { key: "email", label: "Post-call email: standard template: Our Insurance Proposition; Insurance Proposition Summary (the panel of insurers); TopQuote Privacy Policy; Openwork Processing of Personal Data notice; Support for When You Need It Most. Sign-off has your phone number and email address (1.2)." },
      ] },
    ],
  },
  {
    key: "family", title: "Client and family",
    blocks: [
      { type: "note", text: "First names and ages only. Surnames, dates of birth, addresses and postcodes go straight into Concert, not here." },
      { type: "lives", rows: [
        must(text("name", "First name"), (d, life) => life !== 2 || ["Married/CP", "Cohabiting"].includes(String(d["marital.1"] ?? ""))),
        must(num("age", "Age"), eachLife),
        one("marital", "1. Marital status", "Single", "Married/CP", "Cohabiting", "Div.", "Wid."),
        many("contact", "1. Future contact? (service consent)", "Telephone", "Text", "Email"),
        many("marketing", "1. Marketing information? (marketing consent)", "Telephone", "Text", "Email", "Post"),
      ] },
      { type: "rows", key: "children", title: "1. Children", add: "Add a child", columns: [text("name", "First name"), num("age", "Age"), one("of", "Whose", "Life 1", "Life 2", "Both")] },
      { type: "lives", rows: [
        num("child_indep", "1. Children independent age?"),
        many("will", "Will or trust in place", "Will", "Trust", "Neither"),
      ] },
      { type: "rows", key: "dependants", title: "Adult and other dependants", add: "Add a dependant", columns: [
        text("name", "First name"), text("relationship", "Relationship"), num("age", "Age"), one("on", "Dependent on", "C1", "C2", "Both"),
        text("until", "Dependency up to (age / WOL)"), pounds("income", "Own income"), text("evidence", "Health / employment / other evidence"),
      ] },
      { type: "note", text: "Partner: complete Life 2 wherever there is a partner, even if they are not being insured." },
      { type: "fields", rows: [
        yn("partner_by_life1", "Partner's details given by Life 1 on their behalf"),
        text("partner_missing_reason", "If the partner's details could not be obtained, the reason"),
        must(yn("partner_told", "Client told the recommendation may be affected if the partner's details are missing"),
          (d) => d.partner_by_life1 === "Yes" || !blank(d.partner_missing_reason)),
        must({ ...long("dependency", "Evidence and duration of dependency: what support is provided (financial £/frequency, or care/household), and until when is it needed? (co-dependent couple: to retirement age; children: to independence age; elderly dependant: ONS life expectancy)", 3) }, hasDependants),
      ] },
      { type: "note", text: "Grandchildren: treat as dependent on their parents unless the client tells you otherwise. Money for non-dependant children or grandchildren is a legacy need: refer to a suitably licensed adviser, do not record it as a protection need." },
      { type: "fields", rows: [
        words("manage_without", "How would (names of kids/grandkids) manage if you were no longer here and you couldn't provide financial support?"),
        words("sum_help", "If you were no longer around, would providing a sum of money whilst (names of kids/grandkids) are still dependent, help out?"),
        words("debts_left", "Would it be important for you to ensure that any surviving family members are not left with any future debts?"),
      ] },
    ],
  },
  {
    key: "work", title: "Employment and income",
    blocks: [
      { type: "lives", rows: [
        yn("work", "2. Work?"),
        must(text("job", "2. Job"), working),
        text("employer", "2. Employer: name and where based"),
        text("job_length", "2. How long in this job?"),
        must(num("retire_age", "2. Retirement age?"), eachLife),
        yn("retire_realistic", "Realistic given dependants/commitments?"),
        yn("retire_affordable", "Premium still affordable in retirement?"),
        one("employed", "Employed or self-employed", "Employed", "Self-Employed"),
        one("hours", "Full-time or part-time", "Full-Time", "Part-Time"),
        pounds("gross", "2. Gross annual"),
        must(pounds("net", "2. NET monthly"), eachLife),
        one("pay_basis", "Basic only / incl. overtime, bonus, commission", "Basic", "Variable"),
        text("pay_variable", "If variable: how much, and is it guaranteed?"),
        one("paid", "2. Paid?", "Monthly", "Fortnightly", "Weekly"),
        long("benefits", "2. Deductions / benefits / additional income? (incl. death in service)"),
        num("sick_full", "2. Employer sick pay: full pay", "weeks"),
        num("sick_half", "Employer sick pay: half pay", "weeks"),
        yn("sick_ssp", "SSP only (£123.25 a week at most)"),
        many("pension", "2. Pension", "Workplace", "Personal", "State", "None"),
        text("pension_reviewed", "Pension last reviewed?"),
        text("pension_paid", "If retired: in payment", "£ a month, from how many pensions"),
        text("pension_expected", "Expected pension income at retirement (if still working), including state pension", "roughly £ a month, from how many, or unknown / declined"),
        text("pension_survivor", "Survivor's pension to partner on death", "£ a month and for how long, or none / unknown / declined"),
        yn("pension_referral", "Working, no pension or not reviewed in years: referral to an Openwork wealth adviser noted"),
      ] },
    ],
  },
  {
    key: "health", title: "Health and lifestyle",
    blocks: [
      { type: "lives", rows: [
        yn("uk", "3. UK resident?"), yn("reside", "3. Right to reside?"),
        one("smoker", "3. Smoker? (incl. vaping, e-cigarettes, nicotine replacement)", "Yes", "Last 12 Months", "Last 5 Years", "Never"),
        many("hazard", "Hazardous?", "Activities", "Hobbies", "Motorbike"),
        num("alcohol", "Alcohol units per week?"), yn("drugs", "Recreational drugs?"),
        text("height", "Height"), text("weight", "Weight"), text("size", "Dress/waist size"),
        yn("major", "Cancer, heart attack, stroke, diabetes, MS?"),
        yn("bp", "5 years: blood pressure, cholesterol, asthma?"),
        yn("mental", "5 years: depression, anxiety, stress, mental health condition?"),
        yn("misc", "Misc health? (medication; treatment in recent years; lumps, bumps or moles; tests or investigations pending)"),
      ] },
      { type: "note", text: "The answers here go onto the application in full. If something is missed, a claim can be turned down later; if the client is not sure whether something counts, it goes in." },
    ],
  },
  {
    key: "housing", title: "Housing and mortgage",
    blocks: [
      { type: "lives", rows: [
        many("housing", "4. Housing?", "Rent", "Mortgage", "Own Outright", "Buy to let"),
        must(num("mort_term", "4. Mortgage term", "years"), mortgaged),
        must(pounds("mort_out", "4. Outstanding"), mortgaged),
        must(pounds("property", "4. Approx. property value (if owned / mortgaged)"), (d, life) => {
          const h = d[`housing.${life ?? 1}`];
          return Array.isArray(h) && (h.includes("Mortgage") || h.includes("Own Outright"));
        }),
        pounds("mort_pay", "4. Monthly payment"),
        one("mort_type", "Repayment or interest only", "Repayment", "Interest Only"),
        yn("mort_changed", "Changed since existing cover taken out (further advance / longer term)?"),
        yn("mort_cover_matched", "If yes: existing cover increased to match?"),
        text("alternative", "If payments couldn't be kept up: alternative accommodation, and for how long?"),
      ] },
      { type: "fields", rows: [
        words("cap_mortgage", "MORTGAGE CAPTURE: \"What would happen to the mortgage at (address) if you were to die, or were diagnosed with a critical illness?\"", anyMortgage),
      ] },
      { type: "heading", text: "Additional checks (SAF 4.2 / 4.3.4 / 4.3.7 / 4.3.8)" },
      { type: "fields", rows: [
        many("changes", "Known future changes", "Job/Income", "Redundancy risk", "Marriage/divorce", "House move", "Dependants change", "None"),
        text("changes_detail", "Details"),
      ] },
      { type: "rows", key: "liabilities", title: "Liabilities (loans, credit cards, car finance, other debts)", add: "Add a liability", columns: [
        text("type", "Type"), pounds("balance", "Balance"), pounds("monthly", "Monthly payment"), yn("falls", "Would it fall on the family?"),
      ] },
      { type: "total", key: "liab_balance", label: "Total balance", of: (d) => sumRows(d, "liabilities", "balance") },
      { type: "total", key: "liab_monthly", label: "Total monthly payments", of: (d) => sumRows(d, "liabilities", "monthly") },
      { type: "rows", key: "savings", title: "Savings and investments", add: "Add a holding",
        must: (d) => rowsOf(d, "savings").length === 0 && blank(d.savings_declined) ? "Savings and investments: the holdings, \"none\", or that the client declined and why" : null,
        columns: [
          text("holding", "Holding and type (cash, ISA, shares, other)"), pounds("value", "Value"),
          text("access", "Access and any restrictions (notice, fixed term, penalty)"), text("source", "Source (earnings, inheritance, sale, gift, other)"),
        ] },
      { type: "total", key: "savings_total", label: "Total savings", of: (d) => sumRows(d, "savings", "value") },
      { type: "note", text: "One holding per line; ask what cannot be reached straight away, and where the money came from." },
      { type: "fields", rows: [
        text("savings_declined", "No savings, or the client declined: say which, and the reason they gave", "Tell the client a decline may affect what can be recommended"),
        text("earmarked", "Earmarked for"),
        text("months_going", "Months it would keep you going"),
        yn("surplus_challenged", "Surplus challenged? (no savings or very little: \"where does it tend to go?\")"),
        pounds("surplus_revised1", "Revised surplus"),
        pounds("ef_current", "Emergency fund: current level"),
        pounds("ef_agreed", "Emergency fund: agreed level"),
        yn("ef_regular", "If none, regular saving to build fund recommended"),
        yn("adverse", "Ever bankrupt / IVA / adverse credit?"),
        text("adverse_detail", "Detail"),
        must(yn("vuln", "Any vulnerability indicators?")),
        must({ ...long("vuln_detail", "Details / support offered (more time, shorter calls, a friend or family member on the line, things in writing, different format)") }, (d) => d.vuln === "Yes"),
      ] },
    ],
  },
  {
    key: "budget", title: "Budget planner and captures",
    blocks: [
      { type: "fields", rows: [
        must(pounds("essential", "Essential outgoings", "month")), must(pounds("lifestyle", "Lifestyle outgoings", "month")),
        pounds("regular_savings", "Savings", "month"), pounds("other_out", "Other", "month"),
      ] },
      { type: "total", key: "commitments", label: "Total monthly commitments incl. mortgage or rent (\"does that sound right?\")", of: outgoings },
      { type: "fields", rows: [must(pounds("household", "Net monthly household income", "month"))] },
      { type: "total", key: "surplus", label: "Surplus (\"That leaves you roughly £___ a month spare. Does that sound about right?\")",
        of: (d) => { const i = money(d.household); const o = outgoings(d); return i === null || o === null ? null : i - o; } },
      { type: "fields", rows: [one("surplus_agreed", "Surplus", "Confirmed", "Revised after challenge"), pounds("surplus_revised", "Revised to")] },
      { type: "heading", text: "Captures: the client's exact words, for call 2" },
      { type: "fields", rows: [
        words("cap_ip", "IP CAPTURE: \"How would you and (family names) manage with the bills if you were unable to work long-term, bearing in mind Statutory Sick Pay is £123.25 a week at most?\"", (d) => working(d, 1)),
        words("bills_without", "Have you considered how (family names) would afford the rest of the bills if you were no longer around?"),
        words("after_mortgage", "If you were to pass away and the mortgage is cleared, what additional support would your family need?"),
        words("partner_passes", "(If the client's partner was to pass away) If your partner passed away, how would you cover the rest of the bills to give you the space to take time off to care for your children?"),
        words("cap_cic", "CIC CAPTURE: \"If you or (partner name) were diagnosed with something serious, what would the biggest financial worry be?\"", true),
        words("cap_fib", "FIB CAPTURE: \"If one of you wasn't here, what would be the biggest day-to-day concern for (family names)?\"", hasDependants),
        words("cap_lifetime", "LIFETIME NEED CAPTURE (where identified): \"Is there anything you'd want paid out whenever you die, rather than only if it happens within a set number of years? What would that be for?\"", lifetime),
      ] },
    ],
  },
  {
    key: "existing", title: "Existing policies",
    blocks: [
      { type: "rows", key: "existing", title: "5. Existing policies?", add: "Add an existing policy", columns: [
        one("life", "Whose", ...LIFE), num("term", "Term", "years"), text("provider", "Provider"), text("type", "Type"),
        pounds("premium", "Premium"), pounds("sum", "Sum assured"),
      ] },
      { type: "fields", rows: [
        long("existing_detail", "Existing policies: what each pays out for, additional benefits, and whether it is linked to a liability (which). Include workplace cover: death in service, group income protection."),
        must(yn("replaced6", "Any policy replaced, reduced or cancelled in the last 6 months? (if yes, treat as a replacement)")),
        long("lg_review", "L&G policy reviewed on the service call: original reason for taking it out; client's understanding of what it does; what it does well; any gap (balance, term or type no longer matching the mortgage)", 3),
      ] },
    ],
  },
  {
    key: "priorities", title: "Priorities and terms",
    blocks: [
      { type: "note", text: "Budget is asked once, at the end of tailoring, after the client has heard every area and option: \"Now that you have heard everything I would like to look at for you, what would you feel comfortable spending each month to cover these areas?\" Then: \"Which of the areas of cover would you say are the absolute priority?\"" },
      { type: "fields", rows: [must(pounds("budget", "Budget", "month"))] },
      { type: "grid", key: "need", title: "Needs, in the call 1 recap order. Every line is one of: identified / already covered with evidence / considered and discounted with the reason. Nothing is left as \"no need\" without a reason.",
        rows: NEEDS, mustLabel: "identified, already covered, or the reason it was discounted", must: needBlank, columns: NEED_COLUMNS },
      { type: "rows", key: "priority", title: "Priorities, most important first", add: "Add a priority", columns: [one("life", "Whose", ...LIFE), text("type", "Type"), text("term", "Term")] },
      { type: "lives", rows: [
        words("matters", "Client's own words on what matters most", eachLife),
      ] },
      { type: "heading", text: "Tailoring, asked and answered (never added to a plan without asking)" },
      { type: "fields", rows: [
        one("t_premiums", "Guaranteed / reviewable", "Guaranteed", "Reviewable"), yn("t_wop", "Waiver of premium"), yn("t_ccic", "Children's CIC"), yn("t_tpd", "TPD"),
        yn("t_index", "Indexation (level, FIB, IP only)"), yn("t_past_retire", "Premium affordable past retirement age"), yn("t_funeral", "Funeral WOL (over 50)"), yn("t_metlife", "MetLife Multi-Protect"),
        yn("t_lifelong", "Lifelong dependant recorded"),
        must(yn("t_wol_run", "WOL illustration run"), lifetime), must(text("t_wol_reason", "If not run, client's reason"), (d) => lifetime(d) && d.t_wol_run === "No"),
        yn("t_wealth", "Need above £15,000: referred to a wealth adviser for that part"),
        must(text("t_lifetime_words", "Lifetime need recorded (client's words)"), lifetime),
        must(pounds("t_wol_cost", "WOL cost", "month"), (d) => lifetime(d) && d.t_wol_run === "Yes"), pounds("t_term_cost", "Against term cost", "month"),
        must(text("t_wol_declined", "If WOL not taken, client's reason"), (d) => lifetime(d) && d.t_wol_run === "Yes"),
        yn("t_term_understood", "Client understands term may end without paying out (confirm on call 2)"),
      ] },
      { type: "rows", key: "existing", fixed: true, title: "Existing policy: keeping or not keeping", add: "", columns: [
        one("life", "Whose", ...LIFE), text("type", "Type"), num("term", "Rem. term", "years"), pounds("sum", "Sum assured"), pounds("premium", "Premium"),
        one("keep", "Keeping?", "Keeping", "Not Keeping"),
      ] },
    ],
  },
  { key: "policies", title: "Recommendation and reasons", blocks: [
    { type: "note", text: "One card for each policy you intend to recommend (pages 7 to 9 of the paper sheet). Add as many as you need, for whoever they cover." },
    { type: "policies" },
  ] },
  {
    key: "before", title: "Before call 2 / before submission",
    blocks: [
      { type: "checks", items: [
        { key: "b_captures", label: "The four captures (IP, mortgage, CIC, FIB) and the lifetime need capture, where identified, transferred to the Advice Call in the client's exact words" },
        { key: "b_budget", label: "Budget and priorities carried across" },
        { key: "b_needs", label: "Every need marked identified / covered / discounted with reason" },
        { key: "b_concert", label: "Everything on this sheet entered in Concert KYC wherever there is a field for it, mandatory or not" },
        { key: "b_callback", label: "Callback booked, client confirmed available" },
        { key: "b_onecall", label: "or One call: recommendation given on this call" },
      ] },
      { type: "fields", rows: [text("b_concert_when", "Entered in Concert: date and by"), text("b_callback_when", "Callback booked: day and time")] },
    ],
  },
  {
    key: "extra", title: "Not on the paper sheet",
    blocks: [
      { type: "note", text: "The paper sheet has no room for these, but the advice check and Concert Hub need them. Fill them in when you type up the sheet." },
      { type: "lives", rows: [long("health_detail", "Health: details of any yes")] },
      { type: "fields", rows: [
        must({ ...long("replace_why", "If anything is being replaced: the need today, the comparison (what the old plan gave, what the new one gives) and the cost difference", 3) },
          replacing),
        // Concert Hub's consequences of replacing.
        must(long("replace_lose", "If anything is being replaced: what they lose by it (guaranteed rate, renewable or convertible option, TPD, trust), or that nothing is lost"), replacing),
        must(text("budget_how", "How the budget was set", "What you asked and what they said")),
      ] },
      { type: "grid", key: "need", title: "One more need line: Concert Hub asks for it separately from the mortgage.",
        rows: EXTRA_NEEDS, mustLabel: "identified, already covered, or the reason it was discounted", must: needBlank, columns: NEED_COLUMNS },
      { type: "lives", rows: [
        // Concert Hub asks for it whenever income protection is identified.
        must(one("deferred", "Deferred period needed for income protection", ...HUB_DROPDOWNS.deferred_period.options), (d, life) => eachLife(d, life) && d["need.ip.identified"] === "Yes"),
      ] },
    ],
  },
  {
    key: "after", title: "After the advice call",
    blocks: [
      { type: "note", text: "Not on the paper sheet. Fill this in once you have presented the recommendation: the Concert Hub page needs it." },
      { type: "fields", rows: [
        words("a_decision", "What the client decided on each policy, and why, in their words"),
        long("a_understood", "How you know they understood their options and what they were agreeing to"),
        long("a_options", "Other options shown (cheaper, whole of life, family income benefit and so on), the premiums quoted, and why not"),
        long("a_trust", "Trusts: what you explained and what they decided"),
        long("a_not_met", "Needs not met: what you told them, and what was agreed about it"),
        long("a_follow", "Follow up agreed"),
      ] },
    ],
  },
];

export const SHEET_2026_11_27: Sheet = { version: "2026-11-27", title: "Fact Find sheet, 20 November 2026", sections };

// Kept here so the type checker ties the definition to what it stores.
export type { Block, Policy, Row };
