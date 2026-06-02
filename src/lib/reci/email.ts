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

export interface CancellationEmailInput {
  deal: Deal;
  adviser: Adviser;
  reason: CancellationReason;
  notes: string | null;
  changedBy: string;
}

function gbp(n: number) {
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
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

  const reasonLabel = CANCELLATION_REASON_LABELS[i.reason];
  const subject = `[RECI] Cancelled: ${i.deal.client} — ${reasonLabel}`;

  const lines = [
    `Hi ${i.adviser.name},`,
    ``,
    `One of your deals has been moved to Cancelled in the RECI portal.`,
    ``,
    `  Client:        ${i.deal.client}`,
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
      cc: cc.length > 0 ? cc.join(",") : undefined,
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

function escapeHtml(s: string) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
