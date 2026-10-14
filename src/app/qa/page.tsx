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
  const [uk, setUk] = useState<{ ready: boolean; reason?: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch("/api/qa/cases", { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to Call QA." : `HTTP ${r.status}`);
      const j = await r.json();
      setCases(j.cases); setAdvisers(j.advisers); setUk(j.uk ?? null);
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
          <Link href="/qa/dashboard" className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 font-medium text-teal-800 hover:bg-teal-100">QA dashboard</Link>
          <button type="button" onClick={() => setShowNew((v) => !v)}
            className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800">
            + New case
          </button>
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

      <RecordingsInbox cases={cases ?? []} ukReady={!!uk?.ready} onAdded={load} />

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
              <tr><td colSpan={7} className="px-3 py-6 text-center text-slate-500">No cases yet. Click + New case to start.</td></tr>
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

interface InboxItem {
  id: number;
  filename: string;
  size_bytes: number | null;
  adviser_id: number | null;
  adviser_name: string | null;
  client_phone: string | null;
  call_at: string | null;
  status: "new" | "assigned" | "ignored";
  suggested_case_id: number | null;
  suggested_case_name: string | null;
}
interface InboxResp {
  configured: boolean;
  items: InboxItem[];
  sync: { synced_at: string | null } | null;
  counts: Record<string, number>;
}

function RecordingsInbox({ cases, ukReady, onAdded }: { cases: CaseRow[]; ukReady: boolean; onAdded: () => void }) {
  const [view, setView] = useState<"new" | "ignored">("new");
  const [data, setData] = useState<InboxResp | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch(`/api/qa/inbox?status=${view}`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [view]);
  useEffect(() => { void load(); }, [load]);

  const sync = useCallback(async (quiet = false) => {
    setSyncing(true);
    if (!quiet) setMsg(null);
    const r = await fetch("/api/qa/inbox/sync", { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setSyncing(false);
    if (!r.ok) { if (!quiet) setMsg(j.error || `HTTP ${r.status}`); return; }
    if (!quiet) setMsg(j.added ? `${j.added} new recording${j.added === 1 ? "" : "s"} found.` : "No new recordings.");
    void load();
  }, [load]);

  if (!data) return null;

  // Group by client number so a fact find and its advice call sit together.
  const groups = new Map<string, InboxItem[]>();
  for (const it of data.items) {
    const k = it.client_phone ?? `unknown-${it.id}`;
    groups.set(k, [...(groups.get(k) ?? []), it]);
  }

  return (
    <section className="mt-5 rounded-lg border border-teal-300 bg-white">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-teal-200 bg-teal-50 px-3 py-2">
        <div>
          <h2 className="font-bold text-teal-900">Recordings inbox</h2>
          <p className="text-xs text-teal-800">
            Recordings from the phone system, grouped by client number. Nothing is listened to automatically:
            only the calls you add to a case are transcribed and checked.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <div className="inline-flex overflow-hidden rounded border border-teal-300 bg-white text-xs">
            {(["new", "ignored"] as const).map((v) => (
              <button key={v} type="button" onClick={() => setView(v)}
                className={`px-2 py-1 ${view === v ? "bg-teal-700 text-white" : "text-teal-800 hover:bg-teal-50"}`}>
                {v === "new" ? `To do (${data.counts.new ?? 0})` : `Ignored (${data.counts.ignored ?? 0})`}
              </button>
            ))}
          </div>
          {data.configured && (
            <button type="button" onClick={() => sync()} disabled={syncing}
              className="rounded border border-teal-400 bg-white px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-100 disabled:opacity-50">
              {syncing ? "Checking…" : "Check SharePoint now"}
            </button>
          )}
        </div>
      </div>
      {!data.configured ? (
        <p className="px-3 py-3 text-sm text-slate-600">
          The SharePoint connection isn&apos;t set up yet. Until it is, upload recordings by hand on each case.
        </p>
      ) : (
        <div className="px-3 py-2">
          <p className="text-xs text-slate-500">
            {data.sync?.synced_at ? `Last checked ${new Date(data.sync.synced_at).toLocaleString("en-GB")}.` : "Not checked yet."}
            {msg ? ` ${msg}` : ""}
          </p>
          {data.items.length === 0 && (
            <p className="py-3 text-sm text-slate-500">{view === "new" ? "Nothing waiting." : "Nothing ignored."}</p>
          )}
          <div className="mt-1 space-y-3">
            {Array.from(groups.entries()).map(([k, items]) => (
              <div key={k} className="rounded border border-slate-200">
                <div className="bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                  {items[0].client_phone ? `Client number ${items[0].client_phone}` : "Client number not found in the file name"}
                  {items.length > 1 && <span className="ml-2 font-normal text-slate-500">{items.length} calls</span>}
                </div>
                {items.slice().sort((a, b) => (a.call_at ?? "").localeCompare(b.call_at ?? "")).map((it, idx) => (
                  <InboxRow key={it.id} item={it} position={idx} groupSize={items.length} cases={cases}
                    view={view} ukReady={ukReady} onDone={() => { void load(); onAdded(); }} />
                ))}
              </div>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function InboxRow({ item, position, groupSize, cases, view, ukReady, onDone }: {
  item: InboxItem; position: number; groupSize: number; cases: CaseRow[];
  view: "new" | "ignored"; ukReady: boolean; onDone: () => void;
}) {
  const [target, setTarget] = useState<string>(item.suggested_case_id ? String(item.suggested_case_id) : "new");
  const [clientName, setClientName] = useState("");
  const [caseType, setCaseType] = useState(groupSize > 1 ? "two_call" : "one_call");
  const [callType, setCallType] = useState(groupSize > 1 ? (position === 0 ? "fact_find" : "advice") : "one_call");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function add() {
    setError(null);
    if (target === "new" && !clientName.trim()) { setError("Enter the client's name."); return; }
    setBusy("Sending for transcription…");
    const r = await fetch(`/api/qa/inbox/${item.id}/assign`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(target === "new"
        ? { new_case: { client_name: clientName, case_type: caseType }, call_type: callType }
        : { case_id: Number(target), call_type: callType }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setError(j.error || `HTTP ${r.status}`); return; }
    onDone();
  }
  async function setStatus(status: "ignored" | "new") {
    setBusy("…");
    await fetch(`/api/qa/inbox/${item.id}/status`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
    });
    setBusy(null);
    onDone();
  }

  return (
    <div className="border-t border-slate-100 px-2 py-2 text-sm">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="font-medium">{item.call_at ? new Date(item.call_at).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : "Time unknown"}</span>
        <span>{item.adviser_name ?? "Adviser unknown"}</span>
        {item.size_bytes ? <span className="text-xs text-slate-500">{(item.size_bytes / 1048576).toFixed(1)} MB</span> : null}
        <span className="truncate text-xs text-slate-400" title={item.filename}>{item.filename}</span>
      </div>
      {view === "new" ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <select value={callType} onChange={(e) => setCallType(e.target.value)} className="rounded border px-1 py-0.5 text-xs">
            <option value="fact_find">Fact find call</option>
            <option value="advice">Advice call</option>
            <option value="one_call">One call</option>
            <option value="other">Other</option>
          </select>
          <select value={target} onChange={(e) => setTarget(e.target.value)} className="max-w-[16rem] rounded border px-1 py-0.5 text-xs">
            <option value="new">New case…</option>
            {item.suggested_case_id && <option value={item.suggested_case_id}>{item.suggested_case_name} (same number)</option>}
            {cases.filter((c) => c.id !== item.suggested_case_id).slice(0, 50).map((c) => (
              <option key={c.id} value={c.id}>{c.client_name}{c.adviser_name ? ` · ${c.adviser_name}` : ""}</option>
            ))}
          </select>
          {target === "new" && (
            <>
              <input value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Client name"
                className="w-40 rounded border px-1 py-0.5 text-xs" />
              <select value={caseType} onChange={(e) => setCaseType(e.target.value)} className="rounded border px-1 py-0.5 text-xs">
                <option value="two_call">Two calls</option>
                <option value="one_call">One call</option>
              </select>
            </>
          )}
          <button type="button" onClick={add} disabled={!!busy || !ukReady}
            title={ukReady ? undefined : "Switched off until the UK processing account is set up"}
            className="rounded bg-teal-700 px-2 py-0.5 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50">
            {busy ?? "Add to case"}
          </button>
          <button type="button" onClick={() => setStatus("ignored")} disabled={!!busy}
            className="rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
            Ignore
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setStatus("new")} disabled={!!busy}
          className="mt-1 rounded border border-slate-300 px-2 py-0.5 text-xs text-slate-600 hover:bg-slate-50">
          Restore to inbox
        </button>
      )}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}
