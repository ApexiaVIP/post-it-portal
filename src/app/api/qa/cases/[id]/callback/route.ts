/**
 * POST /api/qa/cases/[id]/callback
 *
 * Sends the seller what came out of the case summary (Poz and Guy, 19 and 20
 * Nov 2026): the points to put right with the client, the learning points
 * for next time, and the draft suitability report written from the call. It
 * goes to the seller with Pauline copied, no one else. While there are
 * points to put right and the sale is Not Yet Submitted, the sale is also
 * marked Checked on the RECI so it isn't submitted until Pauline is happy.
 * That is set directly rather than through updateDeal, so the seller gets
 * this email instead of a second, shorter "Checked" one.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { requireCallQA, getCase } from "@/lib/qa/db";
import { isDashboardUser } from "@/lib/auth";
import { triage, callbackListText } from "@/lib/qa/triage";
import { currentLetter, withLetterGaps, letterText } from "@/lib/qa/letter";
import { currentStatements, withStatementGaps } from "@/lib/qa/notes-check";
import { linkedCheck } from "@/lib/qa/notes-run";
import { sendQaCallbackEmail } from "@/lib/reci/email";
import type { Gate1Result, Gate2Result, LetterResult } from "@/lib/qa/schemas";

export const dynamic = "force-dynamic";
export const preferredRegion = "lhr1";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  const auth = await requireCallQA();
  if (auth instanceof NextResponse) return auth;
  // Emails a seller and holds a sale: Pauline, Poz and Jimmy only.
  if (!isDashboardUser(auth.username)) return NextResponse.json({ error: "forbidden" }, { status: 403 });

  const caseId = Number(params.id);
  const c = await getCase(caseId);
  if (!c) return NextResponse.json({ error: "case not found" }, { status: 404 });

  const runs = await sql<{ id: number; gate: number; status: string; result: unknown }>`
    SELECT DISTINCT ON (gate) id, gate, status, result FROM qa_runs
     WHERE case_id = ${caseId} ORDER BY gate, started_at DESC`;
  const run1 = runs.rows.find((r) => r.gate === 1 && r.status === "done");
  const g1 = run1?.result as Partial<Gate1Result> | undefined;
  const g2 = runs.rows.find((r) => r.gate === 2 && r.status === "done")?.result as Partial<Gate2Result> | undefined;
  const g3 = runs.rows.find((r) => r.gate === 3 && r.status === "done")?.result as LetterResult | undefined;
  if (!g1) return NextResponse.json({ error: "Run the check first." }, { status: 400 });
  // The draft only goes with the call check it was written alongside.
  const letter = currentLetter(g3, run1?.id);
  // The seller's advice check statements the calls don't back up (23 Nov 2026).
  const k = await linkedCheck(caseId);
  const notes = currentStatements(runs.rows.find((r) => r.gate === 4), k?.id);
  const t = withLetterGaps(withStatementGaps(triage(g1, g2 ?? null), notes, k?.result.statements ?? []), letter);
  const hasList = t.callback.length > 0;
  if (!hasList && !letter) return NextResponse.json({ error: "Nothing to send yet." }, { status: 400 });

  const deal = c.deal_id
    ? (await sql<{ id: number; status: string; adviser_id: number }>`
        SELECT id, status, adviser_id FROM deals WHERE id = ${c.deal_id}`).rows[0] ?? null
    : null;
  const adviserId = c.adviser_id ?? deal?.adviser_id ?? null;
  const adviser = adviserId
    ? (await sql<{ name: string; email: string | null }>`SELECT name, email FROM advisers WHERE id = ${adviserId}`).rows[0] ?? null
    : null;
  if (!adviser) return NextResponse.json({ error: "Set the adviser on the case first." }, { status: 400 });

  const submitted = !!deal && deal.status !== "not_yet_submitted";
  const mail = await sendQaCallbackEmail({
    adviser, client: c.client_name, sentBy: auth.username,
    list: callbackListText(t) || null, callback: hasList,
    letter: letter ? letterText(letter) : null,
    adviceCheck: t.callback.some((g) => g.items.some((i) => i.adviceCheck)), submitted,
  });
  if (!mail.sent) return NextResponse.json({ error: `Email not sent: ${mail.reason ?? "unknown"}` }, { status: 502 });

  let held = false;
  if (deal && !submitted && hasList) {
    const day = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
    await sql`
      UPDATE deals SET nys_check_status = 'checked',
             nys_check_notes = ${`Call QA: callback list sent to ${adviser.name} on ${day}. Submit once Pauline is happy.`},
             nys_checked_at = now(), nys_checked_by = ${auth.username}, updated_at = now()
       WHERE id = ${deal.id} AND status = 'not_yet_submitted'`;
    held = true;
  }
  await sql`UPDATE qa_cases SET callback_sent_at = now(), callback_sent_by = ${auth.username}, updated_at = now() WHERE id = ${caseId}`;
  return NextResponse.json({ ok: true, held });
}
