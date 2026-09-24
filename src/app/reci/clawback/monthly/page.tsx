"use client";

/**
 * CB by month (Poz, 24 Sep 2026). One simple table for Guy: forecast CB,
 * actual CB taken and forecast not taken, month by month with YTD.
 * Poz's admin layer sits underneath: an Old OW / New OW split toggle,
 * inline entry of the actual figures from the Openwork portal, and a
 * click-to-open list of each month's forecast cases (opening the usual
 * case drawer) so she never has to hunt through the master list.
 *
 * Printing gives the headline table plus only the months left open.
 */
import { Fragment, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PrintButton, PrintHeader } from "@/components/print";
import { CaseDrawer, type DrawerCaseRow } from "../case-drawer";
import { NewCaseModal } from "../new-case-modal";
import { statusGroup, statusLabel } from "@/lib/reci/status";

interface Split { total: number; old: number; new: number; untagged: number }
interface Actual {
  total: number; old: number | null; new: number | null;
  note: string | null; updated_by: string | null; updated_at: string | null;
}
interface MonthRow {
  month: number; key: string; label: string; cases: number;
  forecast: Split; notTaken: Split; actual: Actual | null;
}
interface RangeRow {
  months: number; cases: number; forecast: Split; notTaken: Split;
  actual: { total: number; old: number | null; new: number | null; monthsEntered: number };
}
interface Resp { year: number; canEdit: boolean; months: MonthRow[]; ytd: RangeRow; fullYear: RangeRow }

interface Me {
  canEditAnyCase?: boolean; isClawbackAdmin?: boolean; canNotifyCam?: boolean;
}

function gbp(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
}

export default function ClawbackMonthlyPage() {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [data, setData] = useState<Resp | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [split, setSplit] = useState(false);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [editing, setEditing] = useState<number | null>(null);
  const [me, setMe] = useState<Me | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    fetch("/api/me", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null)).then(setMe).catch(() => setMe(null));
  }, []);

  const load = useCallback(async () => {
    setError(null);
    try {
      const r = await fetch(`/api/reci/clawback/monthly?year=${year}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 403 ? "You don't have access to this report." : `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "load failed");
    }
  }, [year]);
  useEffect(() => { void load(); }, [load]);

  const refreshAll = () => { void load(); setReloadKey((k) => k + 1); };

  const toggle = (m: number) => setOpen((prev) => {
    const next = new Set(prev);
    if (next.has(m)) next.delete(m); else next.add(m);
    return next;
  });

  const now = new Date();
  const currentKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const colsPer = split ? 3 : 1;

  return (
    <main className="mx-auto max-w-[1300px] px-4 py-4">
      <PrintHeader
        title="Clawback by month"
        subtitle={`${year} · forecast vs actual CB taken`}
        meta={[{ label: "View", value: split ? "Old / New OW split" : "Totals" }]}
      />

      <div className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <h1 className="text-2xl font-bold">Clawback by month</h1>
          <p className="text-sm text-slate-600">Forecast CB, actual CB taken and forecast not taken, {year}</p>
        </div>
        <div className="no-print flex flex-wrap items-center gap-2 text-sm">
          <Link href="/reci/clawback" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Dashboard</Link>
          <Link href="/reci/clawback/credit-report" className="rounded border border-slate-300 px-3 py-1 text-slate-700 hover:bg-slate-50">Credit Control report</Link>
          <label className="flex items-center gap-1">
            <span className="text-slate-600">Year</span>
            <input type="number" value={year}
              onChange={(e) => { setYear(Number(e.target.value) || now.getFullYear()); setOpen(new Set()); }}
              className="w-20 rounded border border-slate-300 px-2 py-1 text-right" />
          </label>
          <label className="flex items-center gap-2 rounded border border-slate-300 px-3 py-1">
            <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
            <span>Old / New OW split</span>
          </label>
          <PrintButton />
        </div>
      </div>

      {error && <div className="mt-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">{error}</div>}
      {!data && !error && <div className="mt-6 text-sm text-slate-400">Loading…</div>}

      {data && (
        <>
          <div className="mt-4 overflow-x-auto rounded border border-slate-300 bg-white">
            <table className="w-full border-collapse text-sm tabular-nums">
              <thead>
                <tr className="bg-slate-900 text-xs uppercase tracking-wide text-white">
                  <th rowSpan={split ? 2 : 1} className="px-3 py-2 text-left">Month</th>
                  <th colSpan={colsPer} className="border-l border-slate-700 px-3 py-2 text-right">Forecast CB</th>
                  <th colSpan={colsPer} className="border-l border-slate-700 px-3 py-2 text-right">Actual CB taken</th>
                  <th colSpan={colsPer} className="border-l border-slate-700 px-3 py-2 text-right">Forecast not taken</th>
                </tr>
                {split && (
                  <tr className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                    {[0, 1, 2].map((g) => (
                      <Fragment key={g}>
                        <th className="border-l border-slate-300 px-3 py-1 text-right">Total</th>
                        <th className="px-3 py-1 text-right">Old OW</th>
                        <th className="px-3 py-1 text-right">New OW</th>
                      </Fragment>
                    ))}
                  </tr>
                )}
              </thead>
              <tbody>
                {data.months.map((m) => {
                  const isOpen = open.has(m.month);
                  const isCurrent = m.key === currentKey;
                  const isFuture = m.key > currentKey;
                  return (
                    <Fragment key={m.month}>
                      <tr
                        onClick={() => m.cases > 0 && toggle(m.month)}
                        className={`border-t border-slate-200 ${m.cases > 0 ? "cursor-pointer hover:bg-slate-50" : ""} ${isCurrent ? "bg-amber-50" : ""} ${isOpen ? "bg-slate-100" : ""}`}
                      >
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          <span className="no-print mr-1 inline-block w-3 text-slate-400">{m.cases > 0 ? (isOpen ? "▾" : "▸") : ""}</span>
                          {m.label}
                          {isCurrent && <span className="ml-2 text-[10px] font-semibold uppercase text-amber-700">this month</span>}
                        </td>
                        <SplitCells s={m.forecast} split={split} dim={m.cases === 0} />
                        <ActualCells
                          m={m} split={split} isFuture={isFuture} canEdit={data.canEdit}
                          onEdit={() => setEditing(m.month)}
                        />
                        <SplitCells s={m.notTaken} split={split} dim={m.notTaken.total === 0} tone="green" />
                      </tr>
                      {editing === m.month && (
                        <tr className="no-print bg-amber-50">
                          <td colSpan={1 + colsPer * 3} className="px-3 py-3">
                            <ActualEditor
                              year={data.year} month={m.month} label={m.label} actual={m.actual}
                              onDone={(changed) => { setEditing(null); if (changed) void load(); }}
                            />
                          </td>
                        </tr>
                      )}
                      {isOpen && (
                        <tr>
                          <td colSpan={1 + colsPer * 3} className="bg-slate-50 px-3 py-3">
                            <MonthDetail key={`${m.key}-${reloadKey}`} month={m} me={me} onChanged={refreshAll} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                <TotalRow label={`YTD (${data.ytd.months} month${data.ytd.months === 1 ? "" : "s"})`} r={data.ytd} split={split} strong />
                {data.fullYear.months !== data.ytd.months && (
                  <TotalRow label="Full year" r={data.fullYear} split={split} />
                )}
              </tbody>
            </table>
          </div>

          <div className="mt-3 space-y-1 text-xs text-slate-500">
            <p><strong className="text-slate-700">Forecast CB</strong>: everything L&amp;G forecast to claw back in that month, whatever happened to it since.</p>
            <p><strong className="text-slate-700">Actual CB taken</strong>: what Openwork actually took that month, entered from the Openwork portal.</p>
            <p><strong className="text-slate-700">Forecast not taken</strong>: forecast cases that were saved (reinstated, resold, premiums brought up to date and so on).</p>
            <p className="no-print">Click a month to see its cases. Cases with no clawback date are not in any month (see Unscheduled on the Credit Control report).</p>
          </div>
        </>
      )}
    </main>
  );
}

function SplitCells({ s, split, dim, tone }: { s: Split; split: boolean; dim?: boolean; tone?: "green" }) {
  const cls = `px-3 py-2 text-right ${dim ? "text-slate-300" : tone === "green" ? "text-emerald-700" : ""}`;
  if (!split) return <td className={`border-l border-slate-200 ${cls}`}>{gbp(s.total)}</td>;
  return (
    <>
      <td className={`border-l border-slate-200 font-medium ${cls}`}>
        {gbp(s.total)}
        {s.untagged > 0 && (
          <div className="text-[10px] font-normal text-amber-700" title="Cases with no Old/New OW tag. Set it from the case.">
            incl. {gbp(s.untagged)} untagged
          </div>
        )}
      </td>
      <td className={cls}>{gbp(s.old)}</td>
      <td className={cls}>{gbp(s.new)}</td>
    </>
  );
}

function ActualCells({ m, split, isFuture, canEdit, onEdit }: {
  m: MonthRow; split: boolean; isFuture: boolean; canEdit: boolean; onEdit: () => void;
}) {
  const a = m.actual;
  const editBtn = canEdit && !isFuture ? (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onEdit(); }}
      className="no-print ml-2 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[10px] font-medium text-slate-600 hover:bg-slate-100"
    >
      {a ? "Edit" : "Enter"}
    </button>
  ) : null;
  const totalCell = (
    <td className="whitespace-nowrap border-l border-slate-200 px-3 py-2 text-right font-semibold text-red-700">
      {a ? gbp(a.total) : <span className="font-normal text-slate-300">{isFuture ? "" : "not entered"}</span>}
      {editBtn}
    </td>
  );
  if (!split) return totalCell;
  const missing = a && a.old === null;
  return (
    <>
      {totalCell}
      <td className="px-3 py-2 text-right text-red-700">
        {a ? (missing ? <span className="text-[11px] text-amber-700">split not entered</span> : gbp(a.old)) : ""}
      </td>
      <td className="px-3 py-2 text-right text-red-700">{a && !missing ? gbp(a.new) : ""}</td>
    </>
  );
}

function TotalRow({ label, r, split, strong }: { label: string; r: RangeRow; split: boolean; strong?: boolean }) {
  const base = `px-3 py-2 text-right ${strong ? "font-bold" : "font-semibold text-slate-600"}`;
  const splitCells = (s: Split, tone?: string) => split ? (
    <>
      <td className={`border-l border-slate-300 ${base} ${tone ?? ""}`}>{gbp(s.total)}</td>
      <td className={`${base} ${tone ?? ""}`}>{gbp(s.old)}</td>
      <td className={`${base} ${tone ?? ""}`}>{gbp(s.new)}</td>
    </>
  ) : <td className={`border-l border-slate-300 ${base} ${tone ?? ""}`}>{gbp(s.total)}</td>;
  return (
    <tr className={`border-t-2 border-slate-900 ${strong ? "bg-slate-100" : "bg-white"}`}>
      <td className={`px-3 py-2 text-left ${strong ? "font-bold" : "font-semibold text-slate-600"}`}>{label}</td>
      {splitCells(r.forecast)}
      {split ? (
        <>
          <td className={`border-l border-slate-300 ${base} text-red-700`}>{gbp(r.actual.total)}</td>
          <td className={`${base} text-red-700`}>{r.actual.old === null ? <span className="text-[11px] font-normal text-amber-700">split incomplete</span> : gbp(r.actual.old)}</td>
          <td className={`${base} text-red-700`}>{r.actual.new === null ? "" : gbp(r.actual.new)}</td>
        </>
      ) : <td className={`border-l border-slate-300 ${base} text-red-700`}>{gbp(r.actual.total)}</td>}
      {splitCells(r.notTaken, "text-emerald-700")}
    </tr>
  );
}

function ActualEditor({ year, month, label, actual, onDone }: {
  year: number; month: number; label: string; actual: Actual | null;
  onDone: (changed: boolean) => void;
}) {
  const [total, setTotal] = useState(actual ? String(actual.total) : "");
  const [old, setOld] = useState(actual?.old !== null && actual?.old !== undefined ? String(actual.old) : "");
  const [note, setNote] = useState(actual?.note ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const num = (s: string) => Number(s.replace(/[£,\s]/g, ""));
  const newOw = total.trim() && old.trim() && Number.isFinite(num(total)) && Number.isFinite(num(old))
    ? num(total) - num(old) : null;

  async function save(clear = false) {
    setBusy(true); setErr(null);
    try {
      const r = await fetch("/api/reci/clawback/monthly", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(clear ? { year, month, total: null } : { year, month, total, old_ow: old, note }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      onDone(true);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-end gap-3 text-sm">
      <div className="font-semibold text-slate-800">Actual CB taken, {label}</div>
      <label className="flex flex-col">
        <span className="text-[11px] text-slate-600">Total £</span>
        <input autoFocus value={total} onChange={(e) => setTotal(e.target.value)} inputMode="decimal"
          className="w-32 rounded border border-slate-300 px-2 py-1 text-right" />
      </label>
      <label className="flex flex-col">
        <span className="text-[11px] text-slate-600">of which Old OW £</span>
        <input value={old} onChange={(e) => setOld(e.target.value)} inputMode="decimal" placeholder="optional"
          className="w-32 rounded border border-slate-300 px-2 py-1 text-right" />
      </label>
      <div className="flex flex-col">
        <span className="text-[11px] text-slate-600">New OW £</span>
        <span className="w-32 py-1 text-right tabular-nums text-slate-700">{newOw === null ? "—" : gbp(newOw)}</span>
      </div>
      <label className="flex min-w-[200px] flex-1 flex-col">
        <span className="text-[11px] text-slate-600">Note (optional)</span>
        <input value={note} onChange={(e) => setNote(e.target.value)}
          className="rounded border border-slate-300 px-2 py-1" />
      </label>
      <button type="button" disabled={busy || !total.trim()} onClick={() => save()}
        className="rounded bg-slate-900 px-3 py-1.5 font-medium text-white hover:bg-slate-800 disabled:opacity-50">
        Save
      </button>
      {actual && (
        <button type="button" disabled={busy} onClick={() => { if (confirm(`Clear the actual CB for ${label}?`)) void save(true); }}
          className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50 disabled:opacity-50">
          Clear
        </button>
      )}
      <button type="button" disabled={busy} onClick={() => onDone(false)}
        className="rounded border border-slate-300 px-3 py-1.5 text-slate-700 hover:bg-slate-100">
        Cancel
      </button>
      {actual?.updated_by && (
        <span className="text-[11px] text-slate-500">
          Last saved by {actual.updated_by}
          {actual.updated_at ? ` on ${new Date(actual.updated_at).toLocaleDateString("en-GB")}` : ""}
        </span>
      )}
      {err && <span className="w-full text-xs text-red-700">{err}</span>}
    </div>
  );
}

function MonthDetail({ month, me, onChanged }: { month: MonthRow; me: Me | null; onChanged: () => void }) {
  const [rows, setRows] = useState<DrawerCaseRow[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openCase, setOpenCase] = useState<DrawerCaseRow | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const [y, m] = month.key.split("-").map(Number);
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const qs = new URLSearchParams({
      cb_due_from: `${month.key}-01`,
      cb_due_to: `${month.key}-${String(last).padStart(2, "0")}`,
      sort: "cb_desc",
      limit: "1000",
    });
    try {
      const r = await fetch(`/api/reci/clawback/cases?${qs}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      setRows((j.cases ?? []) as DrawerCaseRow[]);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [month.key]);
  useEffect(() => { void load(); }, [load]);

  const visible = (rows ?? []).filter((c) => c.status !== "closed");

  return (
    <div className="print-keep">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-slate-800">
          {month.label}: {visible.length} case{visible.length === 1 ? "" : "s"} forecast
          <span className="ml-2 font-normal text-slate-500">
            forecast {gbp(month.forecast.total)} · not taken {gbp(month.notTaken.total)}
            {month.actual ? ` · actual taken ${gbp(month.actual.total)}` : ""}
          </span>
        </div>
        {me?.isClawbackAdmin && (
          <button type="button" onClick={() => setAdding(true)}
            className="no-print rounded border border-indigo-300 bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-800 hover:bg-indigo-100">
            + Add case
          </button>
        )}
      </div>
      {err && <div className="text-sm text-red-700">{err}</div>}
      {!rows && !err && <div className="text-sm text-slate-400">Loading cases…</div>}
      {rows && (
        <table className="w-full border-collapse overflow-hidden rounded border border-slate-200 bg-white text-xs">
          <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
            <tr>
              <th className="px-2 py-1.5 text-left">Client</th>
              <th className="px-2 py-1.5 text-left">Policy</th>
              <th className="px-2 py-1.5 text-left">Seller</th>
              <th className="px-2 py-1.5 text-left">OW</th>
              <th className="px-2 py-1.5 text-left">CB date</th>
              <th className="px-2 py-1.5 text-right">Forecast CB</th>
              <th className="px-2 py-1.5 text-left">Status</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((c) => {
              const g = statusGroup(c.status);
              const tint = g === "pos" ? "bg-emerald-50" : g === "neg" ? "bg-red-50" : "";
              return (
                <tr key={c.id} onClick={() => setOpenCase(c)}
                  className={`cursor-pointer border-t border-slate-100 hover:bg-indigo-50 ${tint}`}>
                  <td className="px-2 py-1.5 font-medium">{c.client_name}</td>
                  <td className="px-2 py-1.5 font-mono">{c.policy_number}</td>
                  <td className="px-2 py-1.5">{c.adviser_name ?? (c.agent_bucket === "xstaff" ? "Xstaff" : c.agent_bucket === "legacy" ? "Legacy" : "Needs review")}</td>
                  <td className="px-2 py-1.5">
                    {c.source === "old_ow" ? "Old OW" : c.source === "new_ow" ? "New OW" : <span className="text-amber-700">untagged</span>}
                  </td>
                  <td className="px-2 py-1.5">{c.clawback_date ? new Date(c.clawback_date).toLocaleDateString("en-GB") : "—"}</td>
                  <td className="px-2 py-1.5 text-right font-semibold tabular-nums">{gbp(Number(c.effective_clawback_due) || 0)}</td>
                  <td className="px-2 py-1.5">{statusLabel(c.status)}</td>
                </tr>
              );
            })}
            {visible.length === 0 && (
              <tr><td colSpan={7} className="px-2 py-3 text-center text-slate-400">No cases forecast this month.</td></tr>
            )}
          </tbody>
        </table>
      )}

      {openCase && (
        <div className="no-print">
          <CaseDrawer
            row={openCase}
            canEdit={me?.canEditAnyCase ?? false}
            ownerLabel={openCase.adviser_name ?? (openCase.agent_bucket === "xstaff" ? "Xstaff" : openCase.agent_bucket === "legacy" ? "Legacy" : "team")}
            canNotify={me?.canNotifyCam ?? false}
            canEditFinalCb={me?.isClawbackAdmin ?? false}
            canEditDetails={me?.isClawbackAdmin ?? false}
            onClose={() => setOpenCase(null)}
            onChange={onChanged}
          />
        </div>
      )}
      {adding && (
        <div className="no-print">
          <NewCaseModal onClose={() => setAdding(false)} onSaved={onChanged} />
        </div>
      )}
    </div>
  );
}
