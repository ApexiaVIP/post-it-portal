import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Protect /, /dashboard, /api/data, /api/snapshot (GET only uses session),
// /api/snapshots, /api/refresh.
// Login page, /api/auth/*, /api/cron, /api/latest (Bearer), /api/snapshot POST
// (Bearer) bypass the middleware or handle their own auth.
export const config = {
  matcher: [
    "/",
    "/dashboard",
    "/api/data/:path*",
    "/api/snapshots/:path*",
    "/api/refresh/:path*",
  ],
};

export async function middleware(req: NextRequest) {
  const hasCookie = req.cookies.has("post-it-session");
  if (!hasCookie) {
    if (req.nextUrl.pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("from", req.nextUrl.pathname);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}
