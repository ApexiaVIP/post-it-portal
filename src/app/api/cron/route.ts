/**
 * Vercel Cron trigger endpoint.
 *
 * Fires at the schedule defined in vercel.json. Each invocation:
 *   1. Verifies it's Vercel (via CRON_SECRET bearer token).
 *   2. Checks if we're within 15 min of a POST IT target time (London).
 *   3. If yes, POSTs to GitHub's workflow_dispatch endpoint to trigger
 *      `post-it.yml` on the post-it-automation repo.
 *
 * If Vercel's schedule fires but nothing's nearby, we exit cleanly.
 * This way 1-2 Vercel cron entries can cover all 5 London target times
 * across BST/GMT (Hobby plan has a 2-cron-per-project limit).
 */
import { NextResponse } from "next/server";
import { sql } from "@vercel/postgres";
import { runNightlyBackup } from "@/lib/reci/backup";
import { sendStaleCaseDigest, type StaleDigestCase } from "@/lib/reci/email";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Target London-local times (hours * 60 + minutes)
const TARGETS_MIN: number[] = [
  11 * 60,          // 11:00
  12 * 60 + 30,     // 12:30
  15 * 60 + 30,     // 15:30
  17 * 60,          // 17:00
  20 * 60,          // 20:00
];
// How soon *after* a target do we still consider a fire "on time"?
const MATCH_WINDOW_MIN = 15;

function londonMinutesNow(): number {
  // Intl.DateTimeFormat with Europe/London handles DST automatically.
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(new Date());
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const m = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return h * 60 + m;
}

/** Sun=0 .. Sat=6 in Europe/London (handles BST/GMT cleanly). */
function londonWeekday(): number {
  const wd = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/London",
    weekday: "short",
  }).format(new Date());
  return ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(wd);
}

function isLondonWeekend(): boolean {
  const d = londonWeekday();
  return d === 0 || d === 6;
}

function matchingTarget(nowMin: number): string | null {
  for (const tm of TARGETS_MIN) {
    const delta = nowMin - tm;
    if (delta >= 0 && delta <= MATCH_WINDOW_MIN) {
      const h = Math.floor(tm / 60);
      const mm = tm % 60;
      return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
    }
  }
  return null;
}

async function triggerGithubWorkflow(): Promise<{ ok: boolean; status: number; body: string }> {
  const owner = process.env.GITHUB_OWNER;
  const repo  = process.env.GITHUB_REPO;
  const file  = process.env.GITHUB_WORKFLOW_FILE || "post-it.yml";
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!owner || !repo || !token) {
    return { ok: false, status: 500, body: "Missing GITHUB_OWNER / GITHUB_REPO / GITHUB_DISPATCH_TOKEN env" };
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "post-it-portal-cron",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  const body = r.status === 204 ? "" : await r.text();
  return { ok: r.ok, status: r.status, body: body.slice(0, 400) };
}


export async function GET(req: Request) {
  // Vercel Cron calls with `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  // (Docs: https://vercel.com/docs/cron-jobs/manage-cron-jobs#securing-cron-jobs)
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const auth = req.headers.get("authorization") || "";
    if (auth !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "forbidden" }, { status: 401 });
    }
  }

  // Nightly RECI backup: if the cron fires between 02:00 and 02:15 UTC,
  // snapshot deals + deal_history + advisers into Vercel KV. We use UTC here
  // (not London) so a single daily firing covers BST and GMT consistently.
  const utcMin = new Date().getUTCHours() * 60 + new Date().getUTCMinutes();
  if (utcMin >= 120 && utcMin <= 135) {
    try {
      const summary = await runNightlyBackup();
      return NextResponse.json({
        ok: true,
        action: "backup",
        ...summary,
      });
    } catch (e) {
      console.error("[cron] nightly backup failed:", e);
      return NextResponse.json({
        ok: false,
        action: "backup",
        error: e instanceof Error ? e.message : String(e),
      }, { status: 500 });
    }
  }

  // Stale-case digest for Guy + Poz: fires on the 10:00 UTC run only
  // (once daily), London weekdays. Runs as a side task BEFORE the POST
  // IT dispatch check because during BST 10:00 UTC is also the 11:00
  // London POST IT target -- both must happen on the same invocation.
  let staleDigest: { attempted: boolean; sent?: boolean; cases?: number; reason?: string } = { attempted: false };
  if (utcMin >= 600 && utcMin <= 615 && !isLondonWeekend()) {
    try {
      staleDigest = { attempted: true, ...(await runStaleDigest()) };
    } catch (e) {
      console.error("[cron] stale digest failed:", e);
      staleDigest = { attempted: true, sent: false, reason: e instanceof Error ? e.message : String(e) };
    }
  }

  const nowMin = londonMinutesNow();
  const target = matchingTarget(nowMin);

  if (!target) {
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "no target in window",
      nowMin,
      staleDigest,
    });
  }

  // POST IT dispatch is Mon-Fri only. The cron schedule went 7-day so the
  // 02:00 UTC backup branch can run on weekends, but the call centre isn't
  // open Sat/Sun so the scraper has nothing to scrape and would just time out.
  if (isLondonWeekend()) {
    return NextResponse.json({
      ok: true,
      action: "skipped",
      reason: "weekend (POST IT runs Mon-Fri only)",
      target,
    });
  }

  const result = await triggerGithubWorkflow();
  return NextResponse.json({
    ok: result.ok,
    action: "dispatched",
    target,
    githubStatus: result.status,
    githubBody: result.body,
    staleDigest,
  }, { status: result.ok ? 200 : 502 });
}

/**
 * Query open clawback cases with no human action inside the stale
 * threshold and email the digest to Guy + management. Threshold comes
 * from STALE_CASE_DAYS (default 3). Historic Old OW cases excluded --
 * they're parked, not "unworked".
 */
async function runStaleDigest(): Promise<{ sent: boolean; cases: number; reason?: string }> {
  const staleDays = Math.min(60, Math.max(1, Number(process.env.STALE_CASE_DAYS || 3)));
  const r = await sql.query<{
    policy_number: string;
    client_name: string;
    seller: string;
    clawback: string | null;
    trigger: string | null;
    days_idle: string;
  }>(
    `SELECT
        c.policy_number,
        c.client_name,
        COALESCE(a.name,
          CASE c.agent_bucket
            WHEN 'xstaff' THEN 'Xstaff'
            WHEN 'legacy' THEN 'Legacy'
            ELSE 'Needs review'
          END)                                        AS seller,
        COALESCE(c.final_clawback_due, c.clawback_due)::text AS clawback,
        c.ebah_warning                                AS trigger,
        FLOOR(EXTRACT(EPOCH FROM (now() - COALESCE(la.last_action_at, c.created_at))) / 86400)::text AS days_idle
     FROM clawback_cases c
     LEFT JOIN advisers a ON a.id = c.adviser_id
     LEFT JOIN LATERAL (
       SELECT MAX(h.created_at) AS last_action_at
       FROM clawback_history h
       WHERE h.case_id = c.id
         AND h.event_type IN ('note','contact_attempt','money_off','status_change')
     ) la ON true
     WHERE c.deleted_at IS NULL
       AND c.status = 'open'
       AND NOT (c.source = 'old_ow' AND c.ow_actualised_at IS NULL)
       AND COALESCE(la.last_action_at, c.created_at) < now() - ($1 || ' days')::interval
     ORDER BY COALESCE(c.final_clawback_due, c.clawback_due) DESC NULLS LAST`,
    [staleDays],
  );

  const cases: StaleDigestCase[] = r.rows.map((row) => ({
    policyNumber: row.policy_number,
    clientName: row.client_name,
    seller: row.seller,
    clawback: Number(row.clawback) || 0,
    daysIdle: Number(row.days_idle) || 0,
    trigger: row.trigger,
  }));

  if (cases.length === 0) return { sent: false, cases: 0, reason: "no stale cases" };
  const result = await sendStaleCaseDigest(cases, staleDays);
  console.error(`[cron] stale digest: ${cases.length} cases, sent=${result.sent}${result.reason ? ` (${result.reason})` : ""}`);
  return { sent: result.sent, cases: cases.length, reason: result.reason };
}
