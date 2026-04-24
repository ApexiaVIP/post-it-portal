import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

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
