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
}
interface Adviser { id: number; name: string }

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
  const [advisers, setAdvisers] = useState<Adviser[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ client_name: "", adviser_id: "", case_type: "two_call", notes: "" });
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/qa/cases", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to Call QA." : `HTTP ${r.status}`);
      const j = await r.json();
      setCases(j.cases); setAdvisers(j.advisers);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try {
      const r = await fetch("/api/qa/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, adviser_id: form.adviser_id ? Number(form.adviser_id) : null }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      router.push(`/qa/${j.id}`);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "save failed");
      setSaving(false);
    }
  }

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
          <button type="button" onClick={() => setShowNew((v) => !v)}
            className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800">
            + New case
          </button>
        </div>
      </div>

      {err && <p className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{err}</p>}

      {showNew && (
        <form onSubmit={create} className="mt-4 grid grid-cols-1 gap-3 rounded-lg border border-slate-300 bg-white p-4 text-sm md:grid-cols-4">
          <label className="md:col-span-2">
            <span className="mb-1 block text-xs font-medium text-slate-600">Client name *</span>
            <input required value={form.client_name} onChange={(e) => setForm({ ...form, client_name: e.target.value })}
              className="w-full rounded border px-2 py-1" />
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Adviser</span>
            <select value={form.adviser_id} onChange={(e) => setForm({ ...form, adviser_id: e.target.value })}
              className="w-full rounded border px-2 py-1">
              <option value="">Select</option>
              {advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>
          <label>
            <span className="mb-1 block text-xs font-medium text-slate-600">Case type</span>
            <select value={form.case_type} onChange={(e) => setForm({ ...form, case_type: e.target.value })}
              className="w-full rounded border px-2 py-1">
              <option value="two_call">Fact find call + advice call</option>
              <option value="one_call">One call</option>
            </select>
          </label>
          <label className="md:col-span-4">
            <span className="mb-1 block text-xs font-medium text-slate-600">Notes (optional)</span>
            <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
              className="w-full rounded border px-2 py-1" />
          </label>
          <div className="md:col-span-4 flex justify-end gap-2">
            <button type="button" onClick={() => setShowNew(false)} className="px-3 py-1.5 text-slate-600">Cancel</button>
            <button type="submit" disabled={saving}
              className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50">
              {saving ? "Creating…" : "Create case"}
            </button>
          </div>
        </form>
      )}

      <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-3 py-2">Client</th>
              <th className="px-3 py-2">Adviser</th>
              <th className="px-3 py-2">Type</th>
              <th className="px-3 py-2">Calls</th>
              <th className="px-3 py-2">Checks</th>
              <th className="px-3 py-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {!cases && !err && <tr><td colSpan={6} className="px-3 py-4 text-slate-400">Loading…</td></tr>}
            {cases && cases.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-6 text-center text-slate-500">No cases yet. Click + New case to start.</td></tr>
            )}
            {cases?.map((c) => (
              <tr key={c.id} className="cursor-pointer border-t border-slate-100 hover:bg-slate-50"
                onClick={() => router.push(`/qa/${c.id}`)}>
                <td className="px-3 py-2 font-medium">{c.client_name}</td>
                <td className="px-3 py-2">{c.adviser_name ?? "—"}</td>
                <td className="px-3 py-2">{c.case_type === "one_call" ? "One call" : "Two calls"}</td>
                <td className="px-3 py-2 tabular-nums">{c.calls_ready}/{c.calls} transcribed</td>
                <td className="space-x-1 px-3 py-2"><GateChip label="Gate 1" status={c.gate1_status} /><GateChip label="Gate 2" status={c.gate2_status} /></td>
                <td className="px-3 py-2 text-slate-500">{new Date(c.created_at).toLocaleDateString("en-GB")} · {c.created_by}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
