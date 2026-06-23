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

const RESOLVED_STATUS_LABELS: Record<string, string> = {
  saved:      "Saved",
  resold:     "Resold",
  dead:       "Dead in water",
  reinstated: "Reinstated",
  closed:     "Closed",
  open:       "Open",
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
  policyNumber: string;
  postcode: string | null;
  provider: string;
  policyType: string | null;
  ebahWarning: string | null;
  clawbackDate: string | null;
  ebahAgentName: string;
  adviserId: number | null;
  agentBucket: string;
  pozNote: string | null;
  actor: string;
}

export async function sendClawbackNotifyEmail(i: ClawbackNotifyInput): Promise<{ sent: boolean; reason?: string }> {
  const cam = await resolveCamRecipients(i.adviserId, i.agentBucket);
  const cc = managementCc();
  const guy = guyEmail();
  if (guy) cc.push(guy);

  // If the bucket has no CAM (legacy / needs_review) fall back to sending
  // straight to Guy + management so the case isn't silently lost.
  let to: string[];
  if (cam.to.length > 0) {
    to = cam.to;
  } else {
    to = [...cc];
    if (to.length === 0) return { sent: false, reason: "no recipient" };
  }
  const finalCc = buildCc(cc, [], to);

  const subject = `[RECI Clawback] New notification: ${i.clientName} (${i.policyNumber})`;

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
    `  Postcode:      ${i.postcode || "—"}`,
    `  Policy No:     ${i.policyNumber}`,
    `  Provider:      ${i.provider.toUpperCase()}`,
    `  Product:       ${i.policyType || "—"}`,
    `  Status:        ${reason}`,
    `  CB Date:       ${i.clawbackDate || "—"}`,
    `  Sales agent:   ${i.ebahAgentName}`,
    ``,
    i.pozNote ? `Notes from Pauline:` : ``,
    i.pozNote ? `  ${i.pozNote}` : ``,
    i.pozNote ? `` : ``,
    `Please contact the client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.`,
    ``,
    `— RECI portal`,
  ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
  const text = lines.join("\n");

  const html =
    `<p>${greeting}</p>` +
    `<p>A post-completion clawback case needs your attention.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.clientName) +
    row("Postcode", i.postcode || "—") +
    row("Policy No", i.policyNumber) +
    row("Provider", i.provider.toUpperCase()) +
    row("Product", i.policyType || "—") +
    row("Status", reason) +
    row("CB Date", i.clawbackDate || "—") +
    row("Sales agent", i.ebahAgentName) +
    `</table>` +
    (i.pozNote
      ? `<p style="margin-top:12px"><strong>Notes from Pauline:</strong><br>${escapeHtml(i.pozNote).replace(/\n/g, "<br>")}</p>`
      : "") +
    `<p>Please contact the client to attempt to save / reinstate the policy and update the Clawback Dashboard with what was done.</p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-notify",
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
  const guy = guyEmail();
  const cc = managementCc();
  // CAM hears about their own case being resolved too.
  const cam = await resolveCamRecipients(i.adviserId, i.agentBucket);
  for (const e of cam.to) if (!cc.includes(e)) cc.push(e);

  const to: string[] = [];
  if (guy) to.push(guy);
  if (to.length === 0) {
    // Fall back to management list when Guy isn't configured -- still gets
    // the resolution recorded somewhere.
    to.push(...cc);
    if (to.length === 0) return { sent: false, reason: "no recipient" };
  }
  const finalCc = buildCc(cc, [], to);

  const statusLabel = RESOLVED_STATUS_LABELS[i.newStatus] || i.newStatus;
  const subject = `[RECI Clawback] ${statusLabel}: ${i.clientName} (${i.policyNumber})`;

  const lines = [
    `Hi Guy,`,
    ``,
    `A clawback case has been resolved on the dashboard.`,
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
    `— RECI portal`,
  ].filter((line, idx, arr) => !(line === "" && arr[idx - 1] === ""));
  const text = lines.join("\n");

  const html =
    `<p>Hi Guy,</p>` +
    `<p>A clawback case has been resolved on the dashboard.</p>` +
    `<table style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">` +
    row("Client", i.clientName) +
    row("Postcode", i.postcode || "—") +
    row("Policy No", i.policyNumber) +
    row("Sales agent", i.ebahAgentName) +
    row("Status moved",
      `${RESOLVED_STATUS_LABELS[i.oldStatus] || i.oldStatus} &rarr; ${statusLabel}`) +
    row("Updated by", i.actor) +
    `</table>` +
    (i.note
      ? `<p style="margin-top:12px"><strong>Notes:</strong><br>${escapeHtml(i.note).replace(/\n/g, "<br>")}</p>`
      : "") +
    `<p>Full detail is on the Clawback Dashboard.</p>` +
    `<p style="color:#888;font-size:12px">— RECI portal</p>`;

  return dispatchMail({
    label: "clawback-resolved",
    fromName: "RECI Clawback",
    to, cc: finalCc,
    subject, text, html,
  });
}
