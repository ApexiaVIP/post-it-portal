"use client";

/**
 * Call QA: case list (Guy + Poz brief, 6 Oct 2026). Jimmy, Pauline/Poz
 * and Guy only. Each case holds the client's call recordings, Gate 1
 * (calls, at Confirmation Check) and Gate 2 (suitability report).
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CaseRow {
  id: number;
  client_name: string;
  case_type: "one_call" | "two_call";
  adviser_name: string | null;
  created_by: string;
  created_at: string;
  calls: number;
  calls_ready: number;
  gate1_status: "running" | "done" | "failed" | null;
  gate2_status: "running" | "done" | "failed" | null;
  outcome: "approved" | "approved_with_actions" | "returned" | null;
}

const OUTCOME_CHIP: Record<string, [string, string]> = {
  approved: ["Approved", "bg-emerald-100 text-emerald-800"],
  approved_with_actions: ["Approved with actions", "bg-amber-100 text-amber-900"],
  returned: ["Returned", "bg-red-100 text-red-800"],
};

function GateChip({ label, status }: { label: string; status: CaseRow["gate1_status"] }) {
  const cls =
    status === "done" ? "bg-emerald-100 text-emerald-800" :
    status === "running" ? "bg-amber-100 text-amber-800" :
    status === "failed" ? "bg-red-100 text-red-800" :
    "bg-slate-100 text-slate-500";
  const text = status === "done" ? "done" : status === "running" ? "running" : status === "failed" ? "failed" : "not run";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${cls}`}>{label}: {text}</span>;
}

export default function CallQaListPage() {
  const router = useRouter();
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [uk, setUk] = useState<{ ready: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/qa/cases", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to Call QA." : `HTTP ${r.status}`);
      const j = await r.json();
      setCases(j.cases); setUk(j.uk ?? null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <h1 className="text-2xl font-bold">Call QA</h1>
          <p className="text-sm text-slate-600">
            AI checks on recorded sales calls and suitability reports. It flags; a person decides.
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          <Link href="/" className="rounded border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-50">POST IT</Link>
          <Link href="/qa/dashboard" className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 font-medium text-teal-800 hover:bg-teal-100">QA dashboard</Link>
          <Link href="/reci/recordings" className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800">
            Listening pool
          </Link>
        </div>
      </div>

      {err && <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{err}</p>}

      {uk && !uk.ready && (
        <div className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">Call QA is switched off until the UK processing account is set up.</p>
          <p className="mt-1">
            Recordings are transcribed and checked only in Amazon&apos;s London data centre, in TopQuote&apos;s own account.
            Until that is in place, nothing can be uploaded, sent or stored here.
          </p>
        </div>
      )}

      <p className="mt-3 rounded border border-teal-200 bg-teal-50 p-2 text-sm text-teal-900">
        Calls now come from the sale: the agent adds the 3CX recording when they create the sale on their RECI board,
        and it is transcribed only when you press Transcribe in the{" "}
        <Link href="/reci/recordings" className="font-medium underline">listening pool</Link>. Each sale gets its own case here.
      </p>

      <h2 className="mt-6 text-lg font-bold">Cases</h2>
      <div className="mt-2 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Adviser</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Calls</th>
              <th className="px-3 py-2">Checks</th>
              <th className="px-3 py-2">Sign-off</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {!cases && !err && <tr><td colSpan={7} className="px-3 py-4 text-slate-400">Loading…</td></tr>}
            {cases && cases.length === 0 && (
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No cases yet. They appear here when you transcribe a sale from the listening pool.</td></tr>
            )}
            {cases?.map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => router.push(`/qa/${c.id}`)}>
                <td className="px-3 py-2 font-medium">{c.client_name}</td>
                <td className="px-3 py-2">{c.adviser_name ?? "—"}</td>
                <td className="px-3 py-2">{c.case_type === "one_call" ? "One call" : "Two calls"}</td>
                <td className="px-3 py-2 tabular-nums">{c.calls_ready}/{c.calls} transcribed</td>
                <td className="space-x-1 px-3 py-2"><GateChip label="Gate 1" status={c.gate1_status} /><GateChip label="Gate 2" status={c.gate2_status} /></td>
                <td className="px-3 py-2">
                  {c.outcome
                    ? <span className={`rounded px-1.5 py-0.5 text-[11px] font-medium ${OUTCOME_CHIP[c.outcome][1]}`}>{OUTCOME_CHIP[c.outcome][0]}</span>
                    : c.gate1_status === "done"
                      ? <span className="rounded bg-teal-100 px-1.5 py-0.5 text-[11px] font-medium text-teal-800">Awaiting review</span>
                      : <span className="text-xs text-slate-400">—</span>}
                </td>
                <td className="px-3 py-2 text-slate-500">{new Date(c.created_at).toLocaleDateString("en-GB")} · {c.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}

// ---------------------------------------------------------------- inbox
