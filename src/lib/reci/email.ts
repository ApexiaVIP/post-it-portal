/**
 * Outbound RECI emails (cancellation / clawback / NYS-checked / forecast /
 * notify / resolved).
 *
 * Provider migration June 2026: moved from personal Gmail (jamesacton007@
 * gmail.com via smtp.gmail.com) to data@topquote.uk on Purelymail.
 *
 * Env (set in Vercel):
 *   SMTP_USER              = data@topquote.uk
 *   SMTP_PASSWORD          = Purelymail account password
 *   SMTP_HOST              = smtp.purelymail.com  (default if unset)
 *   SMTP_PORT              = 465                  (default if unset)
 *   SMTP_FROM_NAME         = "Top Quote RECI"     (default if unset)
 *   RECI_CANCELLATION_CC   = comma-separated list (e.g. "pauline@...,jimmy@...")
 *
 * Legacy fallback: if SMTP_USER / SMTP_PASSWORD aren't set, falls back to
 * GMAIL_USER / GMAIL_APP_PASSWORD on smtp.gmail.com so a deploy doesn't
 * break if the Vercel env update lags the code change. Remove this fallback
 * once the Purelymail vars are verified live in production.
 */
import nodemailer from "nodemailer";
import { sql } from "@vercel/postgres";
import {
  CANCELLATION_REASON_LABELS,
  type CancellationReason,
  type Deal,
  type Adviser,
} from "./schema";

const DEFAULT_HOST = "smtp.purelymail.com";
const DEFAULT_PORT = 465;
const LEGACY_HOST  = "smtp.gmail.com";

// IMPORTANT: do NOT cache the transporter at module scope. We tried that
// against Gmail and it was fine, but Purelymail (and most strict SMTP
// providers) close idle connections aggressively. The serverless lambda
// can stay warm across multiple invocations, so a cached transporter from
// minutes ago will be holding a dead socket -- second send appears to
// succeed but silently never reaches the wire.
//
// Recreating per call costs ~microseconds at our volume (a few emails per
// day) and rules out the entire class of "first send works, later sends
// silently fail" bugs.
function getTransporter(): nodemailer.Transporter | null {
  const user = process.env.SMTP_USER  || process.env.GMAIL_USER;
  const pass = process.env.SMTP_PASSWORD || process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  const host = process.env.SMTP_HOST
            || (process.env.SMTP_USER ? DEFAULT_HOST : LEGACY_HOST);
  const port = Number(process.env.SMTP_PORT) || DEFAULT_PORT;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // 465 = implicit TLS; 587 = STARTTLS
    auth: { user, pass },
    // Reasonable timeouts so a hanging SMTP server can't wedge the
    // serverless function.
    connectionTimeout: 10_000,
    socketTimeout:     10_000,
    greetingTimeout:    5_000,
  });
}

// Single source of truth for the From header. SMTP_USER beats GMAIL_USER
// so the new sender appears as soon as Vercel has the new env vars,
// regardless of which transport ended up being used.
function fromHeader(label: string): string {
  const addr = process.env.SMTP_USER || process.env.GMAIL_USER || "";
  const name = process.env.SMTP_FROM_NAME || label;
  return `"${name}" <${addr}>`;
}

// Deep-link from any notification or resolved email back into the
// Clawback Dashboard. The search box on the dashboard pre-fills from
// ?q= so passing the policy number drops the recipient straight onto
// the specific case (they can click the row to open the drawer).
//
// PUBLIC_DASHBOARD_URL is settable in Vercel for preview environments.
function clawbackCaseUrl(policyNumber: string): string {
  const base = (process.env.PUBLIC_DASHBOARD_URL || "https://post-it-portal.vercel.app").replace(/\/$/, "");
  return `${base}/reci/clawback?q=${encodeURIComponent(policyNumber)}`;
}

// Dispatch helper: opens a fresh transporter per call (Purelymail closes
// idle connections), sends the message, and ALWAYS console.errors both
// the envelope and the outcome so Vercel reliably logs every send. Vercel
// has been seen to drop async console.log lines from serverless functions
// when the response has already been sent, so success and failure both
// go through console.error.
async function dispatchMail(opts: {
  label: string;            // "cancellation" | "clawback" | "nys-check" | ...
  fromName: string;         // display name for the From header
  to: string[];
  cc: string[];
  subject: string;
  text: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}): Promise<{ sent: boolean; reason?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.error(`[reci-email:${opts.label}] no SMTP creds; aborting`);
    return { sent: false, reason: "no SMTP credentials" };
  }
  if (opts.to.length === 0) {
    console.error(`[reci-email:${opts.label}] no recipients; aborting`);
    return { sent: false, reason: "no recipient" };
  }
  const envelope = {
    label:   opts.label,
    from:    fromHeader(opts.fromName),
    to:      opts.to.join(","),
    cc:      opts.cc.length > 0 ? opts.cc.join(",") : "(none)",
    subject: opts.subject,
  };
  console.error(`[reci-email:${opts.label}] sending`, envelope);
  try {
    const info = await transporter.sendMail({
      from: envelope.from,
      to:   envelope.to,
      cc:   opts.cc.length > 0 ? opts.cc.join(",") : undefined,
      subject: opts.subject,
      text: opts.text,
      html: opts.html,
      attachments: opts.attachments,
    });
    // `info.response` is the SMTP server's 250 acknowledgement string.
    // `info.accepted` / `info.rejected` are arrays of addresses.
    console.error(`[reci-email:${opts.label}] sent`, {
      messageId: info.messageId,
      response:  info.response,
      accepted:  info.accepted,
      rejected:  info.rejected,
      envelopeFrom: info.envelope?.from,
      envelopeTo:   info.envelope?.to,
    });
    return { sent: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[reci-email:${opts.label}] FAILED`, { reason, envelope });
    return { sent: false, reason };
  }
}

// ---------------------------------------------------------------------------
// Senior adviser CC chain. Pauline / Poz wants any cancellation / clawback /
// NYS-checked email to also notify the senior advisers above the deal owner:
//
//   - Tan sits at the top -- CC'd on every non-Tan deal.
//   - Hayder sits mid-level -- CC'd on deals belonging to Gurdaht, Atikur or
//     Jack (i.e. the juniors). Not CC'd on her own deals or on Tan's.
//   - Tan's own deals: no extra CC (only the existing management CC list).
//
// Names are looked up from the advisers table so we use whatever email is
// currently on file. If a senior row is missing an email we just skip them
// (fail-safe -- the existing management CC list still goes out).
// ---------------------------------------------------------------------------
async function fetchSeniorAdviserCc(ownerName: string): Promise<string[]> {
  if (ownerName === "Tan") return [];
  const needed = ownerName === "Hayder" ? ["Tan"] : ["Tan", "Hayder"];
  const { rows } = await sql<{ name: string; email: string | null }>`
    SELECT name, email FROM advisers
  `;
  const emailByName = new Map(rows.map((r) => [r.name, r.email]));
  const out: string[] = [];
  for (const n of needed) {
    const e = emailByName.get(n);
    if (e) out.push(e);
  }
  return out;
}

// Build the final CC array: managers + senior-chain, deduped, with anything
// already in the To line removed so nobody gets the email twice.
function buildCc(cc: string[], senior: string[], to: string[]): string[] {
  const toSet = new Set(to);
  const merged = new Set<string>();
  for (const e of [...cc, ...senior]) {
    if (e && !toSet.has(e)) merged.add(e);
  }
  return Array.from(merged);
}

export interface CancellationEmailInput {
  deal: Deal;
  adviser: Adviser;
  reason: CancellationReason;
  notes: string | null;
  changedBy: string;
}

function gbp(n: number) {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export async function sendCancellationEmail(i: CancellationEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const ccList = (process.env.RECI_CANCELLATION_CC || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const to: string[] = [];
  const cc: string[] = [];

  // Adviser is the To. CC is Pauline / management.
  if (i.adviser.email) {
    to.push(i.adviser.email);
    cc.push(...ccList);
  } else if (ccList.length > 0) {
    // Adviser has no email on file — fall back to sending the alert to the CC list.
    to.push(...ccList);
  } else {
    return { sent: false, reason: "no recipient" };
  }

  // Senior chain (Tan / Hayder) on top of the configured management CC list.
  const seniorCc = await fetchSeniorAdviserCc(i.adviser.name);
  const ccArr = buildCc(cc, seniorCc, to);

  const reasonLabel = CANCELLATION_REASON_LABELS[i.reason];
  const subject = `[RECI] Cancelled: ${i.deal.client} — ${reasonLabel}`;

  const lines = [
    `Hi ${i.adviser.name},`,
    ``,
    `One of your deals has been moved to Cancelled in the RECI portal.`,
    ``,
    `  Client:        ${i.deal.client}`,
    `  Postcode:      ${i.deal.postcode || "—"}`,
    `  Week:          ${i.deal.week}`,
    `  Provider:      ${i.deal.provider || "—"}`,
    `  Premium:       ${i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—"}`,
    `  Reason:        ${reasonLabel}`,
    `  Notes:         ${i.notes || "—"}`,
    `  Cancelled by:  ${i.changedBy}`,
    ``,
    `Please call the client back to try to save / win back this deal.`,
    ``,
    `— RECI portal`,
  ];
  const text = lines.join("\n");

  const html =
    `<p>Hi ${escapeHtml(i.adviser.name)},</p>` +
    `<p>One of your deals has been moved to <strong>Cancelled</strong> in the RECI portal.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.deal.client) +
    row("Postcode", i.deal.postcode || "—") +
    row("Week", String(i.deal.week)) +
    row("Provider", i.deal.provider || "—") +
    row("Premium", i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—") +
    row("Reason", reasonLabel) +
    row("Notes", i.notes || "—") +
    row("Cancelled by", i.changedBy) +
    `</table>` +
    `<p>Please call the client back to try to save / win back this deal.</p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "cancellation",
    fromName: "RECI",
    to, cc: ccArr,
    subject, text, html,
  });
}

function row(label: string, value: string) {
  return (
    `<tr>` +
    `<td style="padding:4px 12px 4px 0;color:#555">${escapeHtml(label)}</td>` +
    `<td style="padding:4px 0"><strong>${escapeHtml(value)}</strong></td>` +
    `</tr>`
  );
}

// ---------------------------------------------------------------------------
// Clawback email — sent when a deal moves into the Clawback column (i.e. a
// previously Paid deal has had its commission reclaimed). Mirrors the
// cancellation email but is for post-completion refunds. Commission figure is
// deliberately omitted, same rule as the cancellation email.
// ---------------------------------------------------------------------------
export interface ClawbackEmailInput {
  deal: Deal;
  adviser: Adviser;
  notes: string | null;
  changedBy: string;
}

export async function sendClawbackEmail(i: ClawbackEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const ccList = (process.env.RECI_CANCELLATION_CC || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const to: string[] = [];
  const cc: string[] = [];
  if (i.adviser.email) {
    to.push(i.adviser.email);
    cc.push(...ccList);
  } else if (ccList.length > 0) {
    to.push(...ccList);
  } else {
    return { sent: false, reason: "no recipient" };
  }

  const seniorCc = await fetchSeniorAdviserCc(i.adviser.name);
  const ccArr = buildCc(cc, seniorCc, to);

  const subject = `[RECI] Clawback: ${i.deal.client}`;

  const lines = [
    `Hi ${i.adviser.name},`,
    ``,
    `Commission has been clawed back on one of your deals in the RECI portal.`,
    ``,
    `  Client:        ${i.deal.client}`,
    `  Week:          ${i.deal.week}`,
    `  Provider:      ${i.deal.provider || "—"}`,
    `  Premium:       ${i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—"}`,
    `  Notes:         ${i.notes || "—"}`,
    `  Clawback by:   ${i.changedBy}`,
    ``,
    `Please follow up with the client where appropriate.`,
    ``,
    `— RECI portal`,
  ];
  const text = lines.join("\n");

  const html =
    `<p>Hi ${escapeHtml(i.adviser.name)},</p>` +
    `<p>Commission has been <strong>clawed back</strong> on one of your deals in the RECI portal.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.deal.client) +
    row("Week", String(i.deal.week)) +
    row("Provider", i.deal.provider || "—") +
    row("Premium", i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—") +
    row("Notes", i.notes || "—") +
    row("Clawback by", i.changedBy) +
    `</table>` +
    `<p>Please follow up with the client where appropriate.</p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback",
    fromName: "RECI",
    to, cc: ccArr,
    subject, text, html,
  });
}

// ---------------------------------------------------------------------------
// NYS "Checked" email — sent when Pauline marks a Not Yet Submitted deal as
// checked because she's not happy with it and wants the seller to address
// something before it can be submitted.
// ---------------------------------------------------------------------------
export interface NysCheckEmailInput {
  deal: Deal;
  adviser: Adviser;
  notes: string | null;
  changedBy: string;
}

export async function sendNysCheckEmail(i: NysCheckEmailInput): Promise<{ sent: boolean; reason?: string }> {
  const ccList = (process.env.RECI_CANCELLATION_CC || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const to: string[] = [];
  const cc: string[] = [];
  if (i.adviser.email) {
    to.push(i.adviser.email);
    cc.push(...ccList);
  } else if (ccList.length > 0) {
    to.push(...ccList);
  } else {
    return { sent: false, reason: "no recipient" };
  }

  const seniorCc = await fetchSeniorAdviserCc(i.adviser.name);
  const ccArr = buildCc(cc, seniorCc, to);

  const subject = `[RECI] Deal needs review: ${i.deal.client}`;

  const lines = [
    `Hi ${i.adviser.name},`,
    ``,
    `Pauline has reviewed one of your Not Yet Submitted deals and has flagged it for attention before it can move forward.`,
    ``,
    `  Client:       ${i.deal.client}`,
    `  Week:         ${i.deal.week}`,
    `  Provider:     ${i.deal.provider || "—"}`,
    `  Premium:      ${i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—"}`,
    `  Notes:        ${i.notes || "—"}`,
    `  Checked by:   ${i.changedBy}`,
    ``,
    `Please address the notes above. Once Pauline is happy she'll move the deal into In Processing or On Risk NYP, which will release the Checked status.`,
    ``,
    `— RECI portal`,
  ];
  const text = lines.join("\n");

  const html =
    `<p>Hi ${escapeHtml(i.adviser.name)},</p>` +
    `<p>Pauline has reviewed one of your <strong>Not Yet Submitted</strong> deals and has flagged it for attention before it can move forward.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.deal.client) +
    row("Week", String(i.deal.week)) +
    row("Provider", i.deal.provider || "—") +
    row("Premium", i.deal.premium != null ? gbp(Number(i.deal.premium)) : "—") +
    row("Notes", i.notes || "—") +
    row("Checked by", i.changedBy) +
    `</table>` +
    `<p>Please address the notes above. Once Pauline is happy she'll move the deal into In Processing or On Risk NYP, which will release the Checked status.</p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "nys-check",
    fromName: "RECI",
    to, cc: ccArr,
    subject, text, html,
  });
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---------------------------------------------------------------------------
// POST-COMPLETION CLAWBACK EMAILS
// ---------------------------------------------------------------------------
//
// Two flows from Pauline's brief:
//
//   1. "New notification" -- when Poz hits Notify on a clawback case, the
//      relevant CAM gets the email so they can act. Routing per bucket:
//        - adviser  -> To = the CAM; CC = Guy + management
//        - xstaff   -> To = Tan + Hayder; CC = Guy + management
//        - legacy / needs_review -> To = Guy + management (no CAM to chase)
//
//   2. "Resolved" -- when a case lands in saved / resold / dead / etc. on
//      the dashboard, an email goes back to Guy with Poz / Jimmy on CC.
//
// Both deliberately omit the £ figures (per Pauline's existing rule on
// the cancellation / clawback / NYS emails) -- the dashboard is where
// money detail lives. Guy still gets the policy + client identifiers
// so he can look the case up himself.
//
// Env:
//   RECI_CLAWBACK_GUY_EMAIL    = single address for Guy
//   RECI_CANCELLATION_CC       = reused for management CC (Pauline / Jimmy)
// ---------------------------------------------------------------------------

// V2 statuses (10 Jul 2026) + legacy names so history strings in old
// emails still render sensibly.
const RESOLVED_STATUS_LABELS: Record<string, string> = {
  open:            "Not worked",
  saved_cfo:       "Saved CFO",
  saved_lapse:     "Saved Lapse",
  resold_on:       "Resold On",
  redraw_on:       "Redraw On",
  dd_reinstated:   "DD Reinstated",
  bp_saved:        "BP Saved",
  lost_cfo:        "Lost CFO",
  lost_lapse:      "Lost Lapse",
  resold_off:      "Resold Off",
  redraw_off:      "Redraw Off",
  dd_cancelled:    "DD Mandate Cancelled",
  bp_off:          "Bounced Premium Off",
  dead_client:     "Dead Client - Claim Declined",
  post_completion: "Post Completion - Medical Decline",
  closed:          "Closed",
  // legacy
  saved:      "Saved",
  resold:     "Resold",
  dead:       "Lost",
  reinstated: "Reinstated",
  redraw:     "Redraw",
};

function managementCc(): string[] {
  return (process.env.RECI_CANCELLATION_CC || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
}

function guyEmail(): string | null {
  const v = (process.env.RECI_CLAWBACK_GUY_EMAIL || "").trim();
  return v.length > 0 ? v : null;
}

// Resolve the CAM email + name for a clawback case based on its bucket /
// adviser_id. For xstaff returns Tan + Hayder. For adviser returns just
// that adviser. For legacy / needs_review returns no CAM.
async function resolveCamRecipients(adviserId: number | null, bucket: string): Promise<{ to: string[]; label: string }> {
  if (bucket === "adviser" && adviserId !== null) {
    const r = await sql<{ name: string; email: string | null }>`
      SELECT name, email FROM advisers WHERE id = ${adviserId}
    `;
    const a = r.rows[0];
    if (!a || !a.email) return { to: [], label: a?.name || "CAM" };
    return { to: [a.email], label: a.name };
  }
  if (bucket === "xstaff") {
    const r = await sql<{ name: string; email: string | null }>`
      SELECT name, email FROM advisers WHERE name = ANY(ARRAY['Tan','Hayder'])
    `;
    const emails = r.rows.map((x) => x.email).filter((e): e is string => !!e);
    return { to: emails, label: "Tan + Hayder (Xstaff)" };
  }
  return { to: [], label: bucket };
}

export interface ClawbackNotifyInput {
  caseId: number;
  clientName: string;
  /** Client date of birth, ISO yyyy-mm-dd. Helpful for CRM lookups. */
  clientDob?: string | null;
  policyNumber: string;
  postcode: string | null;
  provider: string;
  policyType: string | null;
  ebahWarning: string | null;
  clawbackDate: string | null;
  /** Date L&G generated the EBAH report. Only set on auto-Notify from ingest. */
  ebahReportDate?: string | null;
  ebahAgentName: string;
  adviserId: number | null;
  agentBucket: string;
  /** "new_ow" => subject gets a [NEW OW] prefix so it stands out in the inbox. */
  source?: string | null;
  pozNote: string | null;
  actor: string;
}

/** Inline ISO -> UK formatter (matches the dashboard's fmtDate). */
function ukDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  const m = iso.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

export async function sendClawbackNotifyEmail(i: ClawbackNotifyInput): Promise<{ sent: boolean; reason?: string }> {
  const cam = await resolveCamRecipients(i.adviserId, i.agentBucket);
  const cc = managementCc();
  // Guy asked (7 Jul 2026) to come off per-case notifications. He only
  // gets the daily stale-case summary now.

  // If the bucket has no CAM (legacy / needs_review) fall back to sending
  // straight to management so the case isn't silently lost.
  let to: string[];
  if (cam.to.length > 0) {
    to = cam.to;
  } else {
    to = [...cc];
    if (to.length === 0) return { sent: false, reason: "no recipient" };
  }
  const finalCc = buildCc(cc, [], to);

  const newOwPrefix = i.source === "new_ow" ? "[NEW OW] " : "";
  const postcodeTag = i.postcode ? ` [${i.postcode}]` : "";
  const subject = `${newOwPrefix}[RECI Clawback]${postcodeTag} ${i.clientName} (${i.policyNumber})`;

  const greeting = cam.to.length > 0
    ? `Hi ${escapeHtml(i.agentBucket === "xstaff" ? "Tan + Hayder" : cam.label)},`
    : `Hi team,`;

  const reason = i.ebahWarning || "Clawback notification";

  const lines = [
    cam.to.length > 0
      ? `Hi ${i.agentBucket === "xstaff" ? "Tan + Hayder" : cam.label},`
      : `Hi team,`,
    ``,
    `A post-completion clawback case needs your attention.`,
    ``,
    `  Client:        ${i.clientName}`,
    `  DOB:           ${ukDate(i.clientDob)}`,
    `  Postcode:      ${i.postcode || "—"}`,
    `  Policy No:     ${i.policyNumber}`,
    `  Provider:      ${i.provider.toUpperCase()}`,
    `  Product:       ${i.policyType || "—"}`,
    `  Status:        ${reason}`,
    `  CB Date:       ${ukDate(i.clawbackDate)}`,
    `  EBAH report:   ${ukDate(i.ebahReportDate)}`,
    `  Sales agent:   ${i.ebahAgentName}`,
    ``,
    i.pozNote ? `Notes from Pauline:` : ``,
    i.pozNote ? `  ${i.pozNote}` : ``,
    i.pozNote ? `` : ``,
    `Please contact the client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.`,
    ``,
    `Open the case: ${clawbackCaseUrl(i.policyNumber)}`,
    ``,
    `— RECI portal`,
  ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
  const text = lines.join("\n");

  const caseUrl = clawbackCaseUrl(i.policyNumber);
  const html =
    `<p>${greeting}</p>` +
    `<p>A post-completion clawback case needs your attention.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.clientName) +
    row("DOB", ukDate(i.clientDob)) +
    row("Postcode", i.postcode || "—") +
    row("Policy No", i.policyNumber) +
    row("Provider", i.provider.toUpperCase()) +
    row("Product", i.policyType || "—") +
    row("Status", reason) +
    row("CB Date", ukDate(i.clawbackDate)) +
    row("EBAH report", ukDate(i.ebahReportDate)) +
    row("Sales agent", i.ebahAgentName) +
    `</table>` +
    (i.pozNote
      ? `<p style="margin-top:12px"><strong>Notes from Pauline:</strong><br>${escapeHtml(i.pozNote).replace(/\n/g, "<br>")}</p>`
      : "") +
    `<p>Please contact the client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.</p>` +
    `<p style="margin:18px 0"><a href="${caseUrl}" style="display:inline-block;background:#b45309;color:#fff;padding:8px 14px;text-decoration:none;border-radius:4px;font-weight:600">Open this case in the Clawback Dashboard</a></p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-notify",
    fromName: "RECI Clawback",
    to, cc: finalCc,
    subject, text, html,
  });
}

export interface ClawbackNotifyDigestCase {
  caseId: number;
  clientName: string;
  clientDob?: string | null;
  policyNumber: string;
  postcode: string | null;
  provider: string;
  policyType: string | null;
  ebahWarning: string | null;
  clawbackDate: string | null;
  source?: string | null;
}

export interface ClawbackNotifyDigestInput {
  /** Adviser routing identity. Same shape as ClawbackNotifyInput so the
   *  caller can reuse the CAM lookup it already had to do for the case. */
  adviserId: number | null;
  agentBucket: string;
  /** Cases for this recipient group. Any order is fine; the digest
   *  sorts internally by postcode then surname so duplicate-surname
   *  rows sit next to each other under the right postcode bucket. */
  cases: ClawbackNotifyDigestCase[];
  /** Date L&G generated the EBAH report (auto-Notify path) or null
   *  for backfill / manual bulk sends. */
  ebahReportDate?: string | null;
  /** Actor for the audit log entry, e.g. "ebah-upload" or session.username. */
  actor: string;
}

/**
 * Digest variant of the per-case Notify email. Sends ONE email to the
 * adviser/CAM (CC'd to management + Guy) containing every case in the
 * batch, grouped by postcode so duplicate surnames are obvious.
 *
 * Used by:
 *   - notify-unnotified backfill (admin button)
 *   - ingest auto-Notify (one digest per adviser per upload)
 *
 * Manual single-case Notify (Pauline opens a case + clicks the button)
 * still uses sendClawbackNotifyEmail.
 */
export async function sendClawbackNotifyDigestEmail(
  i: ClawbackNotifyDigestInput,
): Promise<{ sent: boolean; reason?: string }> {
  if (i.cases.length === 0) return { sent: false, reason: "no cases" };
  const cam = await resolveCamRecipients(i.adviserId, i.agentBucket);
  const cc = managementCc();
  // Guy asked (7 Jul 2026) to come off per-case notifications. He only
  // gets the daily stale-case summary now.

  let to: string[];
  if (cam.to.length > 0) {
    to = cam.to;
  } else {
    to = [...cc];
    if (to.length === 0) return { sent: false, reason: "no recipient" };
  }
  const finalCc = buildCc(cc, [], to);

  // Group by postcode (case-insensitive, trimmed, "—" for blank), then
  // within each postcode sort by surname to make dupes visible.
  const norm = (p: string | null) =>
    (p || "").trim().toUpperCase().replace(/\s+/g, " ") || "(no postcode)";
  const surname = (full: string) => {
    const parts = full.trim().split(/\s+/);
    return (parts[parts.length - 1] || full).toUpperCase();
  };
  const byPostcode = new Map<string, ClawbackNotifyDigestCase[]>();
  for (const c of i.cases) {
    const key = norm(c.postcode);
    const arr = byPostcode.get(key);
    if (arr) arr.push(c); else byPostcode.set(key, [c]);
  }
  const groups = Array.from(byPostcode.entries())
    .map(([postcode, cases]) => ({
      postcode,
      cases: cases.slice().sort((a, b) => surname(a.clientName).localeCompare(surname(b.clientName))),
    }))
    .sort((a, b) => a.postcode.localeCompare(b.postcode));

  const totalCases = i.cases.length;
  const totalPostcodes = groups.length;
  const newOwAny = i.cases.some((c) => c.source === "new_ow");
  const newOwPrefix = newOwAny ? "[NEW OW] " : "";
  const subject = `${newOwPrefix}[RECI Clawback] ${totalCases} case${totalCases === 1 ? "" : "s"} need attention (${totalPostcodes} postcode${totalPostcodes === 1 ? "" : "s"})`;

  const greeting = cam.to.length > 0
    ? `Hi ${escapeHtml(i.agentBucket === "xstaff" ? "Tan + Hayder" : cam.label)},`
    : `Hi team,`;

  // Plain-text body. Pauline's house style: no em dashes, basic language,
  // no commission figures.
  const textLines: string[] = [];
  textLines.push(cam.to.length > 0
    ? `Hi ${i.agentBucket === "xstaff" ? "Tan + Hayder" : cam.label},`
    : `Hi team,`);
  textLines.push("");
  textLines.push(`${totalCases} post-completion clawback case${totalCases === 1 ? "" : "s"} need${totalCases === 1 ? "s" : ""} your attention.`);
  if (i.ebahReportDate) {
    textLines.push(`Source: L&G EBAH report ${ukDate(i.ebahReportDate)}.`);
  }
  textLines.push("");
  for (const g of groups) {
    textLines.push(`Postcode ${g.postcode}:`);
    for (const c of g.cases) {
      textLines.push(`  - ${c.clientName} (DOB ${ukDate(c.clientDob)})`);
      textLines.push(`    Policy ${c.policyNumber} - ${c.provider.toUpperCase()} ${c.policyType || ""}`.trimEnd());
      textLines.push(`    Status: ${c.ebahWarning || "Clawback notification"}`);
      textLines.push(`    CB Date: ${ukDate(c.clawbackDate)}`);
      textLines.push(`    Open: ${clawbackCaseUrl(c.policyNumber)}`);
      textLines.push("");
    }
  }
  textLines.push("Please contact each client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.");
  textLines.push("");
  textLines.push("— RECI portal");
  const text = textLines.join("\n");

  // HTML body, same shape as the plain text. Each group renders as a
  // postcode header followed by a small table of cases with an Open link.
  let html = `<p>${greeting}</p>` +
    `<p>${totalCases} post-completion clawback case${totalCases === 1 ? "" : "s"} need${totalCases === 1 ? "s" : ""} your attention` +
    (i.ebahReportDate ? ` (L&amp;G EBAH report ${escapeHtml(ukDate(i.ebahReportDate))})` : "") + `.</p>`;
  for (const g of groups) {
    html += `<p style="margin:18px 0 4px 0"><strong>Postcode ${escapeHtml(g.postcode)}</strong> <span style="color:#888">(${g.cases.length} case${g.cases.length === 1 ? "" : "s"})</span></p>`;
    html += `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px;width:100%;margin-bottom:8px">`;
    for (const c of g.cases) {
      const newOwTag = c.source === "new_ow" ? ` <span style="background:#fee2e2;color:#991b1b;padding:1px 6px;border-radius:3px;font-size:11px;font-weight:600">NEW OW</span>` : "";
      html += `<tr style="border-top:1px solid #e5e7eb">` +
        `<td style="padding:6px 8px;vertical-align:top">` +
        `<div><strong>${escapeHtml(c.clientName)}</strong>${newOwTag} <span style="color:#666">(DOB ${escapeHtml(ukDate(c.clientDob))})</span></div>` +
        `<div style="color:#444;font-size:13px">Policy ${escapeHtml(c.policyNumber)} · ${escapeHtml(c.provider.toUpperCase())} ${escapeHtml(c.policyType || "")}</div>` +
        `<div style="color:#444;font-size:13px">${escapeHtml(c.ebahWarning || "Clawback notification")} · CB date ${escapeHtml(ukDate(c.clawbackDate))}</div>` +
        `</td>` +
        `<td style="padding:6px 8px;vertical-align:top;text-align:right;white-space:nowrap">` +
        `<a href="${clawbackCaseUrl(c.policyNumber)}" style="display:inline-block;background:#b45309;color:#fff;padding:6px 10px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:600">Open case</a>` +
        `</td>` +
        `</tr>`;
    }
    html += `</table>`;
  }
  html += `<p>Please contact each client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.</p>`;
  html += `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-notify-digest",
    fromName: "RECI Clawback",
    to, cc: finalCc,
    subject, text, html,
  });
}

export interface ClawbackResolvedInput {
  caseId: number;
  clientName: string;
  policyNumber: string;
  postcode: string | null;
  newStatus: string;
  oldStatus: string;
  note: string | null;
  actor: string;
  ebahAgentName: string;
  adviserId: number | null;
  agentBucket: string;
}

export async function sendClawbackResolvedEmail(i: ClawbackResolvedInput): Promise<{ sent: boolean; reason?: string }> {
  const cc = managementCc();
  // CAM hears about their own case being updated too.
  const cam = await resolveCamRecipients(i.adviserId, i.agentBucket);
  for (const e of cam.to) if (!cc.includes(e)) cc.push(e);
  // Guy came OFF per-case update emails on 7 Jul 2026 (too many). He
  // only gets the daily stale-case summary now. Management (Poz) is
  // the To line; the CAM stays in CC.
  const to = [...cc];
  if (to.length === 0) return { sent: false, reason: "no recipient" };
  const finalCc = buildCc(cc, [], to);

  const statusLabel = RESOLVED_STATUS_LABELS[i.newStatus] || i.newStatus;
  // Per Poz: use "updated" not "resolved" -- Lost cases aren't
  // resolved, they're just closed out.
  const subject = `[RECI Clawback] Updated (${statusLabel}): ${i.clientName} (${i.policyNumber})`;
  const greeting = `Hi team,`;

  const lines = [
    greeting,
    ``,
    `A clawback case has been updated on the dashboard.`,
    ``,
    `  Client:        ${i.clientName}`,
    `  Postcode:      ${i.postcode || "—"}`,
    `  Policy No:     ${i.policyNumber}`,
    `  Sales agent:   ${i.ebahAgentName}`,
    `  Status moved:  ${RESOLVED_STATUS_LABELS[i.oldStatus] || i.oldStatus} -> ${statusLabel}`,
    `  Updated by:    ${i.actor}`,
    ``,
    i.note ? `Notes:` : ``,
    i.note ? `  ${i.note}` : ``,
    i.note ? `` : ``,
    `Full detail is on the Clawback Dashboard.`,
    ``,
    `Open the case: ${clawbackCaseUrl(i.policyNumber)}`,
    ``,
    `— RECI portal`,
  ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
  const text = lines.join("\n");

  const caseUrl = clawbackCaseUrl(i.policyNumber);
  const html =
    `<p>${greeting}</p>` +
    `<p>A clawback case has been updated on the dashboard.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.clientName) +
    row("Postcode", i.postcode || "—") +
    row("Policy No", i.policyNumber) +
    row("Sales agent", i.ebahAgentName) +
    row("Status moved",
      `${RESOLVED_STATUS_LABELS[i.oldStatus] || i.oldStatus} → ${statusLabel}`) +
    row("Updated by", i.actor) +
    `</table>` +
    (i.note
      ? `<p style="margin-top:12px"><strong>Notes:</strong><br>${escapeHtml(i.note).replace(/\n/g, "<br>")}</p>`
      : "") +
    `<p>Full detail is on the Clawback Dashboard.</p>` +
    `<p style="margin:18px 0"><a href="${caseUrl}" style="display:inline-block;background:#0f172a;color:#fff;padding:8px 14px;text-decoration:none;border-radius:4px;font-weight:600">Open this case in the Clawback Dashboard</a></p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-updated",
    fromName: "RECI Clawback",
    to, cc: finalCc,
    subject, text, html,
  });
}

export interface StaleDigestCase {
  policyNumber: string;
  clientName: string;
  seller: string;
  clawback: number;
  daysIdle: number;
  trigger: string | null;
}

/**
 * Weekday digest to Guy + management (Poz) listing OPEN cases with no
 * human action inside the stale threshold. Fired from the cron at the
 * 10:00 UTC run, London weekdays only. One email, grouped by seller,
 * biggest CB first.
 */
export async function sendStaleCaseDigest(
  cases: StaleDigestCase[],
  staleDays: number,
): Promise<{ sent: boolean; reason?: string }> {
  if (cases.length === 0) return { sent: false, reason: "no stale cases" };
  const guy = guyEmail();
  const cc = managementCc();
  const to: string[] = [];
  if (guy) to.push(guy);
  if (to.length === 0) {
    to.push(...cc);
    if (to.length === 0) return { sent: false, reason: "no recipient" };
  }
  const finalCc = buildCc(cc, [], to);

  const totalCb = cases.reduce((n, c) => n + c.clawback, 0);
  // Vocabulary per Poz 14 Jul: "not worked" is reserved for cases
  // nobody has ever touched; this digest covers open cases that have
  // gone quiet, so it says "no activity".
  const subject = `[RECI Clawback] ${cases.length} open case${cases.length === 1 ? "" : "s"} with no activity for ${staleDays}+ days (${totalCb.toLocaleString("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 })} exposure)`;

  // Group by seller for both bodies.
  const bySeller = new Map<string, StaleDigestCase[]>();
  for (const c of cases) {
    const arr = bySeller.get(c.seller);
    if (arr) arr.push(c); else bySeller.set(c.seller, [c]);
  }
  const groups = Array.from(bySeller.entries())
    .map(([seller, rows]) => ({
      seller,
      rows: rows.slice().sort((a, b) => b.clawback - a.clawback),
    }))
    .sort((a, b) => a.seller.localeCompare(b.seller));

  const gbpFmt = (n: number) => n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });

  const textLines: string[] = [
    `Hi ${guy ? "Guy" : "team"},`,
    ``,
    `These open clawback cases have had no action logged for ${staleDays} days or more.`,
    ``,
  ];
  for (const g of groups) {
    textLines.push(`${g.seller}:`);
    for (const c of g.rows) {
      textLines.push(`  - ${c.clientName} · ${c.policyNumber} · ${gbpFmt(c.clawback)} · idle ${c.daysIdle}d${c.trigger ? ` · ${c.trigger}` : ""}`);
      textLines.push(`    Open: ${clawbackCaseUrl(c.policyNumber)}`);
    }
    textLines.push(``);
  }
  textLines.push(`Total exposure sitting untouched: ${gbpFmt(totalCb)}.`);
  textLines.push(``);
  textLines.push(`— RECI portal`);
  const text = textLines.join("\n");

  let html = `<p>Hi ${guy ? "Guy" : "team"},</p>` +
    `<p>These open clawback cases have had no action logged for <strong>${staleDays} days or more</strong>.</p>`;
  for (const g of groups) {
    html += `<p style="margin:14px 0 4px 0"><strong>${escapeHtml(g.seller)}</strong> <span style="color:#888">(${g.rows.length})</span></p>`;
    html += `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:13px;width:100%">`;
    for (const c of g.rows) {
      html += `<tr style="border-top:1px solid #e5e7eb">` +
        `<td style="padding:5px 8px"><strong>${escapeHtml(c.clientName)}</strong><br>` +
        `<span style="color:#666;font-size:12px">${escapeHtml(c.policyNumber)}${c.trigger ? ` · ${escapeHtml(c.trigger)}` : ""}</span></td>` +
        `<td style="padding:5px 8px;text-align:right;white-space:nowrap">${gbpFmt(c.clawback)}<br>` +
        `<span style="color:#b91c1c;font-size:12px;font-weight:600">idle ${c.daysIdle}d</span></td>` +
        `<td style="padding:5px 8px;text-align:right;white-space:nowrap">` +
        `<a href="${clawbackCaseUrl(c.policyNumber)}" style="display:inline-block;background:#b45309;color:#fff;padding:5px 9px;text-decoration:none;border-radius:4px;font-size:12px;font-weight:600">Open</a></td>` +
        `</tr>`;
    }
    html += `</table>`;
  }
  html += `<p style="margin-top:12px">Total exposure sitting untouched: <strong>${gbpFmt(totalCb)}</strong>.</p>`;
  html += `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-stale-digest",
    fromName: "RECI Clawback",
    to, cc: finalCc,
    subject, text, html,
  });
}

/**
 * POST IT workbook email, relayed from the post-it-automation GitHub
 * Action (15 Jul 2026). The Action generates the xlsx and hands it to
 * the portal via /api/post-it-email; the portal sends it through the
 * same Purelymail transport as every other email, so all outbound
 * mail lives in one place with one set of credentials.
 */
export async function sendPostItWorkbookEmail(i: {
  recipients: string[];
  subject: string;
  body: string;
  filename: string;
  xlsxBase64: string;
}): Promise<{ sent: boolean; reason?: string }> {
  const content = Buffer.from(i.xlsxBase64, "base64");
  return dispatchMail({
    label: "post-it-workbook",
    fromName: "Top Quote POST IT",
    to: i.recipients,
    cc: [],
    subject: i.subject,
    text: i.body,
    html: `<pre style="font-family:inherit;white-space:pre-wrap">${escapeHtml(i.body)}</pre>`,
    attachments: [{ filename: i.filename, content }],
  });
}

/**
 * Nurture journey email to a CLIENT (16 Jul 2026, Guy's journey doc).
 * The only email in the system sent to policyholders rather than staff,
 * so the From name is forced to the client-facing brand ("TopQuote")
 * rather than SMTP_FROM_NAME, and there is no CC. Body is the plain
 * text from the journey template; the HTML variant just preserves the
 * line breaks. Never include commission figures in journey copy.
 */
export async function sendJourneyClientEmail(i: {
  to: string;
  subject: string;
  body: string;
  label: string; // e.g. "journey-a1_email"
}): Promise<{ sent: boolean; reason?: string }> {
  const transporter = getTransporter();
  if (!transporter) {
    console.error(`[reci-email:${i.label}] no SMTP creds; aborting`);
    return { sent: false, reason: "no SMTP credentials" };
  }
  const addr = process.env.SMTP_USER || process.env.GMAIL_USER || "";
  const envelope = {
    label: i.label,
    from: `"TopQuote" <${addr}>`,
    to: i.to,
    subject: i.subject,
  };
  console.error(`[reci-email:${i.label}] sending`, envelope);
  try {
    const info = await transporter.sendMail({
      from: envelope.from,
      to: i.to,
      subject: i.subject,
      text: i.body,
      html: `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.5;white-space:pre-wrap">${escapeHtml(i.body)}</div>`,
    });
    console.error(`[reci-email:${i.label}] sent`, {
      messageId: info.messageId,
      response: info.response,
      accepted: info.accepted,
      rejected: info.rejected,
    });
    return { sent: true };
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error(`[reci-email:${i.label}] FAILED`, { reason, envelope });
    return { sent: false, reason };
  }
}
