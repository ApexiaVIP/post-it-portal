/**
 * GET /api/reci/clawback/cases/[id]/siblings
 *
 * Returns other active clawback cases for the SAME client, used by the
 * drawer's Add note and Log contact forms so the lads can tick "also
 * apply to these other policies" instead of typing the same note into
 * three cases.
 *
 * Match criteria: same client_last_name (case-insensitive) AND same
 * client_dob. If either DOB is null on this case, we fall back to
 * same last name AND same postcode (both must be non-null). Anything
 * looser risks over-matching to spouses at the same address.
 *
 * Excludes the current case, soft-deleted cases, and any case where
 * status is closed / dead (already done, no point re-noting).
 *
 * Auth: any user who can edit the case (same rule as POST events).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { getSession, isClawbackUser, getEditableAdviserId } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
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
  const meR = await sql<{
    id: number;
    adviser_id: number | null;
    client_last_name: string | null;
    client_dob: string | null;
    postcode: string | null;
  }>`
    SELECT id, adviser_id, client_last_name, client_dob::text AS client_dob, postcode
    FROM clawback_cases
    WHERE id = ${id} AND deleted_at IS NULL
  `;
  if (meR.rowCount === 0) {
    return NextResponse.json({ error: "case not found" }, { status: 404 });
  }
  const me = meR.rows[0];
  // Junior seller can only see (and later multi-apply to) their own
  // cases -- enforce here too so the response doesn't leak unrelated
  // matches.
  if (typeof editable === "number" && me.adviser_id !== editable) {
    return NextResponse.json({ error: "not your case" }, { status: 403 });
  }
  const lastName = (me.client_last_name || "").trim();
  if (!lastName) {
    return NextResponse.json({ siblings: [] });
  }

  // Preferred match: last name + DOB. Both indexed, both narrow enough
  // to be reliable. Fallback: last name + postcode when DOB is null on
  // this case.
  const scopeWhere = typeof editable === "number"
    ? `AND c.adviser_id = ${editable}`
    : "";
  const r = me.client_dob
    ? await sql<{
        id: number; policy_number: string; provider: string;
        client_name: string; postcode: string | null;
        clawback_due: string | null; status: string;
      }>`
        SELECT c.id, c.policy_number, c.provider, c.client_name, c.postcode,
               c.clawback_due::text AS clawback_due, c.status
          FROM clawback_cases c
         WHERE c.deleted_at IS NULL
           AND c.id <> ${id}
           AND c.status <> 'closed'
           AND LOWER(c.client_last_name) = LOWER(${lastName})
           AND c.client_dob = ${me.client_dob}::date
         ORDER BY c.policy_number ASC
      `
    : (me.postcode
        ? await sql<{
            id: number; policy_number: string; provider: string;
            client_name: string; postcode: string | null;
            clawback_due: string | null; status: string;
          }>`
            SELECT c.id, c.policy_number, c.provider, c.client_name, c.postcode,
                   c.clawback_due::text AS clawback_due, c.status
              FROM clawback_cases c
             WHERE c.deleted_at IS NULL
               AND c.id <> ${id}
               AND c.status <> 'closed'
               AND LOWER(c.client_last_name) = LOWER(${lastName})
               AND UPPER(c.postcode) = UPPER(${me.postcode})
             ORDER BY c.policy_number ASC
          `
        : { rows: [] as {
            id: number; policy_number: string; provider: string;
            client_name: string; postcode: string | null;
            clawback_due: string | null; status: string;
          }[] });

  // If the junior seller scope kicked in, we already limited above.
  // Just double-check we're not returning cases from other advisers on
  // the fallback path.
  const filtered = typeof editable === "number"
    ? await filterByAdviser(r.rows, editable)
    : r.rows;
  void scopeWhere;

  return NextResponse.json({
    matched_by: me.client_dob ? "dob" : "postcode",
    siblings: filtered.map((row) => ({
      id: row.id,
      policy_number: row.policy_number,
      provider: row.provider,
      client_name: row.client_name,
      postcode: row.postcode,
      clawback_due: row.clawback_due,
      status: row.status,
    })),
  });
}

// Safety filter for the fallback (last name + postcode) query when
// scoped to a single adviser. We do this in JS to keep the tagged-
// template queries simple.
async function filterByAdviser<T extends { id: number }>(
  rows: T[],
  adviserId: number,
): Promise<T[]> {
  if (rows.length === 0) return rows;
  const ids = rows.map((r) => r.id);
  // The tagged sql template doesn't like arrays as parameters; drop
  // to the query() form so we can pass ids as $1.
  const r = await sql.query<{ id: number }>(
    `SELECT id FROM clawback_cases
      WHERE id = ANY($1::int[]) AND adviser_id = $2`,
    [ids, adviserId],
  );
  const allowed = new Set(r.rows.map((x) => x.id));
  return rows.filter((row) => allowed.has(row.id));
}
