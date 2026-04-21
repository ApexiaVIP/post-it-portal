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
