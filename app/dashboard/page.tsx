"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ADVISERS, ADVISER_FIELDS, RIC_FIELDS, londonDateIso,
} from "@/lib/schema";

type Snapshot = {
  capturedAt: string;
  date: string;
  target: string;
  daily_auto: Record<string, { talk_time_mmss: number; total_calls: number; hellos: number }>;
  daily_manual: Record<string, Record<string, number>>;
  weekly_auto: Record<string, { talk_time_mmss: number; total_calls: number; hellos: number }>;
  weekly_manual: Record<string, Record<string, number>>;
  ric_daily_auto: { talk_time_mmss: number; total_calls: number; hellos: number };
  ric_manual: Record<string, number>;
  ric_comments: string;
  clearvolt_sources: Record<string, { talk_seconds: number; total_calls: number; hellos: number; display?: string }>;
  cloudtalk_sources: Record<string, { talk_seconds: number; total_calls: number; hellos: number; display?: string }>;
  cloudtalk_unmapped: string[];
  portal_updated_at: string;
  portal_updated_by: string;
};

const REFRESH_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

function pct(num: number, den: number): string {
  if (!den) return "–";
  return `${Math.round((num / den) * 100)}%`;
}

function fmtDur(mmss: number): string {
  const m = Math.trunc(mmss);
  const s = Math.round((mmss - m) * 100);
  if (m >= 60) {
    const h = Math.trunc(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m ${s}s`;
  }
  return `${m}m ${s}s`;
}

function relTime(iso: string): string {
  if (!iso) return "never";
  const now = Date.now();
  const then = new Date(iso).getTime();
  const sec = Math.max(0, Math.floor((now - then) / 1000));
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const h = Math.floor(min / 60);
  return `${h}h ${min % 60}m ago`;
}

export default function DashboardPage() {
  const [snap, setSnap] = useState<Snapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [live, setLive] = useState(true);

  const [date, setDate] = useState<string>(londonDateIso());
  const [targets, setTargets] = useState<string[]>([]);
  const [selectedTarget, setSelectedTarget] = useState<string>("");

  const loadLatest = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch("/api/snapshot", { cache: "no-store" });
      if (r.status === 404) {
        setSnap(null);
        setErr("No snapshot available yet. Click Refresh to trigger one.");
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Snapshot;
      setSnap(j);
      setDate(j.date);
      setSelectedTarget(j.target);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  const loadTargets = useCallback(async (d: string) => {
    try {
      const r = await fetch(`/api/snapshots?date=${d}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as { targets: string[] };
      setTargets(j.targets || []);
    } catch {
      setTargets([]);
    }
  }, []);

  const loadSpecific = useCallback(async (d: string, t: string) => {
    setLoading(true); setErr(null);
    try {
      const r = await fetch(`/api/snapshot?date=${d}&target=${encodeURIComponent(t)}`, { cache: "no-store" });
      if (r.status === 404) {
        setSnap(null);
        setErr(`No snapshot found for ${d} ${t}`);
        return;
      }
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Snapshot;
      setSnap(j);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally { setLoading(false); }
  }, []);

  useEffect(() => { loadLatest(); }, [loadLatest]);
  useEffect(() => { loadTargets(date); }, [date, loadTargets]);

  // Auto-refresh when Live is on and we're viewing today's latest.
  useEffect(() => {
    if (!live) return;
    const isViewingLatest = !selectedTarget || (snap && snap.date === date && snap.target === selectedTarget);
    if (!isViewingLatest) return;
    const id = setInterval(() => {
      loadLatest();
      loadTargets(date);
    }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [live, date, selectedTarget, snap, loadLatest, loadTargets]);

  async function refreshNow() {
    setRefreshing(true); setErr(null);
    try {
      const r = await fetch("/api/refresh", { method: "POST" });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${r.status}`);
      }
      // Wait a bit for the workflow to run, then refresh.
      setTimeout(() => { loadLatest(); loadTargets(date); setRefreshing(false); }, 90_000);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "refresh failed");
      setRefreshing(false);
    }
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    location.href = "/login";
  }

  const lastRefreshedLabel = useMemo(() => snap ? relTime(snap.capturedAt) : "–", [snap]);
  const nextScheduled = useMemo(() => {
    const targetsMin = [11*60, 12*60+30, 15*60+30, 17*60, 20*60];
    const fmt = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
    const parts = fmt.formatToParts(new Date());
    const h = Number(parts.find(p => p.type === "hour")?.value ?? 0);
    const m = Number(parts.find(p => p.type === "minute")?.value ?? 0);
    const nowMin = h*60 + m;
    const next = targetsMin.find(tm => tm > nowMin);
    if (next === undefined) return "tomorrow 11:00";
    return `${String(Math.floor(next/60)).padStart(2,"0")}:${String(next%60).padStart(2,"0")}`;
  }, []);

  if (loading && !snap) return <main className="p-8 text-slate-500">Loading dashboard…</main>;

  return (
    <main className="max-w-[1400px] mx-auto p-4 md:p-6 space-y-4">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold">POST IT Live Dashboard</h1>
          <p className="text-sm text-slate-500">
            {snap
              ? <>Showing <strong>{snap.date} {snap.target}</strong> &middot; captured {lastRefreshedLabel} &middot; next scheduled {nextScheduled}</>
              : "No snapshot loaded yet"}
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm flex items-center gap-2">
            <span className="text-slate-600">Date:</span>
            <input
              type="date" value={date}
              max={londonDateIso()}
              onChange={(e) => { setDate(e.target.value); setSelectedTarget(""); }}
              className="border border-slate-300 rounded px-2 py-1"
            />
          </label>
          {targets.length > 0 && (
            <label className="text-sm flex items-center gap-2">
              <span className="text-slate-600">Time:</span>
              <select
                className="border border-slate-300 rounded px-2 py-1"
                value={selectedTarget}
                onChange={(e) => { setSelectedTarget(e.target.value); loadSpecific(date, e.target.value); }}
              >
                <option value="">— pick —</option>
                {targets.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
          )}
          <button
            onClick={() => { setDate(londonDateIso()); setSelectedTarget(""); loadLatest(); }}
            className="text-sm text-slate-500 hover:text-slate-700 underline"
          >
            Jump to latest
          </button>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={live} onChange={(e) => setLive(e.target.checked)} />
            <span>Live (auto-refresh 5 min)</span>
          </label>
          <button
            onClick={refreshNow}
            disabled={refreshing}
            className="bg-slate-900 text-white rounded px-3 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
            title="Trigger a fresh scrape now (takes ~90 seconds)"
          >
            {refreshing ? "Refreshing… (~90s)" : "Refresh now"}
          </button>
          <a href="/" className="text-sm text-slate-500 hover:text-slate-700 underline">
            Admin
          </a>
          <button onClick={logout} className="text-sm text-slate-500 hover:text-slate-700">
            Sign out
          </button>
        </div>
      </header>

      {err && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 rounded p-3 text-sm">
          {err}
        </div>
      )}

      {snap && (
        <>
          <AdviserSection title="Daily" dateLabel={snap.date + " " + snap.target} auto={snap.daily_auto} manual={snap.daily_manual} />
          <AdviserSection title="Weekly Total" dateLabel={`week of ${snap.date}`} auto={snap.weekly_auto} manual={snap.weekly_manual} />

          <RicSection
            daily_auto={snap.ric_daily_auto}
            manual={snap.ric_manual}
            comments={snap.ric_comments}
          />

          <AuditSection snap={snap} />
        </>
      )}
    </main>
  );
}

function AdviserSection({ title, dateLabel, auto, manual }: {
  title: string;
  dateLabel: string;
  auto: Record<string, { talk_time_mmss: number; total_calls: number; hellos: number }>;
  manual: Record<string, Record<string, number>>;
}) {
  const rows = ADVISERS.map(a => {
    const am = manual?.[a] || {};
    const aa = auto?.[a] || { talk_time_mmss: 0, total_calls: 0, hellos: 0 };
    return { name: a, ...aa, manual: am };
  });
  const totals = rows.reduce((acc, r) => ({
    talk: acc.talk + Math.trunc(r.talk_time_mmss)*60 + Math.round((r.talk_time_mmss - Math.trunc(r.talk_time_mmss))*100),
    calls: acc.calls + r.total_calls,
    hellos: acc.hellos + r.hellos,
    ucf: acc.ucf + (r.manual.UCF || 0),
    cf: acc.cf + (r.manual.CF || 0),
    orph: acc.orph + (r.manual.ORPHANS || 0),
    tq: acc.tq + (r.manual.TQ_Comp || 0),
    ff: acc.ff + (r.manual.Fact_Find || 0),
    q: acc.q + (r.manual.Quotes || 0),
    c: acc.c + (r.manual.Closes || 0),
    dec: acc.dec + (r.manual.Declines || 0),
    post: acc.post + (r.manual.Postpones || 0),
    acc_: acc.acc_ + (r.manual.Acc || 0),
    ref: acc.ref + (r.manual.Ref || 0),
  }), { talk: 0, calls: 0, hellos: 0, ucf: 0, cf: 0, orph: 0, tq: 0, ff: 0, q: 0, c: 0, dec: 0, post: 0, acc_: 0, ref: 0 });

  const totalTalkMmss = (() => {
    const m = Math.floor(totals.talk / 60);
    const s = totals.talk % 60;
    return Number(`${m}.${String(s).padStart(2,"0")}`);
  })();

  return (
    <section className="bg-white shadow rounded-lg overflow-x-auto">
      <h2 className="text-lg font-medium p-4 border-b">{title} <span className="text-sm text-slate-500 font-normal">({dateLabel})</span></h2>
      <table className="text-sm w-full border-separate border-spacing-0">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-3 py-2 border-b">Adviser</th>
            <th className="text-right px-2 py-2 border-b">UCF</th>
            <th className="text-right px-2 py-2 border-b">CF</th>
            <th className="text-right px-2 py-2 border-b">ORPHANS</th>
            <th className="text-right px-2 py-2 border-b">TQ&nbsp;Comp</th>
            <th className="text-right px-2 py-2 border-b bg-pink-100">Talk&nbsp;Time</th>
            <th className="text-right px-2 py-2 border-b bg-pink-100">Calls</th>
            <th className="text-right px-2 py-2 border-b bg-amber-100">Hello's</th>
            <th className="text-right px-2 py-2 border-b">Fact&nbsp;Find</th>
            <th className="text-right px-2 py-2 border-b">FF&nbsp;/&nbsp;Hello</th>
            <th className="text-right px-2 py-2 border-b">Quotes</th>
            <th className="text-right px-2 py-2 border-b">Q&nbsp;/&nbsp;Hello</th>
            <th className="text-right px-2 py-2 border-b">Closes</th>
            <th className="text-right px-2 py-2 border-b">C&nbsp;/&nbsp;Hello</th>
            <th className="text-right px-2 py-2 border-b">Decl</th>
            <th className="text-right px-2 py-2 border-b">Post</th>
            <th className="text-right px-2 py-2 border-b">Acc</th>
            <th className="text-right px-2 py-2 border-b">Ref</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, idx) => (
            <tr key={r.name} className={idx % 2 ? "bg-slate-50" : ""}>
              <td className="px-3 py-2 font-medium">{r.name}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.UCF ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.CF ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.ORPHANS ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.TQ_Comp ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums bg-pink-50">{fmtDur(r.talk_time_mmss)}</td>
              <td className="px-2 py-2 text-right tabular-nums bg-pink-50">{r.total_calls}</td>
              <td className="px-2 py-2 text-right tabular-nums bg-amber-50">{r.hellos}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Fact_Find ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-500">{pct(r.manual.Fact_Find || 0, r.hellos)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Quotes ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-500">{pct(r.manual.Quotes || 0, r.hellos)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Closes ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums text-slate-500">{pct(r.manual.Closes || 0, r.hellos)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Declines ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Postpones ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Acc ?? 0}</td>
              <td className="px-2 py-2 text-right tabular-nums">{r.manual.Ref ?? 0}</td>
            </tr>
          ))}
          <tr className="bg-rose-100 font-semibold">
            <td className="px-3 py-2">Office Totals</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.ucf}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.cf}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.orph}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.tq}</td>
            <td className="px-2 py-2 text-right tabular-nums">{fmtDur(totalTalkMmss)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.calls}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.hellos}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.ff}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pct(totals.ff, totals.hellos)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.q}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pct(totals.q, totals.hellos)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.c}</td>
            <td className="px-2 py-2 text-right tabular-nums">{pct(totals.c, totals.hellos)}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.dec}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.post}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.acc_}</td>
            <td className="px-2 py-2 text-right tabular-nums">{totals.ref}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function RicSection({ daily_auto, manual, comments }: {
  daily_auto: { talk_time_mmss: number; total_calls: number; hellos: number };
  manual: Record<string, number>;
  comments: string;
}) {
  return (
    <section className="bg-white shadow rounded-lg">
      <h2 className="text-lg font-medium p-4 border-b">Customer Service — Ric</h2>
      <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 text-sm">
        <Stat label="Talk Time" value={fmtDur(daily_auto.talk_time_mmss)} />
        <Stat label="No. Calls" value={String(daily_auto.total_calls)} />
        {RIC_FIELDS.map(f => (
          <Stat key={f.key} label={f.label} value={String(manual?.[f.key] ?? 0)} />
        ))}
      </div>
      {comments && (
        <div className="px-4 pb-4 text-sm">
          <span className="text-slate-500">Comments: </span>
          <span>{comments}</span>
        </div>
      )}
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="border border-slate-200 rounded p-2">
      <div className="text-slate-500 text-xs">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function AuditSection({ snap }: { snap: Snapshot }) {
  return (
    <details className="bg-white shadow rounded-lg">
      <summary className="cursor-pointer p-4 text-sm font-medium">Audit — source breakdown per adviser</summary>
      <div className="px-4 pb-4 overflow-x-auto">
        <table className="text-xs border-separate border-spacing-0">
          <thead>
            <tr className="text-slate-500">
              <th className="text-left px-3 py-1">Adviser</th>
              <th className="text-left px-3 py-1">Clearvolt</th>
              <th className="text-left px-3 py-1">CloudTalk (display)</th>
              <th className="text-right px-3 py-1">Clearvolt Talk</th>
              <th className="text-right px-3 py-1">CT Talk</th>
              <th className="text-right px-3 py-1">Clearvolt Calls</th>
              <th className="text-right px-3 py-1">CT Calls</th>
              <th className="text-right px-3 py-1">Clearvolt Hellos</th>
              <th className="text-right px-3 py-1">CT Hellos</th>
            </tr>
          </thead>
          <tbody>
            {ADVISERS.map(a => {
              const cv = snap.clearvolt_sources?.[a];
              const ct = snap.cloudtalk_sources?.[a];
              return (
                <tr key={a}>
                  <td className="px-3 py-1 font-medium">{a}</td>
                  <td className="px-3 py-1 text-slate-500">{cv?.display || "—"}</td>
                  <td className="px-3 py-1 text-slate-500">{ct?.display || "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{cv ? fmtSeconds(cv.talk_seconds) : "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{ct ? fmtSeconds(ct.talk_seconds) : "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{cv?.total_calls ?? "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{ct?.total_calls ?? "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{cv?.hellos ?? "—"}</td>
                  <td className="px-3 py-1 text-right tabular-nums">{ct?.hellos ?? "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {snap.cloudtalk_unmapped.length > 0 && (
          <p className="mt-3 text-xs text-slate-500">
            CloudTalk agents not mapped: {snap.cloudtalk_unmapped.join(", ")}
          </p>
        )}
        <p className="mt-2 text-xs text-slate-500">
          Portal manual last saved: {snap.portal_updated_at || "never"}{snap.portal_updated_by ? ` by ${snap.portal_updated_by}` : ""}
        </p>
      </div>
    </details>
  );
}

function fmtSeconds(s: number): string {
  const m = Math.floor(s / 60);
  const ss = s % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    const mm = m % 60;
    return `${h}h ${mm}m ${ss}s`;
  }
  return `${m}m ${ss}s`;
}
