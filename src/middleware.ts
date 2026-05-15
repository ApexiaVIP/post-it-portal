import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import { sessionOptions, isDashboardUser, type SessionData } from "@/lib/auth";

export const config = {
  matcher: [
    "/",
    "/dashboard",
    "/reci/:path*",
    "/api/data/:path*",
    "/api/snapshots/:path*",
    "/api/refresh/:path*",
    "/api/reci/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  const isApi = req.nextUrl.pathname.startsWith("/api/");

  // Fast no-cookie short-circuit.
  if (!req.cookies.has("post-it-session")) {
    if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  // Open the session and enforce the dashboard allowlist. This is the urgent
  // lockdown layer: even a user with a valid session is rejected if they
  // aren't in DASHBOARD_USERNAMES.
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  if (!isDashboardUser(session.username)) {
    if (isApi) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  return res;
}
