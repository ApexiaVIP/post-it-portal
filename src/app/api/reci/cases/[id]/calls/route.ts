/**
 * POST /api/reci/cases/[id]/calls — log a call against a case (Poz, 6 Aug
 * 2026). Body: { called_on?: "YYYY-MM-DD" (default today, London),
 * outcome: string, note?: string }.
 *
 * GET returns the full log for the case (the list feed only carries the
 * aggregate counts/dates).
 *
 * Outcomes come from the CALL_OUTCOMES dropdown in the UI but the API
 * accepts any short string, so extending the list is a code-constant
 * change with no data migration.
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackViewer, getEditableAdviserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function scopeCheck(idRaw: string, forWrite: boolean) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) return { error: "forbidden", status: 403 as const };
  const editable = await getEditableAdviserId(session.username);
  const viewer = isClawbackViewer(session.username);
  if (editable === undefined && !(viewer && !forWrite)) {
    return { error: "forbidden", status: 403 as const };
  }
  const id = Number(idRaw);
  if (!Number.isFinite(id) || id <= 0) return { error: "bad id", status: 400 as const };

  const r = await sql.query<{ adviser_id: number }>(
    `SELECT adviser_id FROM deals WHERE id = $1`, [id],
  );
  if (r.rowCount === 0) return { error: "deal not found", status: 404 as const };
  if (typeof editable === "number" && r.rows[0].adviser_id !== editable) {
    return { error: "not your case", status: 403 as const };
  }
  return { session, id };
}

export async function GET(
  req: Request,
  { params }: { params: { id: string } },
) {
  const s = await scopeCheck(params.id, false);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: s.status });
  const r = await sql.query(
    `SELECT id, called_on::text, outcome, note, actor, created_at::text
       FROM deal_calls WHERE deal_id = $1 ORDER BY called_on DESC, id DESC`,
    [s.id],
  );
  return NextResponse.json({ calls: r.rows });
}

export async function POST(
  req: Request,
  { params }: { params: { id: string } },
) {
  const s = await scopeCheck(params.id, true);
  if ("error" in s) return NextResponse.json({ error: s.error }, { status: s.status });

  const body = await req.json().catch(() => ({})) as {
    called_on?: unknown; outcome?: unknown; note?: unknown;
  };
  const outcome = typeof body.outcome === "string" ? body.outcome.trim().slice(0, 80) : "";
  if (!outcome) {
    return NextResponse.json({ error: "outcome required" }, { status: 400 });
  }
  const todayLondon = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
  const calledOn = typeof body.called_on === "string" && DATE_RE.test(body.called_on)
    ? body.called_on
    : todayLondon;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 1000) || null : null;

  const r = await sql.query<{ id: number }>(
    `INSERT INTO deal_calls (deal_id, called_on, outcome, note, actor)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [s.id, calledOn, outcome, note, s.session.username],
  );
  return NextResponse.json({ ok: true, callId: r.rows[0].id });
}
