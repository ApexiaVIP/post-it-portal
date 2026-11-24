"use client";

/**
 * Advice check: the list (Guy, 22 Nov 2026). Sellers see their own checks;
 * Guy, Poz, Pauline and Jimmy see everyone's.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { READINESS_STYLE, type CheckSummary } from "@/lib/advice/shared";

interface Row {
  id: number;
  adviser_id: number | null;
  adviser_name: string | null;
  created_by: string;
  client_label: string;
  case_type: "one_call" | "two_call";
  fact_find_date: string;
  status: "draft" | "running" | "done" | "failed";
  presented: boolean;
  previous_id: number | null;
  qa_case_id: number | null;
  created_at: string;
  finished_at: string | null;
  summary: CheckSummary | null;
}
interface FormLite {
  id: number; adviser_id: number | null; adviser_name: string | null; created_by: string; client_label: string; fact_find_date: string;
  presented: boolean; updated_at: string; purged_at: string | null; check_id: number | null; check_status: Row["status"] | null; summary: CheckSummary | null;
}
interface Forms { allowed: boolean; sellers_open?: boolean; forms: FormLite[] }
interface ListData {
  checks: Row[];
  me: { username: string; reviewer: boolean; adviser_id: number | null };
  advisers: { id: number; name: string }[];
  uk: { ready: boolean; reason?: string };
}

function fmtDay(d: string): string {
  return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function StatusChip({ row }: { row: Pick<Row, "status" | "summary"> }) {
  if (row.status === "done" && row.summary) {
    return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${READINESS_STYLE[row.summary.readiness]}`}>{row.summary.label}</span>;
  }
  const [text, cls] =
    row.status === "running" ? ["Checking", "bg-sky-100 text-sky-800"]
    : row.status === "failed" ? ["Didn't finish", "bg-red-100 text-red-800"]
    : row.status === "draft" ? ["Not run", "bg-slate-100 text-slate-600"]
    : ["Done", "bg-slate-100 text-slate-600"];
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${cls}`}>{text}</span>;
}

export default function AdviceCheckListPage() {
  const [data, setData] = useState<ListData | null>(null);
  const [forms, setForms] = useState<Forms | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [seller, setSeller] = useState<string>("");

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/advice-check", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to the advice check." : `HTTP ${r.status}`);
      setData(await r.json());
      const f = await fetch("/api/advice-check/form", { cache: "no-store" });
      if (f.ok) setForms(await f.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const running = !!data?.checks.some((c) => c.status === "running") || !!forms?.forms.some((f) => f.check_status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(t);
  }, [running, load]);

  const rows = useMemo(
    () => (data?.checks ?? []).filter((c) => !seller || String(c.adviser_id) === seller),
    [data, seller],
  );

  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;
  const reviewer = data.me.reviewer;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <h1 className="text-2xl font-bold">Advice check</h1>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">
            Run it on every case before you present advice. {forms?.allowed ? "Fill in the Fact Find online on the call" : "Upload or paste your completed Fact Find sheet"}, with your
            recommendation. It tells you if the case is within our licence and what the red lines are. Run it again after the advice
            call (or straight after a one call) for your Concert Hub page: what to choose on each screen, and three short notes.
            It only uses what&apos;s on your sheet: if something is missing, ring the client back and ask.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {forms?.allowed && (
            <Link href="/advice-check/form/new" className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800">New Fact Find</Link>
          )}
          <Link href="/advice-check/new"
            className={forms?.allowed ? "text-sm text-teal-800 underline" : "rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800"}>
            {forms?.allowed ? "Upload or paste a sheet instead" : "New check"}
          </Link>
        </div>
      </div>

      {!data.uk.ready && (
        <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Checks are switched off for now: {data.uk.reason}
        </p>
      )}

      {reviewer && (
        <div className="mt-4 flex items-center gap-2 text-sm">
          <label htmlFor="seller" className="text-slate-600">Seller</label>
          <select id="seller" value={seller} onChange={(e) => setSeller(e.target.value)}
            className="rounded border border-slate-300 px-2 py-1">
            <option value="">Everyone</option>
            {data.advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </div>
      )}

      {forms?.allowed && forms.sellers_open === false && (
        <p className="mt-4 rounded border border-sky-200 bg-sky-50 p-3 text-sm text-sky-900">
          The online Fact Find isn&apos;t open to sellers yet. Guy, Poz and Jimmy can try it on made-up clients.
        </p>
      )}
      {forms?.allowed && forms.forms.some((f) => !seller || String(f.adviser_id) === seller) && (
        <div className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr><th className="px-3 py-2">Fact Find</th>{reviewer && <th className="px-3 py-2">Seller</th>}<th className="px-3 py-2">Date</th><th className="px-3 py-2">Last check</th><th className="px-3 py-2">Last changed</th></tr>
            </thead>
            <tbody>
              {forms.forms.filter((f) => !seller || String(f.adviser_id) === seller).map((f) => (
                <tr key={f.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2"><Link href={`/advice-check/form/${f.id}`} className="font-medium text-teal-800 hover:underline">{f.client_label}</Link>{f.purged_at && <span className="ml-2 text-xs text-slate-500">answers cleared</span>}</td>
                  {reviewer && <td className="px-3 py-2">{f.adviser_name ?? f.created_by}</td>}
                  <td className="whitespace-nowrap px-3 py-2">{fmtDay(f.fact_find_date)}</td>
                  <td className="px-3 py-2">{f.check_id && f.check_status ? <Link href={`/advice-check/${f.check_id}`}><StatusChip row={{ status: f.check_status, summary: f.summary }} /></Link> : <span className="text-xs text-slate-500">Not checked yet</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-slate-500">{new Date(f.updated_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {forms?.allowed && rows.length > 0 && <h2 className="mt-6 text-sm font-bold uppercase tracking-wide text-slate-500">Checks</h2>}
      {rows.length === 0 ? (
        <p className="mt-6 rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">
          No checks yet. {forms?.allowed ? "Start a New Fact Find, and run the check from it." : "Press New check once you've completed the Fact Find sheet."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2">Client</th>
                {reviewer && <th className="px-3 py-2">Seller</th>}
                <th className="px-3 py-2">Fact find</th>
                <th className="px-3 py-2">Calls</th>
                <th className="px-3 py-2">Outcome</th>
                <th className="px-3 py-2">Run</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id} className="border-b border-slate-100 last:border-0 hover:bg-slate-50">
                  <td className="px-3 py-2">
                    <Link href={`/advice-check/${c.id}`} className="font-medium text-teal-800 hover:underline">{c.client_label}</Link>
                    {c.previous_id && <span className="ml-2 text-xs text-slate-500">repeat</span>}
                    {reviewer && c.qa_case_id && <span className="ml-2 text-xs text-slate-500">on Call QA case {c.qa_case_id}</span>}
                  </td>
                  {reviewer && <td className="px-3 py-2">{c.adviser_name ?? c.created_by}</td>}
                  <td className="px-3 py-2 whitespace-nowrap">{fmtDay(c.fact_find_date)}</td>
                  <td className="px-3 py-2">{c.case_type === "one_call" ? "One" : "Two"}</td>
                  <td className="px-3 py-2"><StatusChip row={c} /></td>
                  <td className="px-3 py-2 whitespace-nowrap text-slate-500">
                    {new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
