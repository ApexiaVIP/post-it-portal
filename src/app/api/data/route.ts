import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { loadManualData, saveManualData } from "@/lib/store";
import {
  ADVISERS, ADVISER_FIELDS, RIC_FIELDS,
  emptyManualData, ManualData,
} from "@/lib/schema";

export async function GET() {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const data = await loadManualData();
  return NextResponse.json(data);
}

export async function POST(req: Request) {
  const session = await getSession();
  if (!session.username) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const body = (await req.json().catch(() => null)) as Partial<ManualData> | null;
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "bad body" }, { status: 400 });
  }

  // Normalise + validate strictly -- accept only known keys, coerce to ints.
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
  clean.ricComments = typeof body.ricComments === "string" ? body.ricComments.slice(0, 500) : "";
  clean.updatedAt = new Date().toISOString();
  clean.updatedBy = session.username;

  await saveManualData(clean);
  return NextResponse.json({ ok: true, updatedAt: clean.updatedAt, updatedBy: clean.updatedBy });
}
