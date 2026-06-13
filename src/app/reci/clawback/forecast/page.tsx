"use client";

/**
 * Clawback Forecast.
 *
 * Forward-looking management view (built for Guy + Poz). Three blocks:
 *
 *   1. KPI tiles: this month forecast £, next month forecast £, MTD
 *      saved £, YTD saved £, total net at risk £, open cases count.
 *
 *   2. 12-month forecast table -- one section per month, per-seller
 *      Gross / Saved / Net columns plus a month total. Layout mirrors
 *      the Reports page so the visual rhythm is familiar.
 *
 *   3. Top 10 imminent cases -- highest net exposure due in the next
 *      30 days. Clicking a row deep-links to the case in the dashboard
 *      (drawer state isn't carried; clicking opens the dashboard with
 *      a search prefilled to the policy number).
 *
 * Scoped sellers see only their own forecast. Admins / Guy see everyone.
 */
import { useCallback, useEffect, useState } from "react";
import { PrintButton, PrintHeader } from "@/components/print";

interface SellerForecast {
  key: string;
  adviser_id: number | null;
  gross: number;
  saved: number;
  resold: number;
  net: number;
  cases: number;
}
interface MonthForecast {
  key: string;
  label: string;
  start: string;
  end: string;
  sellers: SellerForecast[];
  totals: { gross: number; saved: number; resold: number; net: number; cases: number };
}
interface Kpis {
  currentMonthForecast: number;
  nextMonthForecast: number;
  mtdSaved: number;
  ytdSaved: number;
  totalNetAtRisk: number;
  openCases: number;
}
interface ImminentCase {
  id: number;
  client_name: string;
  policy_number: string;
  postcode: string | null;
  adviser_name: string | null;
  agent_bucket: string;
  ebah_warning: string | null;
  clawback_date: string | null;
  net_at_risk: number;
  status: string;
}
interface ForecastResp {
  today: string;
  scoped: boolean;
  kpis: Kpis;
  months: MonthForecast[];
  imminentCases: ImminentCase[];
}

function gbp(n: number): string {
  return n.toLocaleString("en-GB", {
    style: "currency", currency: "GBP",
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

export default function ClawbackForecastPage() {
  const [data, setData] = useState<ForecastResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await fetch("/api/reci/clawback/forecast", { cache: "no-store" });
      if (!r.ok) throw new Error(`fetch failed (${r.status})`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <main className="mx-auto max-w-[1600px] px-4 py-4">
      <PrintHeader
        title="Clawback Forecast"
        subtitle={data?.today ? `Generated ${new Date(data.today).toLocaleDateString("en-GB")}` : ""}
        meta={data ? [
          { label: "This month",  value: gbp(data.kpis.currentMonthForecast) },
          { label: "Next month",  value: gbp(data.kpis.nextMonthForecast) },
          { label: "MTD saved",   value: gbp(data.kpis.mtdSaved) },
          { label: "YTD saved",   value: gbp(data.kpis.ytdSaved) },
          { label: "Net at risk", value: gbp(data.kpis.totalNetAtRisk) },
          { label: "Open cases",  value: String(data.kpis.openCases) },
        ] : []}
      />

      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold">Clawback Forecast</h1>
          <div className="text-sm text-slate-600">
            Forward view of clawback exposure by CB charge date, plus saved velocity.
          </div>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/reci/clawback"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Dashboard
          </a>
          <a
            href="/reci/clawback/reports"
            className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100"
          >
            Reports
          </a>
          <PrintButton />
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
          Failed to load: {error}
        </div>
      )}

      {loading ? (
        <div className="mt-6 text-center text-slate-400">Loading...</div>
      ) : !data ? null : (
        <>
          {/* KPI tiles */}
          <section className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
            <Tile label="This month forecast"  value={gbp(data.kpis.currentMonthForecast)} accent="amber" />
            <Tile label="Next month forecast"  value={gbp(data.kpis.nextMonthForecast)} accent="amber" />
            <Tile label="MTD saved"            value={gbp(data.kpis.mtdSaved)} accent="green" />
            <Tile label="YTD saved"            value={gbp(data.kpis.ytdSaved)} accent="green" />
            <Tile label="Total net at risk"    value={gbp(data.kpis.totalNetAtRisk)} accent="amber" />
            <Tile label="Open cases"           value={String(data.kpis.openCases)} />
          </section>

          {/* Imminent cases */}
          {data.imminentCases.length > 0 && (
            <section className="mt-6">
              <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
                Top 10 imminent cases (next 30 days)
              </h2>
              <div className="overflow-x-auto rounded border border-slate-200 bg-white">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
                    <tr>
                      <Th>CB date</Th>
                      <Th>Seller</Th>
                      <Th>Client</Th>
                      <Th>Postcode</Th>
                      <Th>Policy No</Th>
                      <Th>Warning</Th>
                      <Th>Status</Th>
                      <Th right>Net at risk £</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.imminentCases.map((c) => (
                      <tr key={c.id} className="border-t border-slate-100 hover:bg-amber-50">
                        <Td>{c.clawback_date || "—"}</Td>
                        <Td>{c.adviser_name || (c.agent_bucket === "xstaff" ? "Xstaff" : c.agent_bucket)}</Td>
                        <Td>{c.client_name}</Td>
                        <Td>{c.postcode || "—"}</Td>
                        <Td><code className="text-xs">{c.policy_number}</code></Td>
                        <Td>{c.ebah_warning || "—"}</Td>
                        <Td className="capitalize">{c.status}</Td>
                        <Td right className="font-medium">{gbp(c.net_at_risk)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Per-month forecast */}
          <h2 className="mt-8 mb-2 text-sm font-semibold uppercase tracking-wide text-slate-600">
            12-month forecast (CB charge date driven)
          </h2>
          {data.months.map((m) => (
            <MonthBlock key={m.key} month={m} />
          ))}
        </>
      )}
    </main>
  );
}

function MonthBlock({ month }: { month: MonthForecast }) {
  const empty = month.totals.cases === 0;
  return (
    <section className={`mt-3 break-inside-avoid rounded border ${empty ? "border-slate-200 bg-slate-50" : "border-slate-200 bg-white"}`}>
      <div className="flex items-baseline justify-between gap-3 border-b border-slate-200 bg-slate-50 px-4 py-2">
        <h3 className="text-sm font-semibold">{month.label}</h3>
        <span className="text-xs text-slate-500">
          {month.start} → {month.end}
          {empty && <span className="ml-2 italic">no cases in view</span>}
        </span>
      </div>
      {!empty && (
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2 text-left font-medium">Seller</th>
              <th className="px-3 py-2 text-right font-medium">Cases</th>
              <th className="px-3 py-2 text-right font-medium">Gross issued £</th>
              <th className="px-3 py-2 text-right font-medium">Saved £</th>
              <th className="px-3 py-2 text-right font-medium">Resold £</th>
              <th className="px-3 py-2 text-right font-medium">Net at risk £</th>
            </tr>
          </thead>
          <tbody>
            {month.sellers.map((s) => (
              <tr key={s.key} className="border-t border-slate-100">
                <td className="px-3 py-2 font-medium">{s.key}</td>
                <td className="px-3 py-2 text-right">{s.cases}</td>
                <td className="px-3 py-2 text-right">{gbp(s.gross)}</td>
                <td className="px-3 py-2 text-right text-emerald-700">{s.saved > 0 ? gbp(s.saved) : "—"}</td>
                <td className="px-3 py-2 text-right text-blue-700">{s.resold > 0 ? gbp(s.resold) : "—"}</td>
                <td className="px-3 py-2 text-right font-medium">{gbp(s.net)}</td>
              </tr>
            ))}
            <tr className="border-t-2 border-slate-300 bg-amber-50 font-semibold">
              <td className="px-3 py-2">Month total</td>
              <td className="px-3 py-2 text-right">{month.totals.cases}</td>
              <td className="px-3 py-2 text-right">{gbp(month.totals.gross)}</td>
              <td className="px-3 py-2 text-right text-emerald-700">{gbp(month.totals.saved)}</td>
              <td className="px-3 py-2 text-right text-blue-700">{gbp(month.totals.resold)}</td>
              <td className="px-3 py-2 text-right">{gbp(month.totals.net)}</td>
            </tr>
          </tbody>
        </table>
      )}
    </section>
  );
}

function Tile({ label, value, accent }: { label: string; value: string; accent?: "green" | "amber" }) {
  const color =
    accent === "green" ? "border-emerald-200 bg-emerald-50" :
    accent === "amber" ? "border-amber-200 bg-amber-50" :
    "border-slate-200 bg-white";
  return (
    <div className={`rounded border p-3 ${color}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold">{value}</div>
    </div>
  );
}

function Th({ children, right }: { children: React.ReactNode; right?: boolean }) {
  return <th className={`px-3 py-2 ${right ? "text-right" : "text-left"} font-medium`}>{children}</th>;
}
function Td({ children, right, className }: { children: React.ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-3 py-2 ${right ? "text-right" : ""} ${className || ""}`}>{children}</td>;
}
