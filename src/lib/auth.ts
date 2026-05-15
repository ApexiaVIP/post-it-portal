/**
 * Session + credential helpers.
 *
 * 2 admin accounts are stored in env vars:
 *   ADMIN1_USERNAME        (e.g. "jimmy")
 *   ADMIN1_PASSWORD_HASH   (bcrypt hash of the password)
 *   ADMIN2_USERNAME        (e.g. "ric")
 *   ADMIN2_PASSWORD_HASH   (bcrypt hash)
 *
 * Generate hashes with: node -e "console.log(require('bcryptjs').hashSync('yourpass', 10))"
 * (or use the /api/auth/hash helper in dev mode, disabled in prod).
 */
import { cookies } from "next/headers";
import { getIronSession, SessionOptions, type IronSession } from "iron-session";
import bcrypt from "bcryptjs";

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
  for (const i of [1, 2, 3, 4, 5, 6]) {
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
//                           Default: "hayder"
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
const DATA_ENTRY_USERNAMES = parseList(process.env.DATA_ENTRY_USERNAMES ?? "hayder");

export type Role = "admin" | "data-entry" | "none";

export function roleFor(username: string | null | undefined): Role {
  if (!username) return "none";
  const u = username.toLowerCase();
  if (DASHBOARD_USERNAMES.includes(u))  return "admin";
  if (DATA_ENTRY_USERNAMES.includes(u)) return "data-entry";
  return "none";
}

// Full-access (admin) users. Used by APIs that should remain admin-only.
export function isDashboardUser(username: string | null | undefined): username is string {
  return roleFor(username) === "admin";
}

// Any authenticated user with a role (admin OR data-entry). Used by /api/data
// which both roles need.
export function isPortalUser(username: string | null | undefined): username is string {
  const r = roleFor(username);
  return r === "admin" || r === "data-entry";
}

// Path-level authorisation. Admins get everything. Data-entry users get only
// the POST IT data-entry page and its API plus the bare auth/role endpoints.
export function canAccessPath(username: string | null | undefined, pathname: string): boolean {
  const role = roleFor(username);
  if (role === "none")  return false;
  if (role === "admin") return true;
  // data-entry role from here on:
  if (pathname === "/")                       return true;
  if (pathname.startsWith("/api/data"))       return true;
  if (pathname.startsWith("/api/auth"))       return true;
  if (pathname === "/api/me")                 return true;
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
