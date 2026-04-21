import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadManualDataFor, saveManualDataFor } from "@/lib/store";
import {
  ADVISERS, ADVISER_FIELDS, RIC_FIELDS,
  emptyManualData, ManualData, londonDateIso,
} from "@/lib/schema";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: Request) {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const date = url.searchParams.get("date") || londonDateIso();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }
  const data = await loadManualDataFor(date);
  return NextResponse.json({ ...data, date });
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.username) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const body = (await req.json().catch(() => null)) as
    (Partial<ManualData> & { date?: string }) | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  const date = body.date || londonDateIso();
  if (!DATE_RE.test(date)) {
    return NextResponse.json({ error: "bad date" }, { status: 400 });
  }

  const clean = emptyManualData();
  for (const a of ADVISERS) {
    const row = body.daily?.[a] ?? {};
    for (const f of ADVISER_FIELDS) {
      const raw = (row as Record<string, unknown>)[f.key];
      const n = Number(raw);
      clean.daily[a][f.key] = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
    }
  }
  for (const f of RIC_FIELDS) {
    const raw = (body.ric as Record<string, unknown> | undefined)?.[f.key];
    const n = Number(raw);
    clean.ric[f.key] = Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0;
  }
  clean.ricComments =
    typeof body.ricComments === "string" ? body.ricComments.slice(0, 500) : "";
  clean.updatedAt = new Date().toISOString();
  clean.updatedBy = session.username;

  await saveManualDataFor(date, clean);
  return NextResponse.json({
    ok: true,
    date,
    updatedAt: clean.updatedAt,
    updatedBy: clean.updatedBy,
  });
}
