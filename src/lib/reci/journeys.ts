/**
 * Client nurture journeys: content + schedule definitions.
 *
 * Source: Guy's "Payment Issue & Cancellation Nurture Journeys" v2
 * document (July 2026), agreed with Guy + Poz. Four journeys, one per
 * trigger the L&G report can surface:
 *
 *   A. Missed payment            (Bounced DD)          5 emails / 3 SMS, days 0-29
 *   B. Cancelled DD mandate      (Cancelled DD)        4 emails / 2 SMS, days 0-17
 *   C. Cooling-off notice        (Cancelled from outset) 3 emails / 1 SMS, days 0-9
 *   D. Cancelled / lapsed cover  (Lapse)               4 emails / 2 SMS, days 0-28
 *
 * Day 0 = the day the case reaches TopQuote (not the day of the event):
 * the L&G report lands Mondays and Thursdays, sometimes days after the
 * event itself.
 *
 * These are servicing communications to existing policyholders, not
 * marketing. Copy stays factual and service-led. Per the doc's PECR
 * note, only the SMS steps that lean promotional (B2, D1, D2) carry
 * "Reply STOP to opt out"; STOP handling itself lives in Webex Interact.
 *
 * Merge fields we hold: first name, policy number, monthly premium
 * (net_premium), start year (policy_start_date), and the L&G off-risk
 * date (used as the lapse/cancellation date where present). Fields we
 * don't hold (collection date, exact reinstatement deadline) fall back
 * to general wording, as the doc specifies.
 */
import { pairForWarning } from "./status";

export type JourneyKey = "a" | "b" | "c" | "d";

export interface MergeCtx {
  firstName: string;
  policyNumber: string;
  premium: string | null;          // "£26.50"
  startYear: string | null;        // "2023"
  lapseDate: string | null;        // "26 August 2026" (off_risk_date)
  collectionDate: string | null;   // not held in the data; always null for now
  cancellationDate: string | null; // off_risk_date for cooling-off cases
  phone: string;                   // TOPQUOTE_PHONE
  hours: string;                   // TOPQUOTE_HOURS, e.g. "9am-5pm"
}

export interface JourneyStep {
  key: string;                     // "a1_email", "a1_sms", ...
  day: number;                     // offset from journey start (day 0)
  channel: "email" | "sms";
  label: string;                   // "Email 1" / "SMS 2" for the UI
  purpose: string;                 // one-liner for the UI schedule preview
  subject?: (c: MergeCtx) => string;
  body: (c: MergeCtx) => string;   // email: full plain-text body; sms: message text
}

export interface JourneyDef {
  key: JourneyKey;
  name: string;
  trigger: string;
  durationDays: number;
  steps: JourneyStep[];
}

/** Which journey fits an EBAH warning, via the same pairing the status model uses. */
export function journeyForWarning(warning: string | null | undefined): JourneyKey {
  switch (pairForWarning(warning)) {
    case "bp":    return "a"; // bounced payment -> missed payment journey
    case "dd":    return "b"; // cancelled DD mandate
    case "cfo":   return "c"; // cancelled from outset -> cooling-off
    case "lapse": return "d"; // lapsed / cancelled cover win-back
  }
}

/**
 * Suppression checklist shown to the person pressing Start. Per the doc,
 * these checks are human, which is exactly why the button comes first.
 */
export const SUPPRESSION_CHECKS = [
  "No open complaint on this client",
  "No recent bereavement",
  "No vulnerability marker (if in doubt, route to an adviser instead)",
] as const;

// ---------------------------------------------------------------------------
// Shared phrase helpers. Every fallback keeps the sentence grammatical when
// a merge field is missing, per the doc: "generalise where data missing".
// ---------------------------------------------------------------------------

/** "back in 2023" / "when you took the policy out" */
const fixedWhen = (c: MergeCtx) =>
  c.startYear ? `back in ${c.startYear}` : "when you took the policy out";

/** "in 2023" / "when you took your policy out" */
const inStartYear = (c: MergeCtx) =>
  c.startYear ? `in ${c.startYear}` : "when you took your policy out";

const signoff = (c: MergeCtx) =>
  `Warm regards,\nThe TopQuote Team\n${c.phone}  |  Mon-Fri ${c.hours}`;

// ---------------------------------------------------------------------------
// Journey A: Missed Payment (trigger: bounced DD / failed payment)
// ---------------------------------------------------------------------------

const JOURNEY_A: JourneyDef = {
  key: "a",
  name: "A. Missed payment",
  trigger: "L&G report shows a failed Direct Debit or card payment. Tone arc: helpful, then informative, then urgent.",
  durationDays: 29,
  steps: [
    {
      key: "a1_email", day: 0, channel: "email", label: "Email 1",
      purpose: "Notify the failure; reassure cover is currently unaffected; easy fix",
      subject: (c) => `We couldn't collect your payment, ${c.firstName}. Quick fix inside`,
      body: (c) =>
`Hi ${c.firstName},

We've been told that this month's payment${c.premium ? ` of ${c.premium}` : ""} for your life insurance policy (${c.policyNumber}) didn't go through. This happens more often than you'd think: a new bank card, a switched account, or a balance timing issue is usually all it is.

The good news: your cover is still in place, and nothing changes if we can sort this quickly. The insurer will attempt to collect the payment again shortly.

If you'd rather fix it now, or if anything has changed with your bank details, just call us on ${c.phone}. It takes about two minutes.

One thing worth knowing: your premium was fixed ${fixedWhen(c)}, based on your age and health at the time. It's a price worth protecting.

${signoff(c)}`,
    },
    {
      key: "a1_sms", day: 1, channel: "sms", label: "SMS 1",
      purpose: "Fast nudge; many failures are innocent card/bank issues",
      body: (c) =>
        `Hi ${c.firstName}, it's TopQuote. Your recent life insurance payment didn't go through. Your cover is fine for now & it's usually a 2-min fix. Call us on ${c.phone}`,
    },
    {
      key: "a2_email", day: 7, channel: "email", label: "Email 2",
      purpose: "Reminder after failed retry; introduce what's at stake",
      subject: () => "Your policy payment is still outstanding",
      body: (c) =>
`Hi ${c.firstName},

A quick follow-up: we still haven't been able to collect the payment for your life insurance policy (${c.policyNumber}). The insurer's follow-up attempt was also unsuccessful.

Right now this is easy to fix and your cover continues. But if the payment stays outstanding, your policy will eventually lapse, and with it, the protection your family relies on.

Whatever the reason (a bank change, a busy month, or something bigger), one call sorts it or tells you your options: ${c.phone}.

${signoff(c)}`,
    },
    {
      key: "a3_email", day: 14, channel: "email", label: "Email 3",
      purpose: "Loss-of-cover message; the price-lock argument",
      subject: (c) => `${c.firstName}, your cover is now at risk`,
      body: (c) =>
`Hi ${c.firstName},

Your policy (${c.policyNumber}) has now been unpaid for two weeks. We have to be straight with you about what happens if this isn't resolved:

- If your policy lapses, your family loses the protection it provides, and no claim can be made for anything that happens while you're uncovered.
- Your premium${c.premium ? ` of ${c.premium}` : ""} was locked in ${fixedWhen(c)}, based on your age and health then. If you ever wanted cover again, a new policy would be priced on your age and health today, which usually means paying more, answering new medical questions, and potentially facing exclusions.

Bringing your policy back up to date now takes one phone call and no new underwriting. Call us on ${c.phone}. We're here ${c.hours}.

${signoff(c)}`,
    },
    {
      key: "a2_sms", day: 16, channel: "sms", label: "SMS 2",
      purpose: "Reinforce email 3 with call CTA",
      body: (c) =>
        `${c.firstName}, your TopQuote life cover is at risk. Your price was fixed ${c.startYear ? `in ${c.startYear}` : "years ago"} - replacing it later will likely cost more. 1 call fixes it: ${c.phone}`,
    },
    {
      key: "a4_email", day: 21, channel: "email", label: "Email 4",
      purpose: "Empathy pivot: if money is tight, talk to us first; options",
      subject: () => "If money's tight right now, please read this before your cover ends",
      body: (c) =>
`Hi ${c.firstName},

We know a missed payment isn't always an oversight. If your circumstances have changed (a squeeze on the household budget, a change of job, anything), we'd much rather help than watch your cover disappear.

Depending on your policy, options can include reducing your cover to lower the monthly cost, moving your payment date to fit your payday, or simply catching up the missed amount over time. None of these are possible once the policy lapses.

You took this policy out for a reason, and that reason probably hasn't gone away. Before you lose the price you fixed ${c.startYear ? `in ${c.startYear}` : "back then"}, give us five minutes: ${c.phone}.

There's no obligation and no hard sell, just your options, clearly explained.

${signoff(c)}`,
    },
    {
      key: "a5_email", day: 28, channel: "email", label: "Email 5",
      purpose: "Final notice before lapse date",
      subject: (c) => `Final notice: your life cover ends ${c.lapseDate ? `on ${c.lapseDate}` : "soon"}`,
      body: (c) =>
`Hi ${c.firstName},

This is our final reminder. Unless the outstanding payment on policy ${c.policyNumber} is resolved, your cover will end${c.lapseDate ? ` on ${c.lapseDate}` : " shortly"}.

From that date: your family's protection stops; no claims can be made for events after the lapse; and the premium you fixed ${inStartYear(c)} is lost. Any future cover would mean a new application, new medical questions, and pricing based on your age today.

It is not too late. A single call today keeps everything in place: ${c.phone}, open ${c.hours}.

If you've decided you no longer want the policy, we'd still encourage a quick call so you can make that decision with the full picture.

${signoff(c)}`,
    },
    {
      key: "a3_sms", day: 29, channel: "sms", label: "SMS 3",
      purpose: "Last-chance text on the eve of lapse",
      body: (c) =>
        `FINAL REMINDER ${c.firstName}: your TopQuote life cover ends ${c.lapseDate ?? "very soon"}. After that your fixed price & your family's protection are gone. Call ${c.phone} today`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Journey B: Cancelled Direct Debit Mandate
// ---------------------------------------------------------------------------

const JOURNEY_B: JourneyDef = {
  key: "b",
  name: "B. Cancelled Direct Debit mandate",
  trigger: "L&G report shows the client cancelled their DD mandate at the bank. Only the client can authorise a new mandate, so the journey's job is to prompt that call.",
  durationDays: 17,
  steps: [
    {
      key: "b1_email", day: 0, channel: "email", label: "Email 1",
      purpose: "Acknowledge the cancellation; ask them to talk to us before cover is affected",
      subject: () => "We've noticed your Direct Debit was cancelled. Before anything changes, can we talk?",
      body: (c) =>
`Hi ${c.firstName},

We've been notified that the Direct Debit for your life insurance policy (${c.policyNumber}) has been cancelled. Sometimes this is deliberate; sometimes it happens by accident during a bank switch.

Either way, here's what matters: your cover is still active today, but without a payment method your next premium will fail and your policy will start the path to lapsing.

If you meant to cancel, we'd ask just one thing: a five-minute call before it's final. Your premium was fixed ${inStartYear(c)}, and once this policy ends that price doesn't come back. There may also be options you haven't been told about, like reducing your cover instead of losing it entirely.

If it was an accident, only you can authorise a new Direct Debit, and we can set one up with you over the phone in minutes: ${c.phone}.

${signoff(c)}`,
    },
    {
      key: "b1_sms", day: 1, channel: "sms", label: "SMS 1",
      purpose: "Immediate nudge with call CTA",
      body: (c) =>
        `Hi ${c.firstName}, TopQuote here. Your Direct Debit for your life cover was cancelled. Your cover is still active - please call us on ${c.phone} before anything changes`,
    },
    {
      key: "b2_email", day: 4, channel: "email", label: "Email 2",
      purpose: "The price-lock and protection-gap argument",
      subject: (c) => `What you'd be giving up, ${c.firstName}`,
      body: (c) =>
`Hi ${c.firstName},

We wanted to lay out plainly what ends if your policy (${c.policyNumber}) is allowed to lapse:

- The protection this policy provides for the people who depend on you.
- A premium${c.premium ? ` of ${c.premium}` : ""}, locked to your age and health ${c.startYear ? `in ${c.startYear}` : "when you took it out"}. A comparable new policy today would be priced on your current age, and would usually cost more, sometimes substantially so.
- Guaranteed acceptance of claims for things that haven't happened yet. Once cover stops, so does that certainty.

If the monthly cost is the issue, that's a conversation, not a dead end. Cover can often be adjusted rather than lost. Call us on ${c.phone} and we'll go through it with you, no pressure.

${signoff(c)}`,
    },
    {
      key: "b3_email", day: 10, channel: "email", label: "Email 3",
      purpose: "Empathy: circumstances change; there are options short of cancelling",
      subject: () => "Circumstances change. Losing all your cover isn't the only answer.",
      body: (c) =>
`Hi ${c.firstName},

When people cancel a Direct Debit on a life policy, it's usually for a good reason: money is tighter, a mortgage has been paid down, a relationship has changed. Those are real reasons, and they're exactly what we'd like to talk through with you.

Because here's what we see all too often: someone cancels the policy they priced years ago, life moves on, and when they want cover again it costs far more, or health changes mean they can't get the same cover at all.

Before that becomes your story, let's have one honest conversation about what you actually need now. Sometimes the answer is a smaller policy at a smaller price. Sometimes it's keeping exactly what you have. Occasionally it really is cancelling, and if so, at least you'll decide with the full picture.

Call us on ${c.phone}, ${c.hours}.

${signoff(c)}`,
    },
    {
      key: "b2_sms", day: 12, channel: "sms", label: "SMS 2",
      purpose: "Reinforce options message",
      body: (c) =>
        `${c.firstName}, before your life cover lapses: there are usually options short of cancelling - smaller cover, lower cost. 5 mins with TopQuote: ${c.phone}. Reply STOP to opt out`,
    },
    {
      key: "b4_email", day: 17, channel: "email", label: "Email 4",
      purpose: "Final email before the next collection date fails",
      subject: (c) => `Your next payment is due ${c.collectionDate ? `on ${c.collectionDate}` : "soon"}, and there's no way to collect it`,
      body: (c) =>
`Hi ${c.firstName},

Your next premium for policy ${c.policyNumber} is due${c.collectionDate ? ` on ${c.collectionDate}` : " soon"}, but with no Direct Debit in place it cannot be collected. When that payment fails, your policy begins to lapse and your family's protection starts counting down to zero.

Everything can still be kept exactly as it was (same cover, same ${c.startYear ? `${c.startYear} ` : ""}price) with one call to re-establish your payment: ${c.phone}.

And if you've firmly decided to cancel, call us anyway. We'll make sure you know precisely what you're giving up and whether a reduced policy could protect what matters at a cost that works. Then the decision is fully yours.

${signoff(c)}`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Journey C: Cooling-Off Notice. Light-touch by design: must not obstruct
// or pressure the statutory right to cancel.
// ---------------------------------------------------------------------------

const JOURNEY_C: JourneyDef = {
  key: "c",
  name: "C. Cooling-off notice",
  trigger: "Client has exercised their statutory cooling-off right. Light-touch: acknowledges, informs, offers a conversation only.",
  durationDays: 9,
  steps: [
    {
      key: "c1_email", day: 0, channel: "email", label: "Email 1",
      purpose: "Acknowledge the notice; confirm the right and refund; open the door",
      subject: (c) => `We've received your cancellation request, ${c.firstName}`,
      body: (c) =>
`Hi ${c.firstName},

We've received your cooling-off cancellation for policy ${c.policyNumber}. That right is yours, we respect it fully, and any premium you've paid will be refunded in line with your policy terms once the cancellation completes${c.cancellationDate ? ` on ${c.cancellationDate}` : ""}.

Before then, if there's anything that prompted this (the price, the cover level, something unclear in the paperwork, or simply second thoughts), we'd welcome the chance to hear it. Sometimes a small change (a different sum assured, a different premium) turns out to be what someone actually wanted.

No pressure either way. If you'd like to talk it through, we're on ${c.phone}, ${c.hours}. Otherwise, your cancellation will proceed as requested.

${signoff(c)}`,
    },
    {
      key: "c2_email", day: 4, channel: "email", label: "Email 2",
      purpose: "Gentle value recap: what the policy does and why they bought it",
      subject: () => "Before it's final: two minutes on what this policy was set up to do",
      body: (c) =>
`Hi ${c.firstName},

Your cancellation for policy ${c.policyNumber} completes${c.cancellationDate ? ` on ${c.cancellationDate}` : " shortly"}. Until then, we thought a short recap might be useful, not to change your mind for you, just to make sure the decision is made with everything in view.

This policy provides valuable protection${c.premium ? ` for ${c.premium} a month` : ""}, priced on your age and health today. If you cancel now and want life cover later, it will be priced on your age and health then, and premiums generally rise with every year of age.

If cost was the concern, a smaller policy might achieve most of the protection at a lower price. If something else prompted it, we'd like to know. It helps us, even if you still cancel.

We're on ${c.phone} if a conversation would help. Otherwise, everything proceeds as you've asked.

${signoff(c)}`,
    },
    {
      key: "c1_sms", day: 6, channel: "sms", label: "SMS 1",
      purpose: "Single soft-touch text with call CTA",
      body: (c) =>
        `Hi ${c.firstName}, your TopQuote cancellation completes ${c.cancellationDate ? `on ${c.cancellationDate}` : "soon"}. If anything prompted it that we could fix, we're on ${c.phone}. No pressure either way`,
    },
    {
      key: "c3_email", day: 9, channel: "email", label: "Email 3",
      purpose: "Confirm the cancellation date; final invitation to talk",
      subject: (c) => `Your cancellation completes ${c.cancellationDate ? `on ${c.cancellationDate}` : "soon"}`,
      body: (c) =>
`Hi ${c.firstName},

A final note to confirm your policy ${c.policyNumber} will cancel${c.cancellationDate ? ` on ${c.cancellationDate}` : " as requested"}, with your refund following in line with your policy terms.

If you'd like to keep the policy, or reshape it into something that fits better, one call before that date is all it takes: ${c.phone}. After the date, this policy and its pricing can't be restored; new cover would mean a fresh application.

Whatever you decide, thank you for choosing TopQuote, and our door remains open if your needs change in future.

${signoff(c)}`,
    },
  ],
};

// ---------------------------------------------------------------------------
// Journey D: Cancelled / Lapsed Cover (Win-Back). Tone: warm, factual,
// zero guilt. We don't hold the exact reinstatement deadline, so the copy
// refers to the window in general terms (per the doc).
// ---------------------------------------------------------------------------

const JOURNEY_D: JourneyDef = {
  key: "d",
  name: "D. Cancelled / lapsed cover (win-back)",
  trigger: "Cover has already ended: cancelled outside cooling-off, or lapsed after the grace period. Goal: reinstatement within the insurer's window.",
  durationDays: 28,
  steps: [
    {
      key: "d1_email", day: 0, channel: "email", label: "Email 1",
      purpose: "Confirm cover has ended; introduce the reinstatement window",
      subject: () => "Your cover has ended, but for a short time it's simple to bring back",
      body: (c) =>
`Hi ${c.firstName},

Your life insurance policy (${c.policyNumber}) has now ended, which means the protection it provided has stopped.

We wanted you to know one important thing: for a limited period, it's usually possible to reinstate this exact policy, at the${c.premium ? ` ${c.premium}` : ""} price you fixed ${inStartYear(c)}, without starting again from scratch.

After that window closes, getting cover again means a brand-new application: new medical questions, new underwriting, and a price based on your age today${c.startYear ? ` rather than your age in ${c.startYear}` : ""}.

If ending the policy wasn't what you intended, or you're already having second thoughts, call us on ${c.phone} and we'll walk you through reinstating it.

${signoff(c)}`,
    },
    {
      key: "d1_sms", day: 2, channel: "sms", label: "SMS 1",
      purpose: "Short nudge; reinstatement is still simple right now",
      body: (c) =>
        `Hi ${c.firstName}, TopQuote here. Your life cover has ended, but for a short time it can usually be restored at your original price. Call ${c.phone}. Reply STOP to opt out`,
    },
    {
      key: "d2_email", day: 7, channel: "email", label: "Email 2",
      purpose: "The cost of replacing cover later (age, health, underwriting)",
      subject: () => "What replacing this policy later would really involve",
      body: (c) =>
`Hi ${c.firstName},

We'll keep this factual. If you ever want life cover again after your reinstatement window closes, here's what a new policy involves:

- A full new application, with medical and lifestyle questions answered as of today.
- Underwriting based on your current age and health. Premiums generally rise with age, and any conditions that have developed${c.startYear ? ` since ${c.startYear}` : ""} can mean higher prices or exclusions.
- No credit for the years you've already paid in.

Compare that with reinstatement: your old policy, your old price, usually restored with a phone call and any missed premiums brought up to date.

If there's any chance you'll want this protection again, the economical moment to act is now: ${c.phone}.

${signoff(c)}`,
    },
    {
      key: "d3_email", day: 14, channel: "email", label: "Email 3",
      purpose: "Empathy + options: the reason for the cover hasn't gone away",
      subject: () => "The reason you took this policy out probably hasn't gone away",
      body: (c) =>
`Hi ${c.firstName},

When you took out your policy${c.startYear ? ` in ${c.startYear}` : ""}, you did it for someone: a partner, children, a mortgage that shouldn't outlive you. Cancelling the policy doesn't usually cancel the reason.

If the monthly cost stopped working for you, it's worth knowing the all-or-nothing choice isn't the only one. Within your reinstatement window we can often restore a reduced version of your cover (protecting the essentials at a lower monthly cost) while keeping the underwriting you passed years ago.

And if your circumstances really have changed so much that you no longer need cover, a short call will confirm that too. Either way, you'll have decided with the full picture rather than by default.

We're on ${c.phone}, ${c.hours}. The window won't stay open for long.

${signoff(c)}`,
    },
    {
      key: "d2_sms", day: 21, channel: "sms", label: "SMS 2",
      purpose: "Deadline reminder",
      body: (c) =>
        `${c.firstName}, your window to restore your TopQuote life cover at your original ${c.startYear ? `${c.startYear} ` : ""}price is closing. Call ${c.phone} to keep it. Reply STOP to opt out`,
    },
    {
      key: "d4_email", day: 28, channel: "email", label: "Email 4",
      purpose: "Final email before the reinstatement window closes",
      subject: () => "Final call: your reinstatement window is closing",
      body: (c) =>
`Hi ${c.firstName},

This is the last time we'll write about your policy ${c.policyNumber}. Your window to reinstate it (same cover, same ${c.startYear ? `${c.startYear} ` : ""}price, no new underwriting) is closing.

After that date the policy is gone for good. Any future protection means a new application, priced on your age and health at the time.

If any part of you thinks you might want this cover, now or in a few years, the call that protects that option takes about ten minutes: ${c.phone}.

If we don't hear from you, we'll respect your decision and won't contact you about this policy again. Thank you for the years you spent with TopQuote. Our door is always open.

${signoff(c)}`,
    },
  ],
};

export const JOURNEYS: Record<JourneyKey, JourneyDef> = {
  a: JOURNEY_A,
  b: JOURNEY_B,
  c: JOURNEY_C,
  d: JOURNEY_D,
};

export function isJourneyKey(v: unknown): v is JourneyKey {
  return v === "a" || v === "b" || v === "c" || v === "d";
}

// ---------------------------------------------------------------------------
// Merge context construction (server-side only: reads env vars)
// ---------------------------------------------------------------------------

export interface CaseMergeRow {
  client_first_name: string | null;
  client_name: string;
  policy_number: string;
  net_premium: string | number | null;
  policy_start_date: string | null;  // date or ISO string
  off_risk_date: string | null;
}

const TITLES = new Set(["mr", "mrs", "miss", "ms", "dr", "mx", "master", "sir"]);

export function firstNameFrom(row: Pick<CaseMergeRow, "client_first_name" | "client_name">): string {
  const explicit = row.client_first_name?.trim();
  if (explicit) return explicit;
  const parts = row.client_name.trim().split(/\s+/).filter(Boolean);
  const first = parts.find((p) => !TITLES.has(p.toLowerCase().replace(/\./g, "")));
  return first || "there";
}

function fmtLongDate(d: string | null): string | null {
  if (!d) return null;
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return null;
  return dt.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

function fmtGbp(v: string | number | null): string | null {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/**
 * Build the merge context for a case. Returns null (with a reason) when
 * TOPQUOTE_PHONE isn't configured: the phone number is the single CTA in
 * every message, so nothing may send without it.
 */
export function buildMergeCtx(row: CaseMergeRow): { ctx: MergeCtx | null; reason?: string } {
  const phone = (process.env.TOPQUOTE_PHONE || "").trim();
  if (!phone) return { ctx: null, reason: "TOPQUOTE_PHONE env var not set (it is the call-us number in every message)" };
  const hours = (process.env.TOPQUOTE_HOURS || "9am-5pm").trim();
  const offRisk = fmtLongDate(row.off_risk_date);
  const startYear = row.policy_start_date ? String(new Date(row.policy_start_date).getFullYear()) : null;
  return {
    ctx: {
      firstName: firstNameFrom(row),
      policyNumber: row.policy_number,
      premium: fmtGbp(row.net_premium),
      startYear: startYear && startYear !== "NaN" ? startYear : null,
      lapseDate: offRisk,
      collectionDate: null,
      cancellationDate: offRisk,
      phone,
      hours,
    },
  };
}
