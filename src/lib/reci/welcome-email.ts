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

/** Hosted on the portal (public/, outside the login gate) so email clients can fetch it. */
function logoUrl(): string {
  const base = (process.env.PUBLIC_DASHBOARD_URL || "https://post-it-portal.vercel.app").replace(/\/$/, "");
  return `${base}/email/topquote-logo.png`;
}
const TEAL = "#06babc";

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

const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];

/** 1st, 2nd, 3rd, 4th ... 11th, 12th, 13th ... 21st (Guy, 28 Sep 2026). */
function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${({ 1: "st", 2: "nd", 3: "rd" } as Record<number, string>)[n % 10] ?? "th"}`;
}

export function formatLongDate(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return `${ordinal(d.getUTCDate())} ${MONTH_NAMES[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
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
  | { kind: "list"; items: { lead: string; text: string }[] }
  | { kind: "details"; rows: [string, string][]; caption?: string };

/**
 * Shortened 2 Oct 2026 (Guy found the first version too long): every
 * point from Poz's copy is kept, but each is said once and the four
 * "what to do now" sections sit together as a short list.
 */
function buildBlocks(i: WelcomeInput): Block[] {
  const many = i.policies.length > 1;
  const providers = Array.from(new Set(i.policies.map((p) => p.provider)));
  const providerList = joinAnd(providers);
  const starts = Array.from(new Set(i.policies.map((p) => p.startDate)));
  const adviser = i.adviserName;
  const pol = many ? "policies" : "policy";

  const intro = starts.length === 1
    ? `We are delighted to confirm that your new protection ${pol} with ${providerList} ${many ? "are" : "is"} now in force, with your cover starting on ${formatLongDate(starts[0])}.`
    : `We are delighted to confirm that your new protection ${pol} with ${providerList} are now in force. The start date for each policy is shown below.`;

  const blocks: Block[] = [
    { kind: "h1", text: WELCOME_SUBJECT },
    { kind: "p", text: `Dear ${i.clientName},` },
    { kind: "p", text: intro },
    { kind: "p", text: "Thank you for choosing TopQuote to arrange your protection. We really appreciate your business." },
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
  const collector = providers.length === 1 ? providerList : "the insurer";
  blocks.push(
    {
      kind: "p",
      text: `Please keep these details for your records. ${many ? "The first Direct Debit for each policy" : "Your first Direct Debit"} will be collected by ${collector} on or shortly after the first collection date shown above.`,
    },

    { kind: "h2", text: "What happens next" },
    {
      kind: "list",
      items: [
        {
          lead: "Your policy documents",
          text: "Your insurer will send these by email or post, depending on what you chose when you applied, normally within 7 to 10 days. If they have not arrived by then, let us know and we will arrange copies.",
        },
        {
          lead: "Checking your details",
          text: `Your insurer will send you a copy of the application you completed with ${adviser} and ask you to check that the personal, lifestyle and medical information is correct. This is an important final opportunity to make sure it is accurate, so please do this as soon as possible and make any changes needed.`,
        },
        {
          lead: "Existing cover",
          text: `If your new ${pol} ${many ? "replace" : "replaces"} existing cover, please do not cancel your old policy until you are sure the new cover is in force and you know whether the cancellation has already been arranged. Where we have replaced a policy with the same insurer, we may have arranged this already. If you are unsure, please call us before taking any action.`,
        },
        {
          lead: `Placing your ${pol} in Trust`,
          text: `If you would like to place your ${pol} in Trust and this was not arranged with ${adviser}, please contact the Trust department at ${providerList} as soon as possible. We cannot complete the Trust documents for you, but we can guide you on a standard discretionary trust.`,
        },
      ],
    },

    { kind: "h2", text: "We’re here to help" },
    { kind: "p", text: `Our relationship with you doesn’t end here. If your circumstances change or you have a question about your cover, now or in the future, please call us on ${TOPQUOTE_PHONE} or email ${TOPQUOTE_EMAIL}.` },
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
    else if (b.kind === "list") {
      for (const it of b.items) t.push(`- ${it.lead}: ${it.text}`, "");
    } else {
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
    } else if (b.kind === "list") {
      const items = b.items.map((it) =>
        `<tr><td style="width:14px;vertical-align:top;padding:7px 0 10px;"><div style="width:7px;height:7px;border-radius:4px;background:${TEAL};"></div></td>` +
        `<td style="padding:0 0 10px;"><strong style="color:${navy};">${esc(it.lead)}.</strong> ${esc(it.text)}</td></tr>`,
      ).join("");
      h.push(`<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;border-collapse:collapse;margin:0 0 6px;">${items}</table>`);
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
<tr><td style="background:${navy};padding:20px 28px;border-bottom:4px solid ${TEAL};">
<img src="${logoUrl()}" width="200" height="55" alt="TopQuote" style="display:block;width:200px;height:55px;border:0;outline:none;text-decoration:none;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:bold;">
</td></tr>
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
