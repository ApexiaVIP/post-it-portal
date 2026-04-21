import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Only protect the admin page + /api/data. Login page and /api/latest (Bearer token)
// are public from a middleware standpoint (their handlers do their own checks).
export const config = {
  matcher: ["/", "/api/data/:path*"],
};

export async function middleware(req: NextRequest) {
  // We can't easily read iron-session from middleware (edge), so we do a cheap
  // presence check: the cookie is at least there. Server handlers verify it.
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
