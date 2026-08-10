/**
 * PATCH /api/reci/cases/[id] — adviser workspace edits (Poz, 6 Aug 2026).
 *
 * Body (all optional, at least one required):
 *   resold_outcome:        "resold" | "pm" | null   (cancelled deals only)
 *   resold_details:        string                   replacement / policy details
 *   resold_new_commission: number
 *   resold_notes:          string
 *   clawback_saved:        number | null            SENIOR ADMIN ONLY (manual figure)
 *   status:                DealStatus               (in-processing deals only; cannot
 *                                                    set cancelled/clawback here — that
 *                                                    flow, with reasons + emails, stays
 *                                                    on the admin boards)
 *   note:                  string                   appended to the deal's notes with
 *                                                    a date + user stamp
 *
 * Junior sellers only touch their own deals; senior sellers + admins any;
 * Guy (viewer) nothing.
 */
import { NextResponse } from "next/server";
import { db } from "@vercel/postgres";
import {
  getSession, isClawbackUser, isDashboardUser, getEditableAdviserId,
} from "@/lib/auth";
import { DEAL_STATUSES, RESOLD_OUTCOMES, type DealStatus } from "@/lib/reci/schema";

export const dynamic = "force-dynamic";

export async function PATCH(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const editable = await getEditableAdviserId(session.username);
  if (editable === undefined) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({})) as {
    resold_outcome?: unknown; resold_details?: unknown;
    resold_new_commission?: unknown; resold_notes?: unknown;
    clawback_saved?: unknown; status?: unknown; note?: unknown;
  };

  const has = (k: keyof typeof body) => body[k] !== undefined;
  if (!has("resold_outcome") && !has("resold_details") && !has("resold_new_commission")
      && !has("resold_notes") && !has("clawback_saved") && !has("status") && !has("note")) {
    return NextResponse.json({ error: "nothing to update" }, { status: 400 });
  }

  if (has("clawback_saved") && !isDashboardUser(session.username)) {
    return NextResponse.json({ error: "clawback saved is entered by a senior administrator" }, { status: 403 });
  }
  const outcome = body.resold_outcome;
  if (has("resold_outcome") && outcome !== null && !(RESOLD_OUTCOMES as readonly string[]).includes(String(outcome))) {
    return NextResponse.json({ error: "resold_outcome must be resold, pm or null" }, { status: 400 });
  }
  const newStatus = body.status;
  if (has("status")) {
    if (!(DEAL_STATUSES as readonly string[]).includes(String(newStatus))) {
      return NextResponse.json({ error: "bad status" }, { status: 400 });
    }
    if (newStatus === "cancelled" || newStatus === "clawback") {
      return NextResponse.json({ error: "cancelling stays with the admin boards (needs a reason + notifications)" }, { status: 400 });
    }
  }
  const toAmount = (v: unknown): number | null => {
    if (v === null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= 0 ? n : null;
  };

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      id: number; adviser_id: number; status: string; notes: string | null;
      commission: string; client: string;
    }>(
      `SELECT id, adviser_id, status, notes, commission, client FROM deals WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "deal not found" }, { status: 404 });
    }
    const deal = cur.rows[0];
    if (typeof editable === "number" && deal.adviser_id !== editable) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "not your case" }, { status: 403 });
    }

    // Field-group guards: resold fields only make sense on cancelled
    // deals; status moves only from in_processing (this workspace's two
    // tabs). Keeps this endpoint from becoming a general deal editor.
    const touchingResold = has("resold_outcome") || has("resold_details")
      || has("resold_new_commission") || has("resold_notes") || has("clawback_saved");
    if (touchingResold && deal.status !== "cancelled") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "resold fields apply to cancelled deals only" }, { status: 400 });
    }
    if (has("status") && deal.status !== "in_processing") {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "status changes here apply to in-processing deals only" }, { status: 400 });
    }

    const sets: string[] = [];
    const vals: unknown[] = [];
    const push = (fragment: string, v: unknown) => { vals.push(v); sets.push(`${fragment}$${vals.length}`); };

    if (has("resold_outcome")) {
      push("resold_outcome = ", outcome === null ? null : String(outcome));
      // Stamp who recorded the outcome (drives the green resolved row).
      push("resold_recorded_by = ", outcome === null ? null : session.username);
      sets.push(outcome === null ? "resold_recorded_at = NULL" : "resold_recorded_at = now()");
    }
    if (has("resold_details"))        push("resold_details = ", String(body.resold_details ?? "").slice(0, 2000) || null);
    if (has("resold_new_commission")) push("resold_new_commission = ", toAmount(body.resold_new_commission));
    if (has("resold_notes"))          push("resold_notes = ", String(body.resold_notes ?? "").slice(0, 2000) || null);
    if (has("clawback_saved"))        push("clawback_saved = ", toAmount(body.clawback_saved));
    if (has("status"))                push("status = ", String(newStatus));

    const noteRaw = has("note") ? String(body.note ?? "").trim() : "";
    if (noteRaw) {
      const stamp = new Date().toLocaleDateString("en-GB", { day: "2-digit", month: "short", timeZone: "Europe/London" });
      const line = `[${stamp} ${session.username}] ${noteRaw.slice(0, 1000)}`;
      push("notes = ", deal.notes ? `${deal.notes}\n${line}` : line);
    }

    if (sets.length > 0) {
      vals.push(id);
      await client.query(
        `UPDATE deals SET ${sets.join(", ")}, updated_at = now() WHERE id = $${vals.length}`,
        vals,
      );
    }

    // Audit trail into deal_history (status moves carry old/new; other
    // edits land as a note row).
    const summary: string[] = [];
    if (has("resold_outcome")) summary.push(`outcome=${outcome === null ? "cleared" : String(outcome)}`);
    if (has("resold_new_commission")) summary.push("new commission set");
    if (has("clawback_saved")) summary.push("clawback saved set");
    if (has("status")) summary.push(`status ${deal.status} -> ${String(newStatus)}`);
    if (noteRaw) summary.push("note added");
    await client.query(
      `INSERT INTO deal_history (deal_id, changed_by, old_status, new_status, note)
       VALUES ($1, $2, $3, $4, $5)`,
      [
        id, session.username,
        has("status") ? deal.status : null,
        has("status") ? String(newStatus) : null,
        `Adviser workspace: ${summary.join(", ")}`,
      ],
    );

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
