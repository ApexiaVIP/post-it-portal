// Public-ish endpoint used by the GitHub Actions runner.
// Protected by a shared Bearer token (READ_API_TOKEN env var).

import { NextResponse } from "next/server";
import { verifyApiToken } from "@/lib/auth";
import { loadManualData } from "@/lib/store";

export const dynamic = "force-dynamic";  // always fresh

export async function GET(req: Request) {
  if (!verifyApiToken(req.headers.get("authorization"))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const data = await loadManualData();
  return NextResponse.json(data, {
    headers: { "Cache-Control": "no-store" },
  });
}
