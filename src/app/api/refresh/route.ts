import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export async function POST() {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const owner = process.env.GITHUB_OWNER;
  const repo = process.env.GITHUB_REPO;
  const file = process.env.GITHUB_WORKFLOW_FILE || "post-it.yml";
  const token = process.env.GITHUB_DISPATCH_TOKEN;
  if (!owner || !repo || !token) {
    return NextResponse.json({ error: "github dispatch not configured" }, { status: 500 });
  }
  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${file}/dispatches`;
  const r = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      "User-Agent": "post-it-portal-refresh",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ref: "main" }),
  });
  if (!r.ok) {
    const body = await r.text();
    return NextResponse.json(
      { ok: false, githubStatus: r.status, githubBody: body.slice(0, 400) },
      { status: 502 },
    );
  }
  return NextResponse.json({ ok: true, triggeredAt: new Date().toISOString(), by: session.username });
}
