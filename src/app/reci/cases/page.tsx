"use client";

/**
 * Adviser cases workspace (Poz, 6 Aug 2026).
 *
 * Two tabs:
 *   Cancelled     — every cancelled deal in scope, worked by the adviser:
 *                   call log, Resold / P&M outcome, replacement details +
 *                   new commission, clawback saved (senior admin entry),
 *                   notes. Row turns green once recorded as Resold.
 *   In processing — the adviser's live pipeline: status moves + notes.
 *
 * Scope: admins + Tan/Hayder see everyone (with adviser filter pills),
 * juniors see only their own cases, Guy sees everyone read-only. There
 * is deliberately NO financial dashboard here — the only £ figures are
 * per-case (commission, so cases can be prioritised, and the resold
 * numbers).
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import {
  CALL_OUTCOMES, RESOLD_OUTCOME_LABELS, STATUS_LABELS,
  CANCELLATION_REASON_LABELS,
  type DealStatus, type ResoldOutcome, type CancellationReason,
} from "@/lib/reci/schema";

type Tab = "cancelled" | "in_processing";

interface CaseRow {
  id: number;
  adviser_id: number;
  adviser_name: string;
  year: number;
  week: number;
  client: string;
  postcode: string | null;
  provider: string | null;
  status: DealStatus;
  in_processing_stage: string | null;
  commission: number;
  notes: string | null;
  cancellation_reason: CancellationReason | null;
  cancellation_notes: string | null;
  cancelled_at: string | null;
  cancel_week: number;
  resold_outcome: ResoldOutcome | null;
  resold_details: string | null;
  resold_new_commission: number | null;
  clawback_saved: number | null;
  resold_notes: string | null;
  resold_recorded_by: string | null;
  calls_count: number;
  last_call_on: string | null;
  call_dates: string[];
}

interface Totals {
  perAdviser: {
    adviser_id: number; adviser_name: string;
    cancelled_n: number; resolved_n: number; clawback_saved: number; commission: number;
  }[];
  weekly: { week: number; cancelled_n: number; resolved_n: number; clawback_saved: number }[];
}

interface Resp {
  tab: Tab;
  year: number;
  scope: "own" | "all";
  canEdit: boolean;
  canEditClawbackSaved: boolean;
  advisers: { id: number; name: string }[];
  rows: CaseRow[];
  totals: Totals | null;
}

interface CallRow {
  id: number; called_on: string; outcome: string; note: string | null; actor: string;
}

function gbp(v: number | null | undefined): string {
  const n = Number(v);
  if (!Number.isFinite(n) || v === null || v === undefined) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return "—";
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdviserCasesPage() {
  const [tab, setTab] = useState<Tab>("cancelled");
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [adviser, setAdviser] = useState<number | null>(null);
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  const [showWeekly, setShowWeekly] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setErr(null);
    try {
      const p = new URLSearchParams({ tab, year: String(year) });
      if (adviser) p.set("adviser", String(adviser));
      const r = await fetch(`/api/reci/cases?${p}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    } finally {
      setLoading(false);
    }
  }, [tab, year, adviser]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => { setExpanded(null); }, [tab, year, adviser]);

  const resolvedTotal = data?.totals?.perAdviser.reduce((s, a) => s + a.resolved_n, 0) ?? 0;
  const cancelledTotal = data?.totals?.perAdviser.reduce((s, a) => s + a.cancelled_n, 0) ?? 0;
  const savedTotal = data?.totals?.perAdviser.reduce((s, a) => s + a.clawback_saved, 0) ?? 0;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="border-b bg-white">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <h1 className="text-lg font-semibold">{data?.scope === "own" ? "My Cases" : "Adviser Cases"}</h1>
            <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white text-sm">
              {(["cancelled", "in_processing"] as Tab[]).map((t) => (
                <button key={t} type="button" onClick={() => setTab(t)}
                  className={`px-3 py-1.5 ${tab === t ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-100"}`}>
                  {t === "cancelled" ? "Cancelled" : "In processing"}
                </button>
              ))}
            </div>
          </div>
          <label className="flex items-center gap-1 text-sm">
            <span className="text-slate-600">Year</span>
            <input type="number" value={year}
              onChange={(e) => setYear(Number(e.target.value) || new Date().getFullYear())}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
          </label>
        </div>

        {data && data.scope === "all" && data.advisers.length > 0 && (
          <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2 px-4 pb-3 text-xs">
            <span className="font-medium uppercase tracking-wide text-slate-500">Adviser</span>
            <Pill label="All" active={adviser === null} onClick={() => setAdviser(null)} />
            {data.advisers.map((a) => (
              <Pill key={a.id} label={a.name} active={adviser === a.id} onClick={() => setAdviser(a.id)} />
            ))}
          </div>
        )}
        {(loading || err) && (
          <div className="mx-auto max-w-[1400px] px-4 pb-2 text-xs">
            {loading ? <span className="text-slate-500">Loading…</span> : <span className="text-red-600">{err}</span>}
          </div>
        )}
      </header>

      <main className="mx-auto max-w-[1400px] space-y-4 px-4 py-4">
        {!data ? (
          <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">Loading…</div>
        ) : tab === "cancelled" ? (
          <>
            {/* Totals: overall cards + weekly (by cancellation week) + per-adviser */}
            <section className="grid gap-3 sm:grid-cols-3">
              <StatCard label="Cancelled cases" value={String(cancelledTotal)} />
              <StatCard label="Resolved (resold)" value={String(resolvedTotal)} accent="green" />
              <StatCard label="Potential clawback saved" value={gbp(savedTotal)} accent="green" />
            </section>

            {data.totals && data.scope === "all" && data.totals.perAdviser.length > 1 && (
              <section className="rounded-lg border bg-white shadow-sm">
                <div className="border-b px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
                  Per adviser
                </div>
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Adviser</th>
                      <th className="px-3 py-1.5 text-right">Cancelled</th>
                      <th className="px-3 py-1.5 text-right">Resolved</th>
                      <th className="px-3 py-1.5 text-right">Commission at stake</th>
                      <th className="px-3 py-1.5 text-right">Clawback saved</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.totals.perAdviser.map((a) => (
                      <tr key={a.adviser_id} className="border-t border-slate-100">
                        <td className="px-3 py-1.5 font-medium">{a.adviser_name}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{a.cancelled_n}</td>
                        <td className={`px-3 py-1.5 text-right tabular-nums ${a.resolved_n > 0 ? "font-semibold text-emerald-700" : ""}`}>{a.resolved_n}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{gbp(a.commission)}</td>
                        <td className="px-3 py-1.5 text-right tabular-nums">{a.clawback_saved > 0 ? gbp(a.clawback_saved) : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {data.totals && data.totals.weekly.length > 0 && (
              <section className="rounded-lg border bg-white shadow-sm">
                <button type="button" onClick={() => setShowWeekly((v) => !v)}
                  className="flex w-full items-center justify-between px-4 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-600 hover:bg-slate-50">
                  <span>Weekly totals (by cancellation week)</span>
                  <span>{showWeekly ? "▴" : "▾"}</span>
                </button>
                {showWeekly && (
                  <table className="w-full border-t text-sm">
                    <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Week</th>
                        <th className="px-3 py-1.5 text-right">Cancelled</th>
                        <th className="px-3 py-1.5 text-right">Resolved</th>
                        <th className="px-3 py-1.5 text-right">Clawback saved</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.totals.weekly.map((w) => (
                        <tr key={w.week} className="border-t border-slate-100">
                          <td className="px-3 py-1.5 font-medium tabular-nums">{w.week}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{w.cancelled_n}</td>
                          <td className={`px-3 py-1.5 text-right tabular-nums ${w.resolved_n > 0 ? "font-semibold text-emerald-700" : ""}`}>{w.resolved_n}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{w.clawback_saved > 0 ? gbp(w.clawback_saved) : "—"}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </section>
            )}

            <CancelledTable
              data={data}
              expanded={expanded}
              setExpanded={setExpanded}
              onChanged={load}
            />
          </>
        ) : (
          <InProcessingTable data={data} expanded={expanded} setExpanded={setExpanded} onChanged={load} />
        )}
      </main>
    </div>
  );
}

function Pill({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick}
      className={`rounded-full border px-2.5 py-0.5 transition-colors ${
        active ? "border-slate-900 bg-slate-900 text-white" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
      }`}>
      {label}
    </button>
  );
}

function StatCard({ label, value, accent }: { label: string; value: string; accent?: "green" }) {
  return (
    <div className={`rounded-lg border p-3 shadow-sm ${accent === "green" ? "border-emerald-200 bg-emerald-50" : "border-slate-200 bg-white"}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cancelled tab
// ---------------------------------------------------------------------------

function CancelledTable({ data, expanded, setExpanded, onChanged }: {
  data: Resp;
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  onChanged: () => void;
}) {
  const showAdviserCol = data.scope === "all";
  if (data.rows.length === 0) {
    return <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">No cancelled cases for {data.year}.</div>;
  }
  return (
    <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {showAdviserCol && <th className="px-3 py-2 text-left">Adviser</th>}
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Postcode</th>
              <th className="px-3 py-2 text-left">Cancelled</th>
              <th className="px-3 py-2 text-left">Reason</th>
              <th className="px-3 py-2 text-right">Commission</th>
              <th className="px-3 py-2 text-left">Outcome</th>
              <th className="px-3 py-2 text-left">Calls</th>
              <th className="px-3 py-2 text-right">CB saved</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <Fragment key={r.id}>
                <tr
                  onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className={`cursor-pointer border-t border-slate-100 ${
                    r.resold_outcome === "resold"
                      ? "bg-emerald-100 hover:bg-emerald-200/70"
                      : "hover:bg-slate-50"
                  }`}
                >
                  {showAdviserCol && <td className="px-3 py-2 text-slate-600">{r.adviser_name}</td>}
                  <td className="px-3 py-2 font-medium">{r.client}</td>
                  <td className="px-3 py-2">{r.postcode || "—"}</td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.cancelled_at ? fmtDate(r.cancelled_at) : `wk ${r.week}`}
                    <span className="ml-1 text-xs text-slate-400">wk {r.cancel_week}</span>
                  </td>
                  <td className="px-3 py-2">{r.cancellation_reason ? CANCELLATION_REASON_LABELS[r.cancellation_reason] : "—"}</td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{gbp(r.commission)}</td>
                  <td className="px-3 py-2">
                    {r.resold_outcome
                      ? <span className={`rounded px-2 py-0.5 text-xs font-medium ${
                          r.resold_outcome === "resold" ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-700"
                        }`}>{RESOLD_OUTCOME_LABELS[r.resold_outcome]}</span>
                      : <span className="text-slate-400">—</span>}
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {r.calls_count > 0
                      ? <span title={r.call_dates.map(fmtDate).join(", ")}>
                          <strong>{r.calls_count}</strong>
                          <span className="ml-1 text-xs text-slate-500">last {fmtDate(r.last_call_on)}</span>
                        </span>
                      : <span className="text-slate-400">none</span>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.clawback_saved != null ? gbp(r.clawback_saved) : "—"}</td>
                  <td className="px-2 py-2 text-slate-400">{expanded === r.id ? "▴" : "▾"}</td>
                </tr>
                {expanded === r.id && (
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td colSpan={showAdviserCol ? 10 : 9} className="p-0">
                      <CancelledDetail row={r} resp={data} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function CancelledDetail({ row, resp, onChanged }: { row: CaseRow; resp: Resp; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // Outcome form state seeded from the row.
  const [outcome, setOutcome] = useState<string>(row.resold_outcome ?? "");
  const [details, setDetails] = useState(row.resold_details ?? "");
  const [newComm, setNewComm] = useState(row.resold_new_commission != null ? String(row.resold_new_commission) : "");
  const [rNotes, setRNotes] = useState(row.resold_notes ?? "");
  const [cbSaved, setCbSaved] = useState(row.clawback_saved != null ? String(row.clawback_saved) : "");

  // Call log.
  const [calls, setCalls] = useState<CallRow[] | null>(null);
  const [callDate, setCallDate] = useState<string>(new Intl.DateTimeFormat("en-CA").format(new Date()));
  const [callOutcome, setCallOutcome] = useState<string>(CALL_OUTCOMES[0]);
  const [callNote, setCallNote] = useState("");

  const loadCalls = useCallback(async () => {
    try {
      const r = await fetch(`/api/reci/cases/${row.id}/calls`, { cache: "no-store" });
      const j = await r.json();
      setCalls(Array.isArray(j.calls) ? j.calls : []);
    } catch {
      setCalls([]);
    }
  }, [row.id]);
  useEffect(() => { void loadCalls(); }, [loadCalls]);

  async function patch(body: Record<string, unknown>, okMsg: string) {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/reci/cases/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) setMsg(`Failed: ${j.error || r.statusText}`);
      else { setMsg(okMsg); onChanged(); }
    } catch (e) {
      setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function addCall() {
    setBusy(true); setMsg(null);
    try {
      const r = await fetch(`/api/reci/cases/${row.id}/calls`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ called_on: callDate, outcome: callOutcome, note: callNote || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) setMsg(`Failed: ${j.error || r.statusText}`);
      else {
        setCallNote("");
        setMsg("Call logged.");
        await loadCalls();
        onChanged();
      }
    } catch (e) {
      setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  const canEdit = resp.canEdit;

  return (
    <div className="grid gap-4 p-4 lg:grid-cols-2">
      {msg && <div className="lg:col-span-2 rounded bg-slate-900 px-3 py-2 text-sm text-white">{msg}</div>}

      {/* Call log */}
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">
          Call log {calls ? `(${calls.length})` : ""}
        </div>
        {calls === null ? (
          <div className="text-sm text-slate-400">Loading…</div>
        ) : calls.length === 0 ? (
          <div className="text-sm text-slate-400">No calls logged yet.</div>
        ) : (
          <ol className="mb-3 max-h-48 space-y-1 overflow-y-auto">
            {calls.map((c) => (
              <li key={c.id} className="rounded border border-slate-100 bg-slate-50 px-2 py-1 text-sm">
                <span className="font-medium">{fmtDate(c.called_on)}</span>
                <span className="mx-1.5 text-slate-400">·</span>
                {c.outcome}
                {c.note && <span className="ml-1.5 text-xs text-slate-500">{c.note}</span>}
                <span className="ml-1.5 text-xs text-slate-400">({c.actor})</span>
              </li>
            ))}
          </ol>
        )}
        {canEdit && (
          <div className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-2 text-sm">
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
              Date
              <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)}
                className="rounded border border-slate-300 px-2 py-1 text-sm" />
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
              Outcome
              <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1 text-sm">
                {CALL_OUTCOMES.map((o) => <option key={o} value={o}>{o}</option>)}
              </select>
            </label>
            <input value={callNote} onChange={(e) => setCallNote(e.target.value)} placeholder="Note (optional)"
              className="min-w-32 flex-1 rounded border border-slate-300 px-2 py-1 text-sm" />
            <button type="button" onClick={addCall} disabled={busy}
              className="rounded border border-slate-900 bg-slate-900 px-3 py-1 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
              Log call
            </button>
          </div>
        )}
      </div>

      {/* Outcome + resold details */}
      <div className="rounded border border-slate-200 bg-white p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">Outcome</div>
        {row.cancellation_notes && (
          <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-900">
            Cancellation notes: {row.cancellation_notes}
          </div>
        )}
        {!canEdit ? (
          <div className="text-sm text-slate-500">
            {row.resold_outcome
              ? <>Recorded as <strong>{RESOLD_OUTCOME_LABELS[row.resold_outcome]}</strong>{row.resold_recorded_by ? ` by ${row.resold_recorded_by}` : ""}.</>
              : "No outcome recorded yet."}
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
              Outcome
              <select value={outcome} onChange={(e) => setOutcome(e.target.value)}
                className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
                <option value="">Not yet resolved</option>
                <option value="resold">Resold</option>
                <option value="pm">P&amp;M (pitch and miss)</option>
              </select>
            </label>
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
              Replacement / policy details
              <textarea rows={2} value={details} onChange={(e) => setDetails(e.target.value)}
                placeholder="New provider, policy number, terms..."
                className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                New commission sold £
                <input type="number" min="0" step="0.01" value={newComm} onChange={(e) => setNewComm(e.target.value)}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
              </label>
              <label className="flex flex-col gap-0.5 text-xs text-slate-500">
                Clawback saved £ {resp.canEditClawbackSaved ? "" : "(senior admin only)"}
                <input type="number" min="0" step="0.01" value={cbSaved}
                  onChange={(e) => setCbSaved(e.target.value)}
                  disabled={!resp.canEditClawbackSaved}
                  className="rounded border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100 disabled:text-slate-400" />
              </label>
            </div>
            <label className="flex flex-col gap-0.5 text-xs text-slate-500">
              Notes
              <textarea rows={2} value={rNotes} onChange={(e) => setRNotes(e.target.value)}
                placeholder="Anything else worth recording..."
                className="rounded border border-slate-300 px-2 py-1.5 text-sm" />
            </label>
            <button
              type="button"
              disabled={busy}
              onClick={() => {
                const body: Record<string, unknown> = {
                  resold_outcome: outcome === "" ? null : outcome,
                  resold_details: details,
                  resold_new_commission: newComm === "" ? null : Number(newComm),
                  resold_notes: rNotes,
                };
                if (resp.canEditClawbackSaved) body.clawback_saved = cbSaved === "" ? null : Number(cbSaved);
                void patch(body, outcome === "resold" ? "Saved. Case marked as Resolved." : "Saved.");
              }}
              className="rounded border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-50"
            >
              Save outcome
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// In processing tab
// ---------------------------------------------------------------------------

const IN_PROC_TARGETS: DealStatus[] = ["in_processing", "not_yet_submitted", "on_risk_nyp", "paid"];

function InProcessingTable({ data, expanded, setExpanded, onChanged }: {
  data: Resp;
  expanded: number | null;
  setExpanded: (id: number | null) => void;
  onChanged: () => void;
}) {
  const showAdviserCol = data.scope === "all";
  if (data.rows.length === 0) {
    return <div className="rounded-lg border bg-white p-6 text-sm text-slate-500">No in-processing cases for {data.year}.</div>;
  }
  return (
    <section className="overflow-hidden rounded-lg border bg-white shadow-sm">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
            <tr>
              {showAdviserCol && <th className="px-3 py-2 text-left">Adviser</th>}
              <th className="px-3 py-2 text-left">Client</th>
              <th className="px-3 py-2 text-left">Postcode</th>
              <th className="px-3 py-2 text-left">Week</th>
              <th className="px-3 py-2 text-left">Status</th>
              <th className="px-3 py-2 text-right">Commission at risk</th>
              <th className="px-3 py-2 text-left">Notes</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <Fragment key={r.id}>
                <tr onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                  className="cursor-pointer border-t border-slate-100 hover:bg-slate-50">
                  {showAdviserCol && <td className="px-3 py-2 text-slate-600">{r.adviser_name}</td>}
                  <td className="px-3 py-2 font-medium">{r.client}</td>
                  <td className="px-3 py-2">{r.postcode || "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{r.week}</td>
                  <td className="px-3 py-2">
                    <span className="rounded bg-blue-100 px-2 py-0.5 text-xs font-medium text-blue-800">
                      {STATUS_LABELS[r.status]}
                      {r.in_processing_stage ? ` · ${r.in_processing_stage.toUpperCase()}` : ""}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums font-medium">{gbp(r.commission)}</td>
                  <td className="max-w-64 truncate px-3 py-2 text-xs text-slate-500">{r.notes || "—"}</td>
                  <td className="px-2 py-2 text-slate-400">{expanded === r.id ? "▴" : "▾"}</td>
                </tr>
                {expanded === r.id && (
                  <tr className="border-t border-slate-200 bg-slate-50/70">
                    <td colSpan={showAdviserCol ? 8 : 7} className="p-0">
                      <InProcessingDetail row={r} resp={data} onChanged={onChanged} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InProcessingDetail({ row, resp, onChanged }: { row: CaseRow; resp: Resp; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [status, setStatus] = useState<DealStatus>(row.status);
  const [note, setNote] = useState("");

  async function save() {
    setBusy(true); setMsg(null);
    try {
      const body: Record<string, unknown> = {};
      if (status !== row.status) body.status = status;
      if (note.trim()) body.note = note.trim();
      if (Object.keys(body).length === 0) { setMsg("Nothing to save."); setBusy(false); return; }
      const r = await fetch(`/api/reci/cases/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) setMsg(`Failed: ${j.error || r.statusText}`);
      else { setNote(""); setMsg("Saved."); onChanged(); }
    } catch (e) {
      setMsg(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-2 p-4 text-sm">
      {msg && <div className="rounded bg-slate-900 px-3 py-2 text-white">{msg}</div>}
      {row.notes && (
        <div className="whitespace-pre-wrap rounded border border-slate-200 bg-white px-3 py-2 text-xs text-slate-600">
          {row.notes}
        </div>
      )}
      {resp.canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-0.5 text-xs text-slate-500">
            Status
            <select value={status} onChange={(e) => setStatus(e.target.value as DealStatus)}
              className="rounded border border-slate-300 bg-white px-2 py-1.5 text-sm">
              {IN_PROC_TARGETS.map((s) => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </label>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note..."
            className="min-w-48 flex-1 rounded border border-slate-300 px-2 py-1.5 text-sm" />
          <button type="button" onClick={save} disabled={busy}
            className="rounded border border-slate-900 bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-700 disabled:opacity-50">
            Save
          </button>
        </div>
      ) : (
        <div className="text-xs text-slate-500">Read-only view.</div>
      )}
    </div>
  );
}
