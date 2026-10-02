/**
 * Welcome / thank-you email for a deal (Poz, 28 Sep 2026).
 *
 * GET  -> the deal, the client's other On Risk NYP policies that haven't
 *         had a welcome email (so one email can cover them all), and
 *         whether sending is live or test.
 * POST { action: "preview" | "send", dealIds: number[], resend?: boolean }
 *
 * Only On Risk NYP deals can be welcomed. Until WELCOME_EMAIL_LIVE=true,
 * "send" goes to management (Poz + Jimmy) with the intended recipient in
 * the subject, and nothing is stamped, so Poz can sign off the wording
 * on real deals first.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isDashboardUser } from "@/lib/auth";
import type { Deal } from "@/lib/reci/schema";
import { EMAIL_RE } from "@/lib/reci/welcome-fields";
import { providerDisplayName, renderWelcomeEmail } from "@/lib/reci/welcome-email";
import { sendWelcomeEmail, welcomeTestRecipients } from "@/lib/reci/email";

export const dynamic = "force-dynamic";

const isLive = () => (process.env.WELCOME_EMAIL_LIVE || "").trim().toLowerCase() === "true";

type DealRow = Deal & { adviser_name: string };

async function loadDeal(id: number): Promise<DealRow | null> {
  const r = await sql.query<DealRow>(
    `SELECT d.*, d.policy_start_date::text AS policy_start_date,
            d.first_dd_date::text AS first_dd_date, COALESCE(NULLIF(a.full_name, ''), a.name) AS adviser_name
       FROM deals d JOIN advisers a ON a.id = d.adviser_id
      WHERE d.id = $1`,
    [id],
  );
  return r.rows[0] ?? null;
}

/** Other On Risk NYP policies for the same client + adviser, not yet welcomed. */
async function loadSiblings(d: DealRow): Promise<DealRow[]> {
  const r = await sql.query<DealRow>(
    `SELECT d.*, d.policy_start_date::text AS policy_start_date,
            d.first_dd_date::text AS first_dd_date, COALESCE(NULLIF(a.full_name, ''), a.name) AS adviser_name
       FROM deals d JOIN advisers a ON a.id = d.adviser_id
      WHERE d.id <> $1
        AND d.adviser_id = $2
        AND lower(trim(d.client)) = lower(trim($3))
        AND d.status = 'on_risk_nyp'
        AND d.welcome_sent_at IS NULL
      ORDER BY d.id`,
    [d.id, d.adviser_id, d.client],
  );
  return r.rows;
}

/** Fields still needed before this deal can go in a welcome email. */
function missingFor(d: DealRow): string[] {
  const m: string[] = [];
  if (!d.client_email || !EMAIL_RE.test(d.client_email)) m.push("client email");
  if (d.client_email_2 && !EMAIL_RE.test(d.client_email_2)) m.push("second email (not valid)");
  if (!(d.provider ?? "").trim()) m.push("provider");
  if (!(d.policy_number ?? "").trim()) m.push("policy number");
  if (!d.policy_start_date) m.push("policy start date");
  if (!(Number(d.premium) > 0)) m.push("premium");
  if (!d.first_dd_date) m.push("first DD date");
  return m;
}

function summary(d: DealRow) {
  const p = providerDisplayName(d.provider);
  return {
    id: d.id,
    client: d.client,
    status: d.status,
    provider: d.provider,
    providerDisplay: p.name,
    providerRecognised: p.recognised,
    policy_number: d.policy_number,
    policy_start_date: d.policy_start_date ? String(d.policy_start_date).slice(0, 10) : null,
    first_dd_date: d.first_dd_date ? String(d.first_dd_date).slice(0, 10) : null,
    premium: d.premium != null ? Number(d.premium) : null,
    client_email: d.client_email,
    client_email_2: d.client_email_2,
    welcome_sent_at: d.welcome_sent_at,
    welcome_sent_to: d.welcome_sent_to,
    welcome_sent_by: d.welcome_sent_by,
    missing: missingFor(d),
  };
}

export async function GET(_req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const deal = await loadDeal(Number(params.id));
  if (!deal) return NextResponse.json({ error: "not found" }, { status: 404 });
  const siblings = deal.status === "on_risk_nyp" ? await loadSiblings(deal) : [];
  return NextResponse.json({
    live: isLive(),
    testRecipients: isLive() ? [] : welcomeTestRecipients(),
    adviserName: deal.adviser_name,
    deal: summary(deal),
    siblings: siblings.map(summary),
  });
}

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const session = await getSession();
  if (!isDashboardUser(session.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const body = (await req.json().catch(() => null)) as {
    action?: string; dealIds?: unknown; resend?: boolean;
  } | null;
  const action = body?.action === "send" ? "send" : "preview";

  const primary = await loadDeal(Number(params.id));
  if (!primary) return NextResponse.json({ error: "not found" }, { status: 404 });

  // The primary deal always leads; any extras must be this client's
  // On Risk NYP siblings (re-checked here, never trusted from the client).
  const requested = Array.isArray(body?.dealIds) ? body!.dealIds.map(Number).filter(Number.isFinite) : [];
  const siblings = await loadSiblings(primary);
  const extras = siblings.filter((s) => requested.includes(s.id));
  const deals = [primary, ...extras];

  if (primary.status !== "on_risk_nyp") {
    return NextResponse.json({ error: "Welcome emails can only be sent for On Risk NYP deals." }, { status: 400 });
  }
  const missing = Object.fromEntries(deals.map((d) => [d.id, missingFor(d)]));
  const incomplete = deals.filter((d) => missingFor(d).length > 0);
  // Joint policies can carry a second email (Poz 2 Oct 2026); both get
  // the email. Every policy folded in must share the same address(es),
  // so nobody is sent details of policies that aren't theirs.
  const recipientsFor = (d: DealRow) => Array.from(new Set(
    [d.client_email, d.client_email_2].map((e) => (e ?? "").trim().toLowerCase()).filter(Boolean),
  )).sort();
  const emailSets = Array.from(new Set(deals.map((d) => recipientsFor(d).join(", ")).filter(Boolean)));
  const emailConflict = emailSets.length > 1;
  const clientEmails = emailConflict ? [] : recipientsFor(primary);

  const rendered = incomplete.length === 0 && !emailConflict && clientEmails.length > 0
    ? renderWelcomeEmail({
        clientName: primary.client.trim(),
        adviserName: primary.adviser_name,
        policies: deals.map((d) => ({
          provider: providerDisplayName(d.provider).name,
          policyNumber: String(d.policy_number).trim(),
          startDate: String(d.policy_start_date).slice(0, 10),
          premium: Number(d.premium),
          firstDdDate: String(d.first_dd_date).slice(0, 10),
        })),
      })
    : null;

  if (action === "preview") {
    return NextResponse.json({
      ok: true,
      missing,
      emailConflict: emailConflict ? emailSets : null,
      subject: rendered?.subject ?? null,
      html: rendered?.html ?? null,
    });
  }

  // ---- send ----
  if (!rendered) {
    return NextResponse.json({
      error: emailConflict
        ? "These policies have different client email addresses. Make them match first."
        : "Some details are still missing.",
      missing,
    }, { status: 400 });
  }
  const live = isLive();
  if (live && !body?.resend && deals.some((d) => d.welcome_sent_at)) {
    return NextResponse.json({ error: "A welcome email has already been sent for this deal." }, { status: 409 });
  }
  const clientEmail = clientEmails.join(", ");
  const to = live ? clientEmails : welcomeTestRecipients();
  if (to.length === 0) return NextResponse.json({ error: "No test recipients configured." }, { status: 500 });
  const subject = live ? rendered.subject : `[TEST, would go to ${clientEmail}] ${rendered.subject}`;

  const result = await sendWelcomeEmail({
    to, subject, html: rendered.html, text: rendered.text,
    label: `welcome-${live ? "live" : "test"}-${deals.map((d) => d.id).join("+")}`,
  });
  if (!result.sent) {
    return NextResponse.json({ error: `Email failed: ${result.reason}` }, { status: 502 });
  }
  if (live) {
    await sql.query(
      `UPDATE deals SET welcome_sent_at = now(), welcome_sent_to = $1, welcome_sent_by = $2
        WHERE id = ANY($3::int[])`,
      [clientEmail, session.username, deals.map((d) => d.id)],
    );
  }
  return NextResponse.json({ ok: true, live, sentTo: to, dealIds: deals.map((d) => d.id) });
}
