/**
 * PUT /api/reci/clawback/cases/[id]/details
 *
 * Edit the basic information on a clawback case. Pauline / Poz / Jimmy
 * only. The dedicated workflows still own their own buttons (status,
 * Final CB, Source, money_off, Notify) -- this endpoint covers the
 * "fix typos and rerouting" gap.
 *
 * Editable fields (all optional in the body; only the keys present get
 * touched):
 *   client_first_name, client_last_name
 *   client_dob       (ISO YYYY-MM-DD or null to clear)
 *   client_phone, client_email
 *   postcode
 *   policy_type
 *   ebah_warning     (the L&G warning category text)
 *   clawback_date    (ISO YYYY-MM-DD or null)
 *   net_premium      (number or null)
 *   ebah_agent_name  (the L&G sales-agent string)
 *   adviser_id       (number to assign to a specific adviser, or null to
 *                     wipe the assignment + set bucket from agent_bucket)
 *   agent_bucket     ("adviser" | "xstaff" | "legacy" | "needs_review")
 *
 * Locked down (use dedicated endpoints / handlers instead):
 *   policy_number    (identity key; changing breaks history + deep links)
 *   provider         (controls upload routing)
 *   status           (PATCH /cases/[id])
 *   saved_amount, resold_amount (POST /cases/[id]/events)
 *   clawback_due, final_clawback_due (PUT /cases/[id]/final-cb)
 *   source           (PUT /cases/[id]/source)
 *
 * Every field that actually changes writes an `ebah_change` row to
 * clawback_history with old + new value so the timeline stays honest.
 */
import { NextResponse } from "next/server";
import { db } from "@vercel/postgres";
import { getSession, isClawbackUser, isClawbackAdmin } from "@/lib/auth";

export const dynamic = "force-dynamic";

const ALLOWED_BUCKETS = new Set(["adviser","xstaff","legacy","needs_review"]);
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type Body = {
  client_first_name?: unknown;
  client_last_name?:  unknown;
  client_dob?:        unknown;
  client_phone?:      unknown;
  client_email?:      unknown;
  postcode?:          unknown;
  policy_type?:       unknown;
  ebah_warning?:      unknown;
  clawback_date?:     unknown;
  net_premium?:       unknown;
  ebah_agent_name?:   unknown;
  adviser_id?:        unknown;
  agent_bucket?:      unknown;
};

function asString(v: unknown): string | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t === "" ? null : t;
}
function asDate(v: unknown): string | null | undefined {
  const s = asString(v);
  if (s === undefined) return undefined;
  if (s === null) return null;
  return DATE_RE.test(s) ? s : undefined;
}
function asNumberOrNull(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  if (typeof v === "string" && v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}
function asAdviserId(v: unknown): number | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}
function asBucket(v: unknown): string | undefined {
  if (v === undefined) return undefined;
  if (typeof v !== "string") return undefined;
  return ALLOWED_BUCKETS.has(v) ? v : undefined;
}

export async function PUT(
  req: Request,
  { params }: { params: { id: string } },
) {
  const session = await getSession();
  if (!isClawbackUser(session.username) || !isClawbackAdmin(session.username)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }
  const id = Number(params.id);
  if (!Number.isFinite(id) || id <= 0) {
    return NextResponse.json({ error: "bad id" }, { status: 400 });
  }
  const body = await req.json().catch(() => ({})) as Body;

  // Resolve every incoming field once. `undefined` = key not present, skip.
  // `null` = explicit clear. Anything else = new value.
  const updates: { col: string; value: string | number | null }[] = [];

  const firstName    = asString(body.client_first_name);
  const lastName     = asString(body.client_last_name);
  const dob          = asDate(body.client_dob);
  const phone        = asString(body.client_phone);
  const email        = asString(body.client_email);
  const postcode     = asString(body.postcode);
  const policyType   = asString(body.policy_type);
  const ebahWarning  = asString(body.ebah_warning);
  const cbDate       = asDate(body.clawback_date);
  const netPremium   = asNumberOrNull(body.net_premium);
  const ebahAgent    = asString(body.ebah_agent_name);
  const adviserId    = asAdviserId(body.adviser_id);
  const bucket       = asBucket(body.agent_bucket);

  if (firstName   !== undefined) updates.push({ col: "client_first_name", value: firstName });
  if (lastName    !== undefined) updates.push({ col: "client_last_name",  value: lastName });
  if (dob         !== undefined) updates.push({ col: "client_dob",        value: dob });
  if (phone       !== undefined) updates.push({ col: "client_phone",      value: phone });
  if (email       !== undefined) updates.push({ col: "client_email",      value: email });
  if (postcode    !== undefined) updates.push({ col: "postcode",          value: postcode });
  if (policyType  !== undefined) updates.push({ col: "policy_type",       value: policyType });
  if (ebahWarning !== undefined) updates.push({ col: "ebah_warning",      value: ebahWarning });
  if (cbDate      !== undefined) updates.push({ col: "clawback_date",     value: cbDate });
  if (netPremium  !== undefined) updates.push({ col: "net_premium",       value: netPremium });
  if (ebahAgent   !== undefined) updates.push({ col: "ebah_agent_name",   value: ebahAgent ?? "" });
  if (adviserId   !== undefined) updates.push({ col: "adviser_id",        value: adviserId });
  if (bucket      !== undefined) updates.push({ col: "agent_bucket",      value: bucket });

  // If first OR last name was edited, derive a fresh display client_name
  // so the dashboard "Mr Lorraine Ashton" string stays in sync. We don't
  // touch any title prefix here -- just rebuild as "First Last".
  // Caller passes both halves; we trust them.
  if (firstName !== undefined || lastName !== undefined) {
    // Need current values to compose the missing half if the caller only
    // sent one. Look up below inside the transaction.
  }

  if (updates.length === 0) {
    return NextResponse.json({ error: "no editable fields supplied" }, { status: 400 });
  }

  const client = await db.connect();
  try {
    await client.query("BEGIN");
    const cur = await client.query<{
      id: number;
      client_name: string; client_first_name: string | null; client_last_name: string | null;
      client_dob: string | null;
      client_phone: string | null; client_email: string | null;
      postcode: string | null; policy_type: string | null;
      ebah_warning: string | null; clawback_date: string | null;
      net_premium: string | null; ebah_agent_name: string;
      adviser_id: number | null; agent_bucket: string;
    }>(
      `SELECT id,
              client_name, client_first_name, client_last_name,
              client_dob::text AS client_dob,
              client_phone, client_email,
              postcode, policy_type, ebah_warning,
              clawback_date::text AS clawback_date,
              net_premium::text  AS net_premium,
              ebah_agent_name, adviser_id, agent_bucket
         FROM clawback_cases WHERE id = $1`,
      [id],
    );
    if (cur.rowCount === 0) {
      await client.query("ROLLBACK");
      return NextResponse.json({ error: "case not found" }, { status: 404 });
    }
    const prev = cur.rows[0];

    // Rebuild client_name when either half changed.
    if (firstName !== undefined || lastName !== undefined) {
      const newFirst = firstName !== undefined ? firstName : (prev.client_first_name ?? "");
      const newLast  = lastName  !== undefined ? lastName  : (prev.client_last_name  ?? "");
      const composed = [newFirst, newLast].filter(Boolean).join(" ").trim();
      const finalName = composed || prev.client_name;
      updates.push({ col: "client_name", value: finalName });
    }

    // Build the SET clause + write field-change history rows in one pass.
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    let p = 0;
    for (const u of updates) {
      // For date columns, cast incoming string back to date so Postgres
      // doesn't reject it.
      const cast = (u.col === "client_dob" || u.col === "clawback_date") ? "::date" : "";
      sets.push(`${u.col} = $${++p}${cast}`);
      vals.push(u.value);
    }
    sets.push(`updated_at = now()`);
    vals.push(id);
    const sql = `UPDATE clawback_cases SET ${sets.join(", ")} WHERE id = $${++p}`;
    await client.query(sql, vals);

    // History audit: one ebah_change row per actually-changed field.
    // Map column name -> previous value so we only log real diffs.
    const prevMap: Record<string, string | number | null> = {
      client_first_name: prev.client_first_name,
      client_last_name:  prev.client_last_name,
      client_name:       prev.client_name,
      client_dob:        prev.client_dob,
      client_phone:      prev.client_phone,
      client_email:      prev.client_email,
      postcode:          prev.postcode,
      policy_type:       prev.policy_type,
      ebah_warning:      prev.ebah_warning,
      clawback_date:     prev.clawback_date,
      net_premium:       prev.net_premium,
      ebah_agent_name:   prev.ebah_agent_name,
      adviser_id:        prev.adviser_id,
      agent_bucket:      prev.agent_bucket,
    };
    for (const u of updates) {
      const before = prevMap[u.col];
      const after  = u.value;
      const beforeStr = before === null || before === undefined ? null : String(before);
      const afterStr  = after  === null || after  === undefined ? null : String(after);
      if (beforeStr === afterStr) continue;
      await client.query(
        `INSERT INTO clawback_history
           (case_id, event_type, field, old_value, new_value, actor)
         VALUES ($1, 'ebah_change', $2, $3, $4, $5)`,
        [id, u.col, beforeStr, afterStr, session.username],
      );
    }

    await client.query("COMMIT");
    return NextResponse.json({ ok: true });
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  } finally {
    client.release();
  }
}
