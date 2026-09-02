"use client";

/**
 * Confirmation Planner (Poz, 2 Sep 2026).
 *
 * Auto-generated from the Reci's deal records: the week's confirmed
 * deals grouped by confirmation day, building cumulatively Monday to
 * Friday exactly like Poz's typed planner, with daily and weekly
 * totals, Acc/Ref counts, per-CAM stats, the booked-per-Post-it vs
 * confirmed line, and the £ sitting in Checked status. Printed each
 * evening for Guy; Friday's print reconciles with the Business Tracker
 * because both read the same records.
 */
import { useCallback, useEffect, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";

interface PlannerDeal {
  id: number; adviser_id: number; adviser_name: string;
  client: string; acc_ref: string | null; no_of_deals: number;
  policy_type: string | null; provider: string | null;
  booked_date: string | null; premium: number | null;
  commission: number; resell_cb: number; net: number;
  position: string; confirmedOn: string;
}
interface Totals { deals: number; comm: number; cb: number; net: number; acc: number; ref: number }
interface CamCell { deals: number; comm: number }
interface DayBlock {
  date: string;
  deals: PlannerDeal[];
  daily: Totals & { cam: Record<number, CamCell> };
  cumulative: Totals & { cam: Record<number, CamCell> };
  postItBooked: { byName: Record<string, number>; total: number };
}
interface Resp {
  year: number; week: number; weekStart: string;
  sellers: { id: number; name: string }[];
  days: DayBlock[];
  weekTotals: Totals & { checked: { n: number; net: number } };
}

function gbp(n: number): string {
  return Number(n || 0).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function fmtDay(iso: string): string {
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "numeric" });
}
function fmtShort(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso + "T12:00:00Z").toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
}

export default function ConfirmationPlannerPage() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [week, setWeek] = useState<number | null>(null); // null = server default (current)
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    try {
      const p = new URLSearchParams({ year: String(year) });
      if (week) p.set("week", String(week));
      const r = await fetch(`/api/reci/confirmations?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as Resp;
      setData(j);
      if (!week) setWeek(j.week);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [year, week]);
  useEffect(() => { void load(); }, [load]);

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="no-print border-b bg-white">
        <div className="mx-auto flex max-w-[1500px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">Confirmation Planner</h1>
            {data && <span className="text-sm text-slate-500">Week {data.week} · {data.year}</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Year</span>
              <input type="number" value={year}
                onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
                className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
            </label>
            <label className="flex items-center gap-1">
              <span className="text-slate-600">Week</span>
              <input type="number" min={1} max={53} value={week ?? ""}
                onChange={(e) => setWeek(Math.max(1, Math.min(53, Number(e.target.value) || 1)))}
                className="w-16 rounded border border-slate-300 px-2 py-1 text-right" />
            </label>
            <PrintButton />
          </div>
        </div>
        {err && <div className="mx-auto max-w-[1500px] px-4 pb-2 text-xs text-red-600">{err}</div>}
      </header>

      <main className="mx-auto max-w-[1500px] space-y-4 px-4 py-4">
        <PrintHeader
          title="Confirmation Planner"
          subtitle={data ? `Week ${data.week} · ${data.year}` : ""}
          meta={data ? [
            { label: "Week", value: `${data.week} (w/c ${fmtShort(data.weekStart)})` },
            { label: "Total CAM deals", value: String(data.weekTotals.deals) },
            { label: "Total CAM income (net)", value: gbp(data.weekTotals.net) },
          ] : []}
        />

        {!data ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">Loading…</div>
        ) : (
          <>
            {/* WEEK TOTALS banner */}
            <section className="rounded-lg border-2 border-slate-400 bg-slate-900 p-4 text-white shadow-sm print-keep">
              <div className="mb-2 text-xs font-bold uppercase tracking-wide">Week {data.week} totals</div>
              <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3 md:grid-cols-6">
                <div><div className="text-xs text-slate-400">Total CAM deals</div><div className="text-xl font-semibold tabular-nums">{data.weekTotals.deals}</div></div>
                <div><div className="text-xs text-slate-400">Total CAM income (net)</div><div className="text-xl font-semibold tabular-nums">{gbp(data.weekTotals.net)}</div></div>
                <div><div className="text-xs text-slate-400">Commission (gross)</div><div className="text-lg font-semibold tabular-nums">{gbp(data.weekTotals.comm)}</div></div>
                <div><div className="text-xs text-slate-400">CB on resells</div><div className="text-lg font-semibold tabular-nums">{data.weekTotals.cb > 0 ? gbp(data.weekTotals.cb) : "—"}</div></div>
                <div><div className="text-xs text-slate-400">Accepted / Referred</div><div className="text-lg font-semibold tabular-nums">{data.weekTotals.acc} / {data.weekTotals.ref}</div></div>
                <div><div className="text-xs text-slate-400">In Checked status</div><div className="text-lg font-semibold tabular-nums">{data.weekTotals.checked.n > 0 ? `${data.weekTotals.checked.n} · ${gbp(data.weekTotals.checked.net)}` : "—"}</div></div>
              </div>
            </section>

            {data.days.map((day) => (
              <section key={day.date} className="rounded-lg border bg-white shadow-sm print-keep">
                <div className="flex flex-wrap items-baseline justify-between gap-2 border-b bg-slate-100 px-4 py-2">
                  <h2 className="text-sm font-semibold text-slate-800">{fmtDay(day.date)}</h2>
                  <span className="text-xs text-slate-600">
                    Booked per Post-it: <strong>{day.postItBooked.total}</strong>
                    {" · "}Confirmed: <strong>{day.deals.length}</strong>
                    {" · "}Acc {day.daily.acc} / Ref {day.daily.ref}
                  </span>
                </div>

                {day.deals.length === 0 ? (
                  <div className="px-4 py-3 text-sm text-slate-400">No confirmations.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                        <tr>
                          <th className="px-3 py-1.5 text-left">CAM</th>
                          <th className="px-3 py-1.5 text-left">Client</th>
                          <th className="px-3 py-1.5 text-left">Acc/Ref</th>
                          <th className="px-3 py-1.5 text-right">Deals</th>
                          <th className="px-3 py-1.5 text-left">Policy type</th>
                          <th className="px-3 py-1.5 text-left">Provider</th>
                          <th className="px-3 py-1.5 text-left">Booked</th>
                          <th className="px-3 py-1.5 text-right">Premium £</th>
                          <th className="px-3 py-1.5 text-right">Comm £</th>
                          <th className="px-3 py-1.5 text-right">CB £</th>
                          <th className="px-3 py-1.5 text-right">Net £</th>
                          <th className="px-3 py-1.5 text-left">Position</th>
                        </tr>
                      </thead>
                      <tbody>
                        {day.deals.map((d) => (
                          <tr key={d.id} className="border-t border-slate-100">
                            <td className="px-3 py-1.5 font-medium">{d.adviser_name}</td>
                            <td className="px-3 py-1.5">{d.client}</td>
                            <td className="px-3 py-1.5">{d.acc_ref || "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.no_of_deals}</td>
                            <td className="px-3 py-1.5">{d.policy_type || "—"}</td>
                            <td className="px-3 py-1.5">{d.provider || "—"}</td>
                            <td className="px-3 py-1.5">{fmtShort(d.booked_date)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.premium != null ? d.premium.toFixed(2) : "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{gbp(d.commission)}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums">{d.resell_cb > 0 ? gbp(d.resell_cb) : "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular-nums font-medium">{gbp(d.net)}</td>
                            <td className="px-3 py-1.5">
                              <span className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                                d.position === "Checked" ? "bg-amber-100 text-amber-800" :
                                d.position === "Paid" ? "bg-emerald-100 text-emerald-800" :
                                d.position === "On Risk NYP" ? "bg-violet-100 text-violet-800" :
                                d.position.startsWith("In Processing") ? "bg-blue-100 text-blue-800" :
                                d.position === "Cancelled" || d.position === "Clawback" ? "bg-red-100 text-red-800" :
                                "bg-slate-100 text-slate-700"
                              }`}>{d.position}</span>
                            </td>
                          </tr>
                        ))}
                        <tr className="border-t-2 border-slate-300 bg-amber-50 font-semibold">
                          <td className="px-3 py-1.5" colSpan={3}>Daily total</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{day.daily.deals}</td>
                          <td colSpan={4} />
                          <td className="px-3 py-1.5 text-right tabular-nums">{gbp(day.daily.comm)}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{day.daily.cb > 0 ? gbp(day.daily.cb) : "—"}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{gbp(day.daily.net)}</td>
                          <td />
                        </tr>
                        <tr className="bg-slate-100 text-xs font-semibold text-slate-600">
                          <td className="px-3 py-1" colSpan={3}>Weekly cumulative</td>
                          <td className="px-3 py-1 text-right tabular-nums">{day.cumulative.deals}</td>
                          <td colSpan={4} />
                          <td className="px-3 py-1 text-right tabular-nums">{gbp(day.cumulative.comm)}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{day.cumulative.cb > 0 ? gbp(day.cumulative.cb) : "—"}</td>
                          <td className="px-3 py-1 text-right tabular-nums">{gbp(day.cumulative.net)}</td>
                          <td />
                        </tr>
                      </tbody>
                    </table>
                  </div>
                )}

                {/* CAM stats grid */}
                <div className="border-t border-slate-200 px-4 py-2">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-slate-500">
                        <th className="py-1 text-left font-medium uppercase tracking-wide">Cam stats</th>
                        {data.sellers.map((s) => <th key={s.id} className="py-1 text-right font-medium">{s.name}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="py-0.5 text-slate-500">Deals today</td>
                        {data.sellers.map((s) => (
                          <td key={s.id} className={`py-0.5 text-right tabular-nums ${day.daily.cam[s.id]?.deals ? "font-semibold" : "text-slate-300"}`}>
                            {day.daily.cam[s.id]?.deals ?? 0}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Comms today (net)</td>
                        {data.sellers.map((s) => (
                          <td key={s.id} className={`py-0.5 text-right tabular-nums ${day.daily.cam[s.id]?.comm ? "" : "text-slate-300"}`}>
                            {day.daily.cam[s.id]?.comm ? gbp(day.daily.cam[s.id].comm) : "—"}
                          </td>
                        ))}
                      </tr>
                      <tr className="border-t border-slate-100">
                        <td className="py-0.5 text-slate-500">Deals week to date</td>
                        {data.sellers.map((s) => (
                          <td key={s.id} className={`py-0.5 text-right tabular-nums ${day.cumulative.cam[s.id]?.deals ? "font-semibold" : "text-slate-300"}`}>
                            {day.cumulative.cam[s.id]?.deals ?? 0}
                          </td>
                        ))}
                      </tr>
                      <tr>
                        <td className="py-0.5 text-slate-500">Comms week to date (net)</td>
                        {data.sellers.map((s) => (
                          <td key={s.id} className={`py-0.5 text-right tabular-nums ${day.cumulative.cam[s.id]?.comm ? "" : "text-slate-300"}`}>
                            {day.cumulative.cam[s.id]?.comm ? gbp(day.cumulative.cam[s.id].comm) : "—"}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          </>
        )}
      </main>
    </div>
  );
}
