/**
 * Cancellation email — sent when a deal is moved into the Cancelled column.
 * Uses the same Gmail App Password the automation uses (GMAIL_USER / GMAIL_APP_PASSWORD).
 *
 * Env:
 *   GMAIL_USER              = automation@... or jamesacton007@gmail.com
 *   GMAIL_APP_PASSWORD      = 16-char Gmail app password (no spaces)
 *   RECI_CANCELLATION_CC    = comma-separated list (e.g. "pauline@apexiavip.co.uk,jimmy@apexiavip.co.uk")
 */
import nodemailer from "nodemailer";
import { sql } from "@vercel/postgres";
import {
  CANCELLATION_REASON_LABELS,
  type CancellationReason,
  type Deal,
  type Adviser,
} from "./schema";

const HOST = "smtp.gmail.com";
const PORT = 465;

let _transporter: nodemailer.Transporter | null = null;

function getTransporter(): nodemailer.Transporter | null {
  if (_transporter) return _transporter;
  const user = process.env.GMAIL_USER;
  const pass = process.env.GMAIL_APP_PASSWORD;
  if (!user || !pass) return null;
  _transporter = nodemailer.createTransport({
    host: HOST,
    port: PORT,
    secure: true,
    auth: { user, pass },
  });
  return _transporter;
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
  const transporter = getTransporter();
  if (!transporter) {
    return { sent: false, reason: "no SMTP credentials" };
  }

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

  try {
    await transporter.sendMail({
      from: `"RECI" <${process.env.GMAIL_USER}>`,
      to: to.join(","),
      cc: ccArr.length > 0 ? ccArr.join(",") : undefined,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
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
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "no SMTP credentials" };

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

  try {
    await transporter.sendMail({
      from: `"RECI" <${process.env.GMAIL_USER}>`,
      to: to.join(","),
      cc: ccArr.length > 0 ? ccArr.join(",") : undefined,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
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
  const transporter = getTransporter();
  if (!transporter) return { sent: false, reason: "no SMTP credentials" };

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

  try {
    await transporter.sendMail({
      from: `"RECI" <${process.env.GMAIL_USER}>`,
      to: to.join(","),
      cc: ccArr.length > 0 ? ccArr.join(",") : undefined,
      subject,
      text,
      html,
    });
    return { sent: true };
  } catch (e) {
    return { sent: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
