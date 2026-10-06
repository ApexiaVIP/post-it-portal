"use client";

/**
 * QA dashboard (7 Oct 2026): adviser scorecards and business MI from
 * Call QA. Every score is built from reviewer-confirmed results, never
 * raw AI output, and the AI's agreement with reviewers is shown as its
 * measured accuracy.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";

interface Score {
  adviser_id: number | null; name: string;
  cases: number; reviewed: number; awaiting: number;
  outcomes: Record<string, number>;
  form_pass: number; form_fail: number; mandatory_fails: number;
  disc_full: number; disc_total: number;
  report_ok: number; report_total: number;
}
interface Counts { agree: number; disagree: number; resolved: number }
interface Dash {
  range: { from: string; to: string; adviser_id: number | null };
  adviser_order: { id: number; name: string }[];
  team: Score;
  advisers: Score[];
  trend: { month: string; rates: Record<string, number | null> }[];
  failed_standards: { ref: string | null; label: string; mandatory: boolean; fails: number; total: number }[];
  missed_disclosures: { label: string; missing: number; partial: number; total: number }[];
  ai_accuracy: {
    overall: Counts;
    by_section: Record<string, Counts>;
    most_disagreed: { section: string; ref: string | null; label: string; agree: number; disagree: number }[];
  };
  flags: { vulnerability_cases: number; replacement_cases: number };
  coverage: { adviser_id: number; name: string; total: number; checked: number }[];
}

// Reference categorical palette, light mode, fixed order (validated: all
// checks pass; three slots sit below 3:1 contrast, relieved by the table).
const SERIES = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#4a3aa7", "#e34948"];
const SECTION_LABELS: Record<string, string> = {
  observation: "Openwork form", disclosure: "Disclosures", suitability: "Suitability report",
};

function pct(n: number, d: number): string {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "—";
}
function monthLabel(m: string): string {
  const [y, mm] = m.split("-").map(Number);
  return new Date(Date.UTC(y, mm - 1, 1)).toLocaleDateString("en-GB", { month: "short", year: "2-digit", timeZone: "UTC" });
}
function startOfYear(): string {
  return `${new Date().getFullYear()}-01-01`;
}

export default function QaDashboardPage() {
  const [from, setFrom] = useState(startOfYear());
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));
  const [adviserId, setAdviserId] = useState("");
  const [data, setData] = useState<Dash | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setErr(null);
    const qs = new URLSearchParams({ from, to });
    if (adviserId) qs.set("adviser_id", adviserId);
    try {
      const r = await fetch(`/api/qa/dashboard?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to Call QA." : `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [from, to, adviserId]);
  useEffect(() => { void load(); }, [load]);

  const colourOf = useMemo(() => {
    const m = new Map<string, string>();
    (data?.adviser_order ?? []).forEach((a, i) => m.set(a.name, SERIES[i % SERIES.length]));
    return (name: string) => m.get(name) ?? "#8a8986";
  }, [data?.adviser_order]);

  const trendRows = useMemo(() => (data?.trend ?? []).map((t) => {
    const row: Record<string, string | number | null> = { month: monthLabel(t.month) };
    for (const [who, rate] of Object.entries(t.rates)) row[who] = rate === null ? null : Math.round(rate * 1000) / 10;
    return row;
  }), [data?.trend]);
  const trendNames = useMemo(() => {
    const names = new Set<string>();
    for (const t of data?.trend ?? []) for (const who of Object.keys(t.rates)) if (who !== "Team") names.add(who);
    const order = (data?.adviser_order ?? []).map((a) => a.name);
    return Array.from(names).sort((a, b) => order.indexOf(a) - order.indexOf(b));
  }, [data?.trend, data?.adviser_order]);

  const t = data?.team;
  const acc = data?.ai_accuracy.overall;
  const covTotal = (data?.coverage ?? []).reduce((n, c) => n + c.total, 0);
  const covChecked = (data?.coverage ?? []).reduce((n, c) => n + c.checked, 0);
  const noConfirmed = !!t && t.form_pass + t.form_fail + t.disc_total + t.report_total === 0;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <div className="text-sm text-slate-500"><Link href="/qa" className="hover:underline">Call QA</Link> / dashboard</div>
          <h1 className="text-2xl font-bold">QA dashboard</h1>
          <p className="text-sm text-slate-600">Scores use reviewer-confirmed results only.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2 text-sm">
          <label><span className="block text-xs text-slate-600">From</span>
            <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className="rounded border px-2 py-1" /></label>
          <label><span className="block text-xs text-slate-600">To</span>
            <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className="rounded border px-2 py-1" /></label>
          <label><span className="block text-xs text-slate-600">Adviser</span>
            <select value={adviserId} onChange={(e) => setAdviserId(e.target.value)} className="rounded border px-2 py-1">
              <option value="">All advisers</option>
              {(data?.adviser_order ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select></label>
          <button type="button" onClick={() => window.print()} className="no-print rounded border border-slate-300 px-3 py-1 hover:bg-slate-50">Print</button>
        </div>
      </div>

      {err && <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{err}</p>}
      {!data && !err && <p className="mt-6 text-sm text-slate-500">Loading…</p>}

      {data && t && acc && (
        <>
          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            <Tile label="Openwork form pass rate" value={pct(t.form_pass, t.form_pass + t.form_fail)} sub={`${t.form_fail} fails, ${t.mandatory_fails} on starred standards`} />
            <Tile label="Disclosures delivered in full" value={pct(t.disc_full, t.disc_total)} sub={`${t.disc_total} checked`} />
            <Tile label="Cases checked" value={String(t.cases)} sub={`${t.reviewed} reviewed · ${t.awaiting} awaiting review`} />
            <Tile label="AI agrees with reviewer" value={pct(acc.agree, acc.agree + acc.disagree)} sub={`${acc.agree + acc.disagree} items compared`} />
            <Tile label="RECI deals put through QA" value={pct(covChecked, covTotal)} sub={`${covChecked} of ${covTotal} deals`} />
          </div>

          {noConfirmed && (
            <p className="mt-4 rounded border border-teal-200 bg-teal-50 p-3 text-sm text-teal-900">
              No confirmed results in this period yet. Figures appear as cases are reviewed and signed off on the case page.
              {t.awaiting > 0 && ` ${t.awaiting} case${t.awaiting === 1 ? " is" : "s are"} awaiting review.`}
            </p>
          )}

          <Section title="Adviser scorecards">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2 py-1.5">Adviser</th><th className="px-2 py-1.5 text-right">Cases</th>
                  <th className="px-2 py-1.5 text-right">Form pass rate</th><th className="px-2 py-1.5 text-right">Starred fails</th>
                  <th className="px-2 py-1.5 text-right">Disclosures in full</th><th className="px-2 py-1.5 text-right">Report accuracy</th>
                  <th className="px-2 py-1.5">Sign-off</th><th className="px-2 py-1.5 text-right">Awaiting</th>
                </tr>
              </thead>
              <tbody>
                {data.advisers.map((a) => (
                  <tr key={a.name} className="border-t border-slate-100">
                    <td className="px-2 py-1.5 font-medium">
                      <span className="mr-2 inline-block h-2.5 w-2.5 rounded-full align-middle" style={{ background: colourOf(a.name) }} />
                      {a.name}
                    </td>
                    <td className="px-2 py-1.5 text-right">{a.cases}</td>
                    <td className="px-2 py-1.5 text-right font-semibold">{pct(a.form_pass, a.form_pass + a.form_fail)}</td>
                    <td className="px-2 py-1.5 text-right">{a.mandatory_fails}</td>
                    <td className="px-2 py-1.5 text-right">{pct(a.disc_full, a.disc_total)}</td>
                    <td className="px-2 py-1.5 text-right">{pct(a.report_ok, a.report_total)}</td>
                    <td className="px-2 py-1.5 text-xs text-slate-600">
                      {a.outcomes.approved ?? 0} approved · {a.outcomes.approved_with_actions ?? 0} with actions · {a.outcomes.returned ?? 0} returned
                    </td>
                    <td className="px-2 py-1.5 text-right">{a.awaiting}</td>
                  </tr>
                ))}
                {data.advisers.length === 0 && <tr><td colSpan={8} className="px-2 py-3 text-slate-500">No cases in this period.</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title="Openwork form pass rate by month" note="share of standards passed, reviewer-confirmed">
            {trendRows.length === 0 ? (
              <p className="text-sm text-slate-500">The trend appears once reviewed cases span more than one point in time.</p>
            ) : (
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={trendRows} margin={{ top: 8, right: 16, bottom: 4, left: 0 }}>
                    <CartesianGrid stroke="#e7e6e2" vertical={false} />
                    <XAxis dataKey="month" tick={{ fontSize: 12, fill: "#52514e" }} axisLine={{ stroke: "#d4d3cf" }} tickLine={false} />
                    <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tick={{ fontSize: 12, fill: "#52514e" }} axisLine={false} tickLine={false} width={44} />
                    <Tooltip formatter={(v) => (typeof v === "number" ? `${v}%` : String(v ?? "—"))} />
                    <Legend wrapperStyle={{ fontSize: 12 }} />
                    <Line type="monotone" dataKey="Team" stroke="#0b0b0b" strokeWidth={2} strokeDasharray="5 4" dot={{ r: 4 }} connectNulls isAnimationActive={false} />
                    {trendNames.map((n) => (
                      <Line key={n} type="monotone" dataKey={n} stroke={colourOf(n)} strokeWidth={2} dot={{ r: 4 }} connectNulls isAnimationActive={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Section>

          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            <Section title="Standards failed most often" note="where training would help most">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr><th className="px-2 py-1.5">Ref</th><th className="px-2 py-1.5">Standard</th><th className="px-2 py-1.5 text-right">Fails</th><th className="px-2 py-1.5 text-right">Rate</th></tr>
                </thead>
                <tbody>
                  {data.failed_standards.map((f, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 font-mono text-xs">{f.ref}{f.mandatory && <span className="text-red-700">*</span>}</td>
                      <td className="px-2 py-1.5">{f.label}</td>
                      <td className="px-2 py-1.5 text-right">{f.fails} of {f.total}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{pct(f.fails, f.total)}</td>
                    </tr>
                  ))}
                  {data.failed_standards.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">No confirmed fails.</td></tr>}
                </tbody>
              </table>
            </Section>

            <Section title="Disclosures most often missed">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr><th className="px-2 py-1.5">Disclosure</th><th className="px-2 py-1.5 text-right">Missing</th><th className="px-2 py-1.5 text-right">Partial</th><th className="px-2 py-1.5 text-right">Checked</th></tr>
                </thead>
                <tbody>
                  {data.missed_disclosures.map((d, i) => (
                    <tr key={i} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5">{d.label}</td>
                      <td className="px-2 py-1.5 text-right">{d.missing}</td>
                      <td className="px-2 py-1.5 text-right">{d.partial}</td>
                      <td className="px-2 py-1.5 text-right">{d.total}</td>
                    </tr>
                  ))}
                  {data.missed_disclosures.length === 0 && <tr><td colSpan={4} className="px-2 py-3 text-slate-500">None missed.</td></tr>}
                </tbody>
              </table>
            </Section>
          </div>

          <div className="grid grid-cols-1 gap-x-6 md:grid-cols-2">
            <Section title="How accurate is the AI?" note="its result versus the reviewer's">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr><th className="px-2 py-1.5">Area</th><th className="px-2 py-1.5 text-right">Agreed</th><th className="px-2 py-1.5 text-right">Overruled</th><th className="px-2 py-1.5 text-right">Rate</th><th className="px-2 py-1.5 text-right">Sent for review</th></tr>
                </thead>
                <tbody>
                  {Object.entries(data.ai_accuracy.by_section).map(([sec, c]) => (
                    <tr key={sec} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{SECTION_LABELS[sec] ?? sec}</td>
                      <td className="px-2 py-1.5 text-right">{c.agree}</td>
                      <td className="px-2 py-1.5 text-right">{c.disagree}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{pct(c.agree, c.agree + c.disagree)}</td>
                      <td className="px-2 py-1.5 text-right">{c.resolved}</td>
                    </tr>
                  ))}
                  {Object.keys(data.ai_accuracy.by_section).length === 0 && <tr><td colSpan={5} className="px-2 py-3 text-slate-500">Nothing reviewed yet.</td></tr>}
                </tbody>
              </table>
              {data.ai_accuracy.most_disagreed.length > 0 && (
                <>
                  <h3 className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-600">Most often overruled</h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {data.ai_accuracy.most_disagreed.map((d, i) => (
                      <li key={i}>{d.ref ? <span className="font-mono text-xs">{d.ref} </span> : null}{d.label} <span className="text-slate-500">({d.disagree} of {d.agree + d.disagree})</span></li>
                    ))}
                  </ul>
                </>
              )}
              <p className="mt-2 text-xs text-slate-500">&ldquo;Sent for review&rdquo; counts items the AI marked REVIEW REQUIRED that a reviewer then decided.</p>
            </Section>

            <Section title="Coverage and flags">
              <table className="w-full border-collapse text-sm tabular-nums">
                <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
                  <tr><th className="px-2 py-1.5">Adviser</th><th className="px-2 py-1.5 text-right">RECI deals</th><th className="px-2 py-1.5 text-right">Through QA</th><th className="px-2 py-1.5 text-right">Coverage</th></tr>
                </thead>
                <tbody>
                  {data.coverage.map((c) => (
                    <tr key={c.adviser_id} className="border-t border-slate-100">
                      <td className="px-2 py-1.5">{c.name}</td>
                      <td className="px-2 py-1.5 text-right">{c.total}</td>
                      <td className="px-2 py-1.5 text-right">{c.checked}</td>
                      <td className="px-2 py-1.5 text-right font-semibold">{pct(c.checked, c.total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-2 text-xs text-slate-500">Coverage counts RECI deals booked in the period (not cancelled) that are linked to a QA case.</p>
              <div className="mt-3 grid grid-cols-2 gap-3">
                <Tile label="Cases with vulnerability identified" value={String(data.flags.vulnerability_cases)} sub="from the client facts" />
                <Tile label="Cases replacing existing cover" value={String(data.flags.replacement_cases)} sub="reviewer-confirmed" />
              </div>
            </Section>
          </div>
        </>
      )}
    </main>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-3">
      <div className="text-xs font-medium text-slate-600">{label}</div>
      <div className="mt-1 text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}

function Section({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) {
  return (
    <section className="mt-6">
      <h2 className="border-b border-slate-300 pb-1 text-lg font-bold">
        {title}{note && <span className="ml-2 text-xs font-normal text-slate-500">{note}</span>}
      </h2>
      <div className="mt-2 overflow-x-auto">{children}</div>
    </section>
  );
}
