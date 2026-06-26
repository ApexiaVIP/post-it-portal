/**
 * GET /api/reci/clawback/activity
 *
 * Cross-case audit feed for Guy + Poz. Every clawback_history event,
 * newest first, joined back to the parent case so we can render the
 * client + seller + CB amount alongside each event.
 *
 * Auth: any user who can reach the Clawback Dashboard (Jimmy / Pauline /
 * Poz / Guy at the moment -- sellers are currently locked out by Poz's
 * Jun 2026 instruction).
 *
 * Query params:
 *   days        integer (default 7). Window in days. 0 = no limit.
 *   event_type  comma-separated list of event types to include. Empty =
 *               every type.
 *   adviser     numeric adviser_id, "xstaff" or "legacy" to filter by
 *               agent_bucket+adviser_id.
 *   limit       integer (default 500, max 2000).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser } from "@/lib/auth";

export const dynamic = "force-dynamic";

const KNOWN_EVENT_TYPES = new Set([
  "created", "ebah_change", "status_change", "note",
  "contact_attempt", "money_off", "email_sent",
]);

export async function GET(req: Request) {
  const session = await getSession();
  if (!isClawbackUser(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { searchParams } = new URL(req.url);
  const days       = Math.max(0, Number(searchParams.get("days") || 7));
  const limit      = Math.min(2000, Math.max(1, Number(searchParams.get("limit") || 500)));
  const eventTypes = (searchParams.get("event_type") || "")
    .split(",")
    .map((s) => s.trim())
    .filter((s) => KNOWN_EVENT_TYPES.has(s));
  const adviserRaw = searchParams.get("adviser") || "";

  const where: string[] = [];
  const params: (string | number | string[])[] = [];
  function add(clause: string, value: string | number | string[]) {
    params.push(value);
    where.push(clause.replace("$$", `$${params.length}`));
  }
  if (days > 0)               add("h.created_at >= now() - ($$ || ' days')::interval", days);
  if (eventTypes.length > 0)  add("h.event_type = ANY($$)", eventTypes);
  if (adviserRaw === "xstaff") {
    where.push("c.agent_bucket = 'xstaff'");
  } else if (adviserRaw === "legacy") {
    where.push("c.agent_bucket = 'legacy'");
  } else if (adviserRaw && Number.isFinite(Number(adviserRaw))) {
    add("c.adviser_id = $$", Number(adviserRaw));
  }
  const whereSql = where.length > 0 ? `WHERE ${where.join(" AND ")}` : "";
  params.push(limit);
  const limitParam = `$${params.length}`;

  const rowsR = await sql.query(
    `SELECT
        h.id              AS event_id,
        h.case_id,
        h.event_type,
        h.field,
        h.old_value,
        h.new_value,
        h.amount::float   AS amount,
        h.money_kind,
        h.note,
        h.actor,
        h.created_at AT TIME ZONE 'Europe/London' AS created_at,
        c.policy_number,
        c.client_name,
        c.postcode,
        c.provider,
        c.ebah_warning,
        c.status,
        c.clawback_due::float AS clawback_due,
        COALESCE(c.final_clawback_due, c.openwork_clawback_due, c.clawback_due)::float AS effective_cb,
        c.agent_bucket,
        c.adviser_id,
        a.name            AS adviser_name
     FROM clawback_history h
     JOIN clawback_cases c ON c.id = h.case_id
     LEFT JOIN advisers a ON a.id = c.adviser_id
     ${whereSql}
     ORDER BY h.created_at DESC, h.id DESC
     LIMIT ${limitParam}`,
    params,
  );

  // Tile counts for the top-of-page summary, scoped to the same days filter
  // but ignoring the event_type / adviser filter so the tiles always show
  // the full breakdown for the time window.
  const tileWhere = days > 0
    ? `WHERE h.created_at >= now() - (${days} || ' days')::interval`
    : "";
  const tilesR = await sql.query(
    `SELECT
        h.event_type,
        COUNT(*)::int AS n
     FROM clawback_history h
     ${tileWhere}
     GROUP BY h.event_type
     ORDER BY n DESC`,
    [],
  );

  // Distinct sellers seen in the activity log so the filter dropdown is
  // built from real data (excludes anyone with no activity in window).
  const sellersR = await sql.query(
    `SELECT
        c.adviser_id,
        c.agent_bucket,
        a.name AS adviser_name,
        COUNT(*)::int AS events
     FROM clawback_history h
     JOIN clawback_cases c ON c.id = h.case_id
     LEFT JOIN advisers a ON a.id = c.adviser_id
     ${tileWhere}
     GROUP BY c.adviser_id, c.agent_bucket, a.name
     ORDER BY events DESC`,
    [],
  );

  return NextResponse.json({
    days,
    events: rowsR.rows,
    tiles: tilesR.rows,
    sellers: sellersR.rows,
  });
}
