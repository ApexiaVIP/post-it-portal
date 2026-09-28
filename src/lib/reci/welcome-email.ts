/**
 * "Thank you for choosing TopQuote" welcome email (Poz, 28 Sep 2026).
 *
 * The copy is Poz's, word for word. The only logic is merge fields and
 * singular/plural wording, because one client often has several deals
 * (3-for-2 sales, joint + single cover) and should get ONE email that
 * lists every policy rather than a string of near-identical ones.
 *
 * Framework-free: the API route renders previews and sends from here.
 */

export interface WelcomePolicy {
  provider: string;
  policyNumber: string;
  startDate: string;      // yyyy-mm-dd
  premium: number;
  firstDdDate: string;    // yyyy-mm-dd
}

export interface WelcomeInput {
  clientName: string;
  adviserName: string;
  policies: WelcomePolicy[];
}

export const TOPQUOTE_PHONE = "0161 974 3710";
export const TOPQUOTE_EMAIL = "hello@topquote.uk.com";

export const WELCOME_SUBJECT = "Thank you for choosing TopQuote to help look after you and your family";

/**
 * Insurer names as typed on the RECI vary ("L&G", "AVIVA", "MetLIfe").
 * Known spellings map to the insurer's proper name for the client; any
 * other value is used as typed and flagged in the send panel.
 */
const PROVIDER_NAMES: Record<string, string> = {
  lg: "Legal & General",
  legalgeneral: "Legal & General",
  legalandgeneral: "Legal & General",
  metlife: "MetLife",
  metlifw: "MetLife",
  metife: "MetLife",
  zurich: "Zurich",
  vitality: "Vitality",
  exeter: "The Exeter",
  theexeter: "The Exeter",
  aviva: "Aviva",
  lv: "LV=",
  royallondon: "Royal London",
};

export function providerDisplayName(raw: string | null | undefined): { name: string; recognised: boolean } {
  const typed = (raw ?? "").trim();
  const key = typed.toLowerCase().replace(/[^a-z]/g, "");
  const mapped = PROVIDER_NAMES[key];
  return mapped ? { name: mapped, recognised: true } : { name: typed, recognised: false };
}

export function formatLongDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
}

function money(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** "A", "A and B", "A, B and C". */
function joinAnd(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

type Block =
  | { kind: "h1"; text: string }
  | { kind: "h2"; text: string }
  | { kind: "p"; text: string }
  | { kind: "details"; rows: [string, string][]; caption?: string };

function buildBlocks(i: WelcomeInput): Block[] {
  const many = i.policies.length > 1;
  const providers = Array.from(new Set(i.policies.map((p) => p.provider)));
  const providerList = joinAnd(providers);
  const starts = Array.from(new Set(i.policies.map((p) => p.startDate)));
  const adviser = i.adviserName;

  const intro = !many
    ? `We are delighted to confirm that your new protection policy with ${providerList} is now in force, with your cover commencing on ${formatLongDate(starts[0])}.`
    : starts.length === 1
      ? `We are delighted to confirm that your new protection policies with ${providerList} are now in force, with your cover commencing on ${formatLongDate(starts[0])}.`
      : `We are delighted to confirm that your new protection policies with ${providerList} are now in force. The start date for each policy is shown below.`;

  const blocks: Block[] = [
    { kind: "h1", text: WELCOME_SUBJECT },
    { kind: "p", text: `Dear ${i.clientName},` },
    { kind: "p", text: intro },
    { kind: "p", text: "Thank you for choosing TopQuote to arrange your protection. We really appreciate your business and hope you are pleased to have this important cover in place." },
    { kind: "h2", text: "Your policy details" },
  ];
  i.policies.forEach((p, idx) => {
    blocks.push({
      kind: "details",
      caption: many ? `Policy ${idx + 1} of ${i.policies.length}` : undefined,
      rows: [
        ["Insurance Provider", p.provider],
        ["Policy Number", p.policyNumber],
        ["Policy Start Date", formatLongDate(p.startDate)],
        ["Monthly Premium", money(p.premium)],
        ["First Collection Date", formatLongDate(p.firstDdDate)],
        ["Adviser", adviser],
      ],
    });
  });
  blocks.push(
    { kind: "p", text: "Please retain these details for your records." },

    { kind: "h2", text: "Your first payment" },
    {
      kind: "p",
      text: !many
        ? `Your first Direct Debit will be collected by ${providerList} on or shortly after the collection date agreed with ${adviser} during your application.`
        : `The first Direct Debit for each policy will be collected by ${providers.length === 1 ? providerList : "the insurer"} on or shortly after the collection date agreed with ${adviser} during your application.`,
    },

    { kind: "h2", text: "Your policy documents" },
    { kind: "p", text: "Your insurer will issue your policy documentation either electronically or by post, depending on the delivery method selected during your application. These documents would normally be expected within the next 7–10 days." },
    { kind: "p", text: "If you have not received them after this time, please contact us and we will be happy to arrange for duplicate copies to be issued." },

    { kind: "h2", text: "Checking Your Details" },
    { kind: "p", text: `Your insurance provider will supply you with a copy of the application discussed and completed with your adviser, ${adviser}, and will usually invite you to check that the personal, lifestyle and medical information recorded is correct.` },
    { kind: "p", text: "This is an important final opportunity to make sure the information captured during your application is a true and accurate reflection of the information you provided." },
    { kind: "p", text: "Providers may refer to this process as “Checking Your Details” or something similar." },
    { kind: "p", text: "Please complete this as soon as possible, confirming that the information is correct or making any necessary amendments at your earliest convenience." },
    { kind: "p", text: `If you have any questions or need our help, please contact us on ${TOPQUOTE_PHONE}.` },

    { kind: "h2", text: "Existing policies" },
    { kind: "p", text: `If your new ${many ? "policies are" : "policy is"} replacing existing protection, please do not cancel your previous cover unless you are satisfied that your new ${many ? "policies are" : "policy is"} in force, and you know whether cancellation has already been arranged.` },
    { kind: "p", text: "Where TopQuote has arranged the replacement of an existing policy with a new policy from the same insurer, the cancellation may already have been arranged to coincide with the start of your new cover." },
    { kind: "p", text: "If you are unsure whether your previous policy has been cancelled, please contact us before taking any action and we will be happy to check this for you." },

    { kind: "h2", text: `Placing your ${many ? "policies" : "policy"} into Trust` },
    { kind: "p", text: `If it is your intention to place your new ${many ? "policies" : "policy"} into Trust, and this was not arranged when your ${many ? "policies were" : "policy was"} set up with ${adviser}, we would encourage you to do this as soon as possible.` },
    { kind: "p", text: `Please contact the relevant Trust department at ${providerList} to discuss the options available to you and obtain the appropriate documentation.` },
    { kind: "p", text: `Whilst TopQuote cannot complete the Trust documentation on your behalf, we can provide some guidance should you need our help on a standard discretionary trust. Please contact your adviser here at TopQuote on ${TOPQUOTE_PHONE}.` },

    { kind: "h2", text: "We’re here to help" },
    { kind: "p", text: `Although your new ${many ? "policies are" : "policy is"} now in place, our relationship with you doesn’t end here.` },
    { kind: "p", text: "If your circumstances change, you have a question about your cover, or you simply need our help in the future, please get in touch." },
  );
  return blocks;
}

const SIGN_OFF = [
  "Thank you once again for choosing TopQuote to help look after you and your family.",
  "Kind regards,",
  "The TopQuote Customer Services Team",
];

export function renderWelcomeEmail(i: WelcomeInput): { subject: string; html: string; text: string } {
  const blocks = buildBlocks(i);

  // Plain-text part.
  const t: string[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") t.push(b.text.toUpperCase(), "");
    else if (b.kind === "h2") t.push(b.text, "-".repeat(b.text.length));
    else if (b.kind === "p") t.push(b.text, "");
    else {
      if (b.caption) t.push(b.caption);
      for (const [k, v] of b.rows) t.push(`${k}: ${v}`);
      t.push("");
    }
  }
  t.push("TopQuote Ltd", `Telephone: ${TOPQUOTE_PHONE}`, `Email: ${TOPQUOTE_EMAIL}`, "");
  t.push(SIGN_OFF[0], "", SIGN_OFF[1], SIGN_OFF[2]);

  // HTML part: table layout + inline styles for email clients.
  const navy = "#1e3a5f";
  const h: string[] = [];
  for (const b of blocks) {
    if (b.kind === "h1") {
      h.push(`<h1 style="margin:0 0 20px;font-size:22px;line-height:1.3;color:${navy};">${esc(b.text)}</h1>`);
    } else if (b.kind === "h2") {
      h.push(`<h2 style="margin:26px 0 8px;font-size:17px;line-height:1.3;color:${navy};">${esc(b.text)}</h2>`);
    } else if (b.kind === "p") {
      h.push(`<p style="margin:0 0 12px;">${esc(b.text)}</p>`);
    } else {
      const caption = b.caption
        ? `<tr><td colspan="2" style="padding:8px 12px;background:#e8eef5;font-weight:bold;color:${navy};border:1px solid #d5dde8;">${esc(b.caption)}</td></tr>`
        : `<tr><td style="padding:8px 12px;background:#e8eef5;font-weight:bold;color:${navy};border:1px solid #d5dde8;">Policy Information</td><td style="padding:8px 12px;background:#e8eef5;font-weight:bold;color:${navy};border:1px solid #d5dde8;">Details</td></tr>`;
      const rows = b.rows.map(([k, v]) =>
        `<tr><td style="padding:8px 12px;border:1px solid #d5dde8;width:45%;color:#475569;">${esc(k)}</td><td style="padding:8px 12px;border:1px solid #d5dde8;font-weight:bold;">${esc(v)}</td></tr>`,
      ).join("");
      h.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 14px;font-size:15px;">${caption}${rows}</table>`);
    }
  }
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(WELCOME_SUBJECT)}</title></head>
<body style="margin:0;padding:0;background:#f1f5f9;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f5f9;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:6px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.55;color:#1e293b;">
<tr><td style="background:${navy};padding:18px 28px;color:#ffffff;font-size:22px;font-weight:bold;letter-spacing:0.5px;">TopQuote</td></tr>
<tr><td style="padding:28px;">
${h.join("\n")}
<p style="margin:24px 0 12px;">${esc(SIGN_OFF[0])}</p>
<p style="margin:0;">${esc(SIGN_OFF[1])}<br><strong>${esc(SIGN_OFF[2])}</strong></p>
</td></tr>
<tr><td style="background:#f8fafc;border-top:1px solid #e2e8f0;padding:18px 28px;font-size:13px;color:#475569;">
<strong style="color:${navy};">TopQuote Ltd</strong><br>
Telephone: <a href="tel:${TOPQUOTE_PHONE.replace(/\s/g, "")}" style="color:${navy};">${TOPQUOTE_PHONE}</a><br>
Email: <a href="mailto:${TOPQUOTE_EMAIL}" style="color:${navy};">${TOPQUOTE_EMAIL}</a>
</td></tr>
</table>
</td></tr></table>
</body></html>`;

  return { subject: WELCOME_SUBJECT, html, text: t.join("\n") };
}
