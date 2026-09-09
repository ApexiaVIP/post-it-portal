"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADVISERS, ADVISER_FIELDS,
  type ManualData, emptyManualData, londonDateIso, datesInWeekUpTo,
} from "@/lib/schema";

type Saving = "idle" | "saving" | "saved" | "error";

interface MeFlags {
  canCallCentre?: boolean; canTracker?: boolean;
  canConfirmations?: boolean; canAnalytics?: boolean; canClawback?: boolean;
}

export default function AdminPage() {
  const [date, setDate] = useState<string>(londonDateIso());
  const [data, setData] = useState<ManualData | null>(null);
  const [saving, setSaving] = useState<Saving>("idle");
  const [err, setErr] = useState<string | null>(null);
  const [weekProgress, setWeekProgress] = useState<string | null>(null);
  const [me, setMe] = useState<MeFlags | null>(null);
  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then(setMe)
      .catch(() => setMe(null));
  }, []);

  const loadDate = useCallback(async (d: string) => {
    setData(null);
    try {
      const r = await fetch(`/api/data?date=${d}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as ManualData;
      setData(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    }
  }, []);

  useEffect(() => { loadDate(date); }, [date, loadDate]);

  const setDaily = useCallback((adviser: string, field: string, value: number) => {
    setData((d) => {
      if (!d) return d;
      return {
        ...d,
        daily: {
          ...d.daily,
          [adviser]: { ...d.daily[adviser as keyof typeof d.daily], [field]: value },
        },
      };
    });
  }, []);

  const resetAll = useCallback(() => {
    if (!confirm(`Reset every field to 0 for ${date}? (You still need to click Save.)`)) return;
    setData((d) => {
      const fresh = emptyManualData();
      return d ? { ...fresh, updatedAt: d.updatedAt, updatedBy: d.updatedBy } : fresh;
    });
  }, [date]);

  const resetWeek = useCallback(async () => {
    const today = londonDateIso();
    const dates = datesInWeekUpTo(today);
    if (!confirm(
      `This will wipe ALL manual data for ${dates.length} days this week ` +
      `(${dates[0]} through ${dates[dates.length - 1]}). Continue?`
    )) return;
    try {
      for (let i = 0; i < dates.length; i++) {
        setWeekProgress(`Clearing ${i + 1}/${dates.length}: ${dates[i]}…`);
        const r = await fetch("/api/data", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...emptyManualData(), date: dates[i] }),
        });
        if (!r.ok) throw new Error(`HTTP ${r.status} clearing ${dates[i]}`);
      }
      setWeekProgress(`Cleared ${dates.length} days.`);
      setTimeout(() => setWeekProgress(null), 3000);
      loadDate(date);  // refresh currently-viewed date
    } catch (e) {
      setErr(e instanceof Error ? e.message : "week reset failed");
      setWeekProgress(null);
    }
  }, [date, loadDate]);

  const save = useCallback(async () => {
    if (!data) return;
    setSaving("saving");
    setErr(null);
    try {
      const r = await fetch("/api/data", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, date }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({} as { error?: string }));
        throw new Error(j.error || `HTTP ${r.status}`);
      }
      const j = (await r.json()) as { updatedAt: string; updatedBy: string };
      setData((d) => (d ? { ...d, updatedAt: j.updatedAt, updatedBy: j.updatedBy } : d));
      setSaving("saved");
      setTimeout(() => setSaving("idle"), 2000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
      setSaving("error");
    }
  }, [data, date]);

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  const lastUpdated = useMemo(() => {
    if (!data?.updatedAt) return "never";
    const d = new Date(data.updatedAt);
    if (isNaN(d.getTime()) || data.updatedAt === "1970-01-01T00:00:00.000Z") return "never";
    return `${d.toLocaleString("en-GB", { timeZone: "Europe/London" })} by ${data.updatedBy || "?"}`;
  }, [data]);

  const isToday = date === londonDateIso();

  if (err) return <main className="p-8"><p className="text-red-600">Error: {err}</p></main>;
  if (!data) return <main className="p-8 text-slate-500">Loading {date}…</main>;

  return (
    <main className="max-w-7xl mx-auto p-4 md:p-8 space-y-6">
      {/* Role-aware nav (Poz 9 Sep 2026): the MI access granted to Tan
          and Hayder was invisible because this landing page had no links
          to anywhere. Buttons render only for areas the user can open. */}
      {me && (me.canCallCentre || me.canTracker || me.canConfirmations || me.canAnalytics || me.canClawback) && (
        <nav className="flex flex-wrap items-center gap-2 text-sm">
          {me.canCallCentre && (
            <a href="/dashboard" className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">Live Dashboard</a>
          )}
          {me.canCallCentre && (
            <a href="/dashboard/range" className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">Week range report</a>
          )}
          {me.canTracker && (
            <a href="/reci/tracker" className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">Business Tracker</a>
          )}
          {me.canConfirmations && (
            <a href="/reci/confirmations" className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1.5 font-medium text-emerald-800 hover:bg-emerald-100">Confirmation Planner</a>
          )}
          {me.canAnalytics && (
            <a href="/reci/analytics" className="rounded border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-700 hover:bg-slate-100">RECI Analytics</a>
          )}
          {me.canClawback && (
            <a href="/reci/clawback" className="rounded border border-indigo-300 bg-indigo-50 px-3 py-1.5 font-medium text-indigo-800 hover:bg-indigo-100">Clawback Dashboard</a>
          )}
        </nav>
      )}

      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">POST IT Portal</h1>
          <p className="text-sm text-slate-500">
            Editing <strong>{date}</strong> {isToday && "(today)"} — last saved: <span className="font-mono">{lastUpdated}</span>
          </p>
          {weekProgress && <p className="text-xs text-emerald-700 mt-1">{weekProgress}</p>}
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm flex items-center gap-2">
            <span className="text-slate-600">Date:</span>
            <input
              type="date"
              value={date}
              max={londonDateIso()}
              onChange={(e) => setDate(e.target.value)}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          {!isToday && (
            <button
              onClick={() => setDate(londonDateIso())}
              className="text-sm text-slate-500 hover:text-slate-700 underline"
            >
              Jump to today
            </button>
          )}
          <span
            className={
              saving === "saving"  ? "text-slate-500" :
              saving === "saved"   ? "text-emerald-600" :
              saving === "error"   ? "text-red-600"   :
              "text-slate-400"
            }
          >
            {saving === "saving" ? "Saving…" :
             saving === "saved"  ? "Saved ✓" :
             saving === "error"  ? "Error" : ""}
          </span>
          <button
            onClick={resetAll}
            className="border border-slate-300 rounded px-3 py-2 text-sm text-slate-700 hover:bg-slate-100"
            title={`Zero every field for ${date} only (you still need to click Save)`}
          >
            Reset day
          </button>
          <button
            onClick={resetWeek}
            className="border border-red-300 text-red-700 rounded px-3 py-2 text-sm hover:bg-red-50"
            title="Wipe all manual data for Monday through today"
          >
            Reset entire week
          </button>
          <button
            onClick={save}
            className="bg-slate-900 text-white rounded px-4 py-2 font-medium hover:bg-slate-800"
          >
            Save
          </button>
          <button
            onClick={logout}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            Sign out
          </button>
        </div>
      </header>

      {!isToday && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
          You&apos;re editing data for a <strong>past date</strong>. Saving updates the
          record for {date}. Weekly totals on future POST IT emails will include the corrected values.
        </div>
      )}

      <section className="bg-white shadow rounded-lg overflow-x-auto">
        <h2 className="text-lg font-medium p-4 border-b">Daily – advisers ({date})</h2>
        <table className="text-sm w-full border-separate border-spacing-0">
          <thead className="bg-slate-100">
            <tr>
              <th className="text-left px-3 py-2 sticky left-0 bg-slate-100 z-10 border-b">Adviser</th>
              {ADVISER_FIELDS.map((f) => (
                <th key={f.key} className="text-left px-2 py-2 border-b whitespace-nowrap" title={`Col ${f.col}`}>
                  {f.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {ADVISERS.map((a, idx) => (
              <tr key={a} className={idx % 2 ? "bg-slate-50" : ""}>
                <td className="px-3 py-2 sticky left-0 font-medium bg-inherit">{a}</td>
                {ADVISER_FIELDS.map((f) => (
                  <td key={f.key} className="px-1 py-1">
                    <input
                      type="number" min={0} inputMode="numeric"
                      className="w-16 rounded border border-slate-300 px-2 py-1 text-right tabular-nums"
                      value={data.daily[a][f.key] ?? 0}
                      onChange={(e) => setDaily(a, f.key, Number(e.target.value) || 0)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Customer Service - Ric section hidden 13 Aug 2026 (Poz): Ric
          left the business months ago and nothing is recorded here.
          The ric fields stay in the data model + API for old dates, so
          restoring the section is just un-hiding this block. */}

      <footer className="text-xs text-slate-500">
        Data is stored per-date. Change the date picker to edit past days. Weekly totals on each POST IT email sum Mon–today automatically.
      </footer>
    </main>
  );
}
