/**
 * Session + credential helpers.
 *
 * Login accounts are stored in env vars, ADMINn_USERNAME / ADMINn_PASSWORD_HASH
 * for n = 1..10 so we have room for jimmy + pauline + poz + tan + hayder +
 * gurdaht + atikur + jack + guy plus one spare. The name "ADMIN" is historic;
 * actual access scope is decided by the allowlists in this file, not by
 * having a credential.
 *
 * Generate hashes with: node -e "console.log(require('bcryptjs').hashSync('yourpass', 10))"
 * (or use the /api/auth/hash helper in dev mode, disabled in prod).
 */
import { cookies } from "next/headers";
import { getIronSession, SessionOptions, type IronSession } from "iron-session";
import bcrypt from "bcryptjs";
import { sql } from "@vercel/postgres";

export interface SessionData {
  username?: string;
  loginAt?: number;
}

const password = process.env.SESSION_PASSWORD;
if (!password || password.length < 32) {
  // Will throw at first request if not set in prod; fine for local dev without session.
  // eslint-disable-next-line no-console
  console.warn("SESSION_PASSWORD not set or <32 chars; sessions will fail in production.");
}

const cookieName = "post-it-session";
export const sessionOptions: SessionOptions = {
  password: password || "dev-only-dev-only-dev-only-dev-only-32ch",
  cookieName,
  cookieOptions: {
    secure: process.env.NODE_ENV === "production",
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  },
};

export async function getSession(): Promise<IronSession<SessionData>> {
  return getIronSession<SessionData>(cookies(), sessionOptions);
}

interface Credential { username: string; hash: string; }

function loadCredentials(): Credential[] {
  const out: Credential[] = [];
  for (let i = 1; i <= 10; i++) {
    const u = process.env[`ADMIN${i}_USERNAME`];
    const h = process.env[`ADMIN${i}_PASSWORD_HASH`];
    if (u && h) out.push({ username: u, hash: h });
  }
  return out;
}

export async function verifyCredentials(
  username: string,
  password: string,
): Promise<boolean> {
  const creds = loadCredentials();
  const c = creds.find((c) => c.username.toLowerCase() === username.toLowerCase());
  if (!c) return false;
  try {
    return await bcrypt.compare(password, c.hash);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// Role-based access
//
// Two allowlists, both env-driven:
//
//   DASHBOARD_USERNAMES  -> "admin" role: full access to every section
//                           (POST IT data entry, RECI boards, RECI Analytics,
//                           Call-Centre Dashboard).
//                           Default: "jimmy,pauline,poz"
//
//   DATA_ENTRY_USERNAMES -> "data-entry" role: access to the POST IT page (/)
//                           and the /api/data endpoint ONLY. Everything else
//                           is locked down.
//                           Default: "hayder,tan"
//
// Both lists are comma-separated and case insensitive. Even a user with a
// valid admin credential is rejected unless they appear in one of the lists.
// ---------------------------------------------------------------------------
function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .toLowerCase()
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

const DASHBOARD_USERNAMES  = parseList(process.env.DASHBOARD_USERNAMES  ?? "jimmy,pauline,poz");
const DATA_ENTRY_USERNAMES = parseList(process.env.DATA_ENTRY_USERNAMES ?? "hayder,tan");
// Clawback Dashboard admins: same as DASHBOARD_USERNAMES by default (Jimmy /
// Pauline / Poz) but env var kept distinct so a future admin can be added
// without unlocking the rest of the portal.
const CLAWBACK_USERNAMES   = parseList(process.env.CLAWBACK_USERNAMES   ?? "jimmy,pauline,poz");
// Senior sellers (Tan, Hayder) get full read + edit access on every case
// across the team. They cover Xstaff cases and step in on urgent ones for
// the juniors. Same powers as admin EXCEPT they can't upload EBAH files,
// fire the Notify backfill, or open the Manual New Case form -- those
// stay with Pauline / Jimmy so a dropped file or fat-finger can't damage
// the canonical state.
const RECI_SENIOR_SELLER_USERNAMES = parseList(
  process.env.RECI_SENIOR_SELLER_USERNAMES ?? "tan,hayder",
);
// Junior sellers (Gurdaht, Atikur). See every case across the team for
// transparency + lead browsing, but only edit cases assigned to their own
// adviser_id. UI puts each edit behind a "Take action on this case"
// verification gate so saves are deliberate. Jack is deliberately NOT in
// this list -- he moved to Xstaff (Pauline, June 2026); his existing
// cases will be re-bucketed by the Jack migration separately.
const RECI_JUNIOR_SELLER_USERNAMES = parseList(
  process.env.RECI_JUNIOR_SELLER_USERNAMES ?? "gurdaht,atikur",
);
// Legacy env var kept as a fallback during the transition. If neither of
// the new lists is populated and RECI_SELLER_USERNAMES is, everyone in it
// is treated as a junior seller (safer default).
const LEGACY_SELLER_USERNAMES = parseList(process.env.RECI_SELLER_USERNAMES ?? "");
// Read-only viewers (Guy) see EVERY seller's cases on the dashboard and the
// reports page, but cannot edit anything or upload EBAH files.
const CLAWBACK_VIEWER_USERNAMES = parseList(process.env.CLAWBACK_VIEWER_USERNAMES ?? "guy");

export type Role = "admin" | "data-entry" | "reci-seller" | "clawback-viewer" | "none";

// Primary role for path-based access. Precedence: admin wins. If the user
// also appears in data-entry, that's exposed via canAccessPath; if they also
// appear in a seller/viewer list, that's exposed via isClawbackUser and
// clawbackScope. Roles aren't mutually exclusive at the feature level even
// though this returns a single primary label.
export function roleFor(username: string | null | undefined): Role {
  if (!username) return "none";
  const u = username.toLowerCase();
  if (DASHBOARD_USERNAMES.includes(u))         return "admin";
  if (DATA_ENTRY_USERNAMES.includes(u))        return "data-entry";
  if (RECI_SENIOR_SELLER_USERNAMES.includes(u)
   || RECI_JUNIOR_SELLER_USERNAMES.includes(u)
   || LEGACY_SELLER_USERNAMES.includes(u))     return "reci-seller";
  if (CLAWBACK_VIEWER_USERNAMES.includes(u))   return "clawback-viewer";
  return "none";
}

// Full-access (admin) users. Used by APIs that should remain admin-only.
export function isDashboardUser(username: string | null | undefined): username is string {
  return roleFor(username) === "admin";
}

// Anyone who can reach /reci/clawback at all.
//
// Three tiers + viewer:
//   - Admin (Pauline / Poz / Jimmy)         see all, edit all, upload EBAH,
//                                            backfill, new case
//   - Senior seller (Tan / Hayder)           see all, edit all (no upload /
//                                            backfill / new case)
//   - Junior seller (Gurdaht / Atikur)       see all, edit only OWN cases,
//                                            via verification gate
//   - Viewer (Guy)                           see all, edit nothing
//
// Per-case write permissions are enforced by getEditableAdviserId() +
// the API route handlers, not by the read-side scope.
export function isClawbackUser(username: string | null | undefined): username is string {
  if (!username) return false;
  const u = username.toLowerCase();
  return CLAWBACK_USERNAMES.includes(u)
      || CLAWBACK_VIEWER_USERNAMES.includes(u)
      || RECI_SENIOR_SELLER_USERNAMES.includes(u)
      || RECI_JUNIOR_SELLER_USERNAMES.includes(u)
      || LEGACY_SELLER_USERNAMES.includes(u);
}

// Capability checks for the Clawback Dashboard. Frontend uses these to
// hide buttons (upload widget, Notify); APIs use them to reject writes.
export function isClawbackAdmin(username: string | null | undefined): boolean {
  if (!username) return false;
  return CLAWBACK_USERNAMES.includes(username.toLowerCase());
}
// Client nurture journeys are restricted to Poz while the process beds
// in (Jimmy, 17 Jul 2026: "ONLY available for Poz right now"). Env-driven
// so widening it to sellers later is a Vercel env change, not a deploy.
const JOURNEY_USERNAMES = parseList(process.env.JOURNEY_USERNAMES ?? "pauline,poz");
export function canRunJourneys(username: string | null | undefined): boolean {
  if (!username) return false;
  return JOURNEY_USERNAMES.includes(username.toLowerCase());
}
export function isSeniorSeller(username: string | null | undefined): boolean {
  if (!username) return false;
  return RECI_SENIOR_SELLER_USERNAMES.includes(username.toLowerCase());
}
export function isJuniorSeller(username: string | null | undefined): boolean {
  if (!username) return false;
  const u = username.toLowerCase();
  return RECI_JUNIOR_SELLER_USERNAMES.includes(u)
      || (LEGACY_SELLER_USERNAMES.includes(u)
          && !RECI_SENIOR_SELLER_USERNAMES.includes(u)
          && !CLAWBACK_USERNAMES.includes(u));
}
// Legacy alias kept so old route handlers compile. Junior + senior are
// both "sellers" for the purpose of "is this a non-admin / non-viewer
// user who has clawback access via the seller route?"
export function isClawbackSeller(username: string | null | undefined): boolean {
  return isSeniorSeller(username) || isJuniorSeller(username);
}
export function isClawbackViewer(username: string | null | undefined): boolean {
  if (!username) return false;
  return CLAWBACK_VIEWER_USERNAMES.includes(username.toLowerCase());
}
// Any tier with edit rights at all. Used as a coarse gate by some UI;
// per-case decisions go through getEditableAdviserId() instead.
export function canEditClawback(username: string | null | undefined): boolean {
  return isClawbackAdmin(username) || isClawbackSeller(username);
}
// Admin + senior seller can edit ANY case. Junior sellers can edit only
// their own; viewers can't edit at all. Used to short-circuit the API
// per-case check when the user has blanket edit rights.
export function canEditAnyCase(username: string | null | undefined): boolean {
  return isClawbackAdmin(username) || isSeniorSeller(username);
}
// Only admins upload EBAH files, fire the Notify email or backfill /
// open the manual New Case form.
export function canUploadEbah(username: string | null | undefined): boolean {
  return isClawbackAdmin(username);
}
export function canNotifyCam(username: string | null | undefined): boolean {
  return isClawbackAdmin(username);
}

// Returns the adviser_id the user is scoped to. Null = no scope, can
// see every case. Used by the cases / reports / forecast / activity
// APIs to decide whether to inject a WHERE c.adviser_id = $scope.
//
// Scope rules (Pauline, 29 Jun 2026):
//   - Admin / viewer / senior seller -> null (see everything)
//   - Junior seller -> their own adviser_id (see ONLY their own cases)
//
// Junior sellers used to see every case but only edit their own. Pauline
// asked to lock the read view down too so Gurdaht and Atikur can focus
// on their own caseload without the noise of others' cases.
//
// Return -1 (sentinel) for anyone who isn't in any clawback tier --
// caller MUST treat as 403.
export async function clawbackAdviserScope(
  username: string | null | undefined,
): Promise<number | null | -1> {
  if (!username) return -1;
  if (isClawbackAdmin(username) || isClawbackViewer(username) || isSeniorSeller(username)) {
    return null;
  }
  if (isJuniorSeller(username)) {
    // Same lookup as getEditableAdviserId: resolve the adviser row by
    // username so the junior seller's reads narrow to their adviser_id.
    const u = username.toLowerCase();
    const r = await sql<{ id: number }>`
      SELECT id FROM advisers WHERE username = ${u} LIMIT 1
    `;
    if (r.rowCount === 0) return -1;
    return r.rows[0].id;
  }
  return -1;
}

/**
 * Per-case write permission resolver.
 *
 * Returns:
 *   null       - user can edit ANY case (admin, senior seller)
 *   number     - user can edit ONLY cases with this adviser_id (junior
 *                seller)
 *   undefined  - user can't edit anything (viewer, anyone else)
 *
 * Route handlers should:
 *   1. Reject undefined with 403.
 *   2. Allow null (skip per-case adviser check).
 *   3. For a number, compare against the case's adviser_id; reject with
 *      403 if they don't match.
 */
export async function getEditableAdviserId(
  username: string | null | undefined,
): Promise<number | null | undefined> {
  if (!username) return undefined;
  if (canEditAnyCase(username)) return null;
  if (isClawbackViewer(username)) return undefined;
  if (isJuniorSeller(username)) {
    const u = username.toLowerCase();
    const r = await sql<{ id: number }>`
      SELECT id FROM advisers WHERE username = ${u} LIMIT 1
    `;
    if (r.rowCount === 0) return undefined;
    return r.rows[0].id;
  }
  return undefined;
}

// Any authenticated user with a role (admin OR data-entry). Used by /api/data
// which both roles need.
export function isPortalUser(username: string | null | undefined): username is string {
  const r = roleFor(username);
  return r === "admin" || r === "data-entry";
}

// Path-level authorisation. Layered so multiple roles can apply to one user:
// e.g. Tan is both data-entry (for POST IT) and reci-seller (for clawback).
export function canAccessPath(username: string | null | undefined, pathname: string): boolean {
  const role = roleFor(username);
  if (role === "none") {
    // Even non-roled accounts may have a clawback role attached
    if (isClawbackUser(username)) {
      return pathname.startsWith("/reci/clawback")
          || pathname.startsWith("/api/reci/clawback")
          || pathname.startsWith("/api/auth")
          || pathname === "/api/me";
    }
    return false;
  }
  if (role === "admin") return true;
  // data-entry: still has access to POST IT entry; clawback gating below.
  if (pathname === "/")                       return true;
  if (pathname.startsWith("/api/data"))       return true;
  if (pathname.startsWith("/api/auth"))       return true;
  if (pathname === "/api/me")                 return true;
  // Sellers / viewers can reach /reci/clawback even if their primary role
  // is data-entry or none.
  if (isClawbackUser(username) && (
        pathname.startsWith("/reci/clawback")
     || pathname.startsWith("/api/reci/clawback"))) {
    return true;
  }
  return false;
}

export function verifyApiToken(authHeader: string | null): boolean {
  if (!authHeader) return false;
  const expected = process.env.READ_API_TOKEN;
  if (!expected) return false;
  const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!bearer || bearer.length !== expected.length) return false;
  // constant-time compare
  let diff = 0;
  for (let i = 0; i < bearer.length; i++) diff |= bearer.charCodeAt(i) ^ expected.charCodeAt(i);
  return diff === 0;
}
