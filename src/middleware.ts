import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getIronSession } from "iron-session";
import {
  sessionOptions, roleFor, canAccessPath, type SessionData,
} from "@/lib/auth";

export const config = {
  matcher: [
    "/",
    "/dashboard",
    "/reci/:path*",
    "/api/data/:path*",
    "/api/snapshots/:path*",
    "/api/refresh/:path*",
    "/api/reci/:path*",
    "/api/me",
  ],
};

export async function middleware(req: NextRequest) {
  const path = req.nextUrl.pathname;
  const isApi = path.startsWith("/api/");

  // Fast no-cookie short-circuit.
  if (!req.cookies.has("post-it-session")) {
    if (isApi) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", path);
    return NextResponse.redirect(url);
  }

  // Open the session to check the user's role.
  const res = NextResponse.next();
  const session = await getIronSession<SessionData>(req, res, sessionOptions);
  const role = roleFor(session.username);

  // No role at all -> push back to login with denied flag.
  if (role === "none") {
    if (isApi) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("denied", "1");
    return NextResponse.redirect(url);
  }

  // Has a role but not for this path. For pages, bounce signed-in users to
  // their home page (the POST IT screen) rather than logging them out.
  if (!canAccessPath(session.username, path)) {
    if (isApi) return NextResponse.json({ error: "forbidden" }, { status: 403 });
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return res;
}
