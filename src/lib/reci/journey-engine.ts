/**
 * Nurture journey engine: processes due sends and exits journeys when a
 * case moves on. Content and schedules live in journeys.ts; this module
 * owns the database side.
 *
 * Sending model: journey_sends rows are precomputed at start (one per
 * step, scheduled_for = start date + day offset, London dates). The
 * portal cron calls processDueJourneySends() on every invocation; a
 * send goes out at the first cron tick where (a) its date has arrived
 * and (b) its channel's window is open:
 *
 *   email  Mon-Fri 09:00-18:59 London
 *   SMS    Mon-Sat 10:00-17:59 London, never Sundays
 *
 * A send whose window is shut just stays pending for the next tick, so
 * a step scheduled on a Sunday goes out Monday. Guy's preferred
 * Tue-Thu / morning-evening email slots are a refinement for later;
 * the hard rules above are the compliance floor.
 */
import { sql } from "@vercel/postgres";
import { JOURNEYS, buildMergeCtx, isJourneyKey, type JourneyKey } from "./journeys";
import { sendJourneyClientEmail } from "./email";
import { sendSms, normaliseUkMobile } from "./sms";

// Minimal query interface satisfied by both `sql` and a pooled client,
// so the exit helper can run inside a caller's transaction. Method
// syntax on purpose: parameter bivariance lets pg's Primitive[] match.
interface Queryable {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>;
}

/**
 * Exit every active journey on a case (status change, money logged,
 * case deleted). Safe inside a transaction; no-op when nothing active.
 * Returns the number of journeys exited.
 */
export async function exitActiveJourneys(
  q: Queryable,
  caseId: number,
  reason: string,
  actor: string,
): Promise<number> {
  const r = await q.query(
    `UPDATE client_journeys
        SET status = 'exited', ended_at = now(), ended_reason = $2
      WHERE case_id = $1 AND status = 'active'
      RETURNING id, journey`,
    [caseId, reason],
  );
  if (!r.rowCount) return 0;
  const ids = r.rows.map((row) => row.id);
  await q.query(
    `UPDATE journey_sends
        SET status = 'skipped', detail = $2
      WHERE journey_id = ANY($1::int[]) AND status = 'pending'`,
    [ids, `journey exited: ${reason}`],
  );
  for (const row of r.rows) {
    await q.query(
      `INSERT INTO clawback_history (case_id, event_type, note, actor)
       VALUES ($1, 'journey', $2, $3)`,
      [caseId, `Journey ${String(row.journey).toUpperCase()} stopped automatically: ${reason}`, actor],
    );
  }
  return r.rowCount;
}

function londonNow(): { weekday: number; minutes: number; date: string } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short", hour: "2-digit", minute: "2-digit",
    year: "numeric", month: "2-digit", day: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(get("weekday"));
  return {
    weekday,
    minutes: Number(get("hour")) * 60 + Number(get("minute")),
    date: `${get("year")}-${get("month")}-${get("day")}`,
  };
}

function channelWindowOpen(channel: "email" | "sms", weekday: number, minutes: number): boolean {
  if (channel === "email") {
    return weekday >= 1 && weekday <= 5 && minutes >= 9 * 60 && minutes < 19 * 60;
  }
  // sms: Mon-Sat, 10:00-17:59, never Sundays
  return weekday >= 1 && weekday <= 6 && minutes >= 10 * 60 && minutes < 18 * 60;
}

export interface JourneyTickResult {
  due: number;
  sent: number;
  failed: number;
  skipped: number;
  exited: number;
  windowClosed: number;
  completed: number;
}

/**
 * Send everything due. Called from the cron on every invocation and
 * inline right after a journey starts (so day-0 steps fire while the
 * team is looking at the screen). Every outcome is logged; failures
 * never throw.
 */
export async function processDueJourneySends(): Promise<JourneyTickResult> {
  const out: JourneyTickResult = { due: 0, sent: 0, failed: 0, skipped: 0, exited: 0, windowClosed: 0, completed: 0 };
  const { weekday, minutes } = londonNow();

  const due = await sql.query<{
    send_id: number; journey_id: number; case_id: number;
    step_key: string; channel: "email" | "sms"; journey: string;
    case_status: string; deleted_at: string | null;
    client_first_name: string | null; client_name: string;
    client_email: string | null; client_phone: string | null;
    policy_number: string; net_premium: string | null;
    policy_start_date: string | null; off_risk_date: string | null;
  }>(
    `SELECT s.id AS send_id, s.journey_id, s.case_id, s.step_key, s.channel,
            j.journey,
            c.status AS case_status, c.deleted_at,
            c.client_first_name, c.client_name, c.client_email, c.client_phone,
            c.policy_number, c.net_premium,
            c.policy_start_date::text AS policy_start_date,
            c.off_risk_date::text AS off_risk_date
       FROM journey_sends s
       JOIN client_journeys j ON j.id = s.journey_id
       JOIN clawback_cases c ON c.id = s.case_id
      WHERE s.status = 'pending'
        AND j.status = 'active'
        AND s.scheduled_for <= (now() AT TIME ZONE 'Europe/London')::date
      ORDER BY s.scheduled_for, s.id
      LIMIT 50`,
  );
  out.due = due.rows.length;
  if (out.due === 0) return out;

  const exitedJourneys = new Set<number>();
  const touchedJourneys = new Set<number>();

  for (const row of due.rows) {
    if (exitedJourneys.has(row.journey_id)) continue;

    // A case that moved out of 'open' (or was deleted) between cron
    // ticks exits its journey here as a backstop; the API hooks handle
    // the common path.
    if (row.deleted_at || row.case_status !== "open") {
      await exitActiveJourneys(
        sql, row.case_id,
        row.deleted_at ? "case deleted" : `case status is ${row.case_status}`,
        "system",
      );
      exitedJourneys.add(row.journey_id);
      out.exited++;
      continue;
    }

    if (!channelWindowOpen(row.channel, weekday, minutes)) {
      out.windowClosed++;
      continue;
    }

    const jk = row.journey as JourneyKey;
    const step = isJourneyKey(jk) ? JOURNEYS[jk].steps.find((s) => s.key === row.step_key) : undefined;
    if (!step) {
      await sql.query(
        `UPDATE journey_sends SET status = 'failed', detail = 'unknown step definition' WHERE id = $1`,
        [row.send_id],
      );
      out.failed++;
      continue;
    }

    const { ctx, reason: ctxReason } = buildMergeCtx(row);
    if (!ctx) {
      // Config problem, not a case problem: leave pending so sends go
      // out as soon as the env var lands.
      console.error(`[journey] send ${row.send_id} held: ${ctxReason}`);
      out.windowClosed++;
      continue;
    }

    let result: { sent: boolean; reason?: string };
    let dest = "";
    if (row.channel === "email") {
      dest = (row.client_email || "").trim();
      if (!dest || !dest.includes("@")) {
        await sql.query(
          `UPDATE journey_sends SET status = 'skipped', detail = 'no email address on case' WHERE id = $1`,
          [row.send_id],
        );
        out.skipped++;
        touchedJourneys.add(row.journey_id);
        continue;
      }
      result = await sendJourneyClientEmail({
        to: dest,
        subject: step.subject ? step.subject(ctx) : `Your TopQuote policy ${ctx.policyNumber}`,
        body: step.body(ctx),
        label: `journey-${row.step_key}`,
      });
    } else {
      const mobile = normaliseUkMobile(row.client_phone);
      if (!mobile) {
        await sql.query(
          `UPDATE journey_sends SET status = 'skipped', detail = 'no usable mobile number on case' WHERE id = $1`,
          [row.send_id],
        );
        out.skipped++;
        touchedJourneys.add(row.journey_id);
        continue;
      }
      dest = mobile;
      result = await sendSms(mobile, step.body(ctx), `journey-${row.step_key}`);
    }

    if (result.sent) {
      await sql.query(
        `UPDATE journey_sends SET status = 'sent', sent_at = now() WHERE id = $1`,
        [row.send_id],
      );
      await sql.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
         VALUES ($1, 'journey', $2, 'system')`,
        [row.case_id, `Journey ${jk.toUpperCase()} ${step.label} sent (${row.channel}) to ${dest}`],
      );
      out.sent++;
    } else {
      await sql.query(
        `UPDATE journey_sends SET status = 'failed', detail = $2 WHERE id = $1`,
        [row.send_id, (result.reason || "send failed").slice(0, 500)],
      );
      out.failed++;
    }
    touchedJourneys.add(row.journey_id);
  }

  // Journeys with nothing left pending are complete.
  if (touchedJourneys.size > 0) {
    const done = await sql.query<{ id: number; case_id: number; journey: string }>(
      `UPDATE client_journeys j
          SET status = 'completed', ended_at = now(), ended_reason = 'all steps processed'
        WHERE j.id = ANY($1::int[])
          AND j.status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM journey_sends s
             WHERE s.journey_id = j.id AND s.status = 'pending'
          )
        RETURNING j.id, j.case_id, j.journey`,
      [Array.from(touchedJourneys)],
    );
    for (const row of done.rows) {
      await sql.query(
        `INSERT INTO clawback_history (case_id, event_type, note, actor)
         VALUES ($1, 'journey', $2, 'system')`,
        [row.case_id, `Journey ${String(row.journey).toUpperCase()} completed: all steps processed`],
      );
      out.completed++;
    }
  }

  if (out.due > 0) {
    console.error("[journey] tick", out);
  }
  return out;
}
