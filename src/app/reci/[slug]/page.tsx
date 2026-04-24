"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import {
  DndContext, DragEndEvent, DragOverlay, DragStartEvent,
  PointerSensor, useSensor, useSensors,
} from "@dnd-kit/core";
import { SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { useDroppable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  DEAL_STATUSES, STATUS_LABELS, type DealStatus,
  type Adviser, type Deal,
} from "@/lib/reci/schema";

type Tracker = { week: number; paid: number; on_risk_nyp: number; in_processing: number; nys: number; cxl: number; total: number }[];
type BundleResp = { adviser: Adviser; deals: Deal[]; tracker: Tracker; year: number };

function gbp(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
}

export default function AdviserKanbanPage() {
  const { slug } = useParams<{ slug: string }>();
  const [data, setData] = useState<BundleResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [activeDealId, setActiveDealId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/reci/${slug}?year=${year}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as BundleResp;
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : "load failed"); }
  }, [slug, year]);

  useEffect(() => { load(); }, [load]);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));

  const dealsByStatus = useMemo(() => {
    const out: Record<DealStatus, Deal[]> = {
      not_yet_submitted: [], in_processing: [], on_risk_nyp: [], paid: [], cancelled: [],
    };
    if (!data) return out;
    for (const d of data.deals) out[d.status].push(d);
    for (const s of DEAL_STATUSES) {
      out[s].sort((a, b) => a.week - b.week || a.position - b.position || a.id - b.id);
    }
    return out;
  }, [data]);

  async function moveStatus(dealId: number, newStatus: DealStatus) {
    // optimistic update
    setData((d) => d && ({ ...d, deals: d.deals.map(x => x.id === dealId ? { ...x, status: newStatus } : x) }));
    const r = await fetch(`/api/reci/deals/${dealId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus }),
    });
    if (!r.ok) { alert(`Move failed: HTTP ${r.status}`); load(); return; }
    load(); // refresh tracker too
  }

  function onDragStart(e: DragStartEvent) {
    setActiveDealId(Number(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveDealId(null);
    const dealId = Number(e.active.id);
    const overId = e.over?.id;
    if (!overId) return;
    // overId can be either a status column id ("col:paid") or another deal id
    let newStatus: DealStatus | null = null;
    if (typeof overId === "string" && overId.startsWith("col:")) {
      newStatus = overId.slice(4) as DealStatus;
    } else {
      const targetDeal = data?.deals.find(d => d.id === Number(overId));
      if (targetDeal) newStatus = targetDeal.status;
    }
    if (!newStatus) return;
    const currentDeal = data?.deals.find(d => d.id === dealId);
    if (!currentDeal || currentDeal.status === newStatus) return;
    moveStatus(dealId, newStatus);
  }

  const activeDeal = activeDealId ? data?.deals.find(d => d.id === activeDealId) : null;

  if (err) return <main className="p-8 text-red-600">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;

  return (
    <main className="max-w-[1800px] mx-auto p-4 md:p-6 space-y-6">
      <header className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <Link href="/reci" className="hover:underline">RECI</Link>
            <span>/</span>
            <span>{data.adviser.name}</span>
          </div>
          <h1 className="text-2xl font-semibold">{data.adviser.name} — RECI {year}</h1>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <label className="text-sm flex items-center gap-2">
            <span className="text-slate-600">Year:</span>
            <select value={year} onChange={(e) => setYear(Number(e.target.value))}
                    className="border border-slate-300 rounded px-2 py-1">
              {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </label>
          <button onClick={() => setShowNew(true)}
                  className="bg-slate-900 text-white rounded px-3 py-2 text-sm font-medium hover:bg-slate-800">
            + New deal
          </button>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 underline">POST IT Admin</Link>
        </div>
      </header>

      <DndContext sensors={sensors} onDragStart={onDragStart} onDragEnd={onDragEnd}>
        <div className="grid grid-cols-5 gap-3 min-w-[1200px]">
          {DEAL_STATUSES.map((s) => (
            <StatusColumn key={s} status={s} deals={dealsByStatus[s]} onEdit={load} />
          ))}
        </div>
        <DragOverlay>
          {activeDeal ? <DealCard deal={activeDeal} dragging onEdit={() => {}} /> : null}
        </DragOverlay>
      </DndContext>

      <BusinessTracker tracker={data.tracker} />

      {showNew && <NewDealModal slug={slug} year={year} onClose={() => { setShowNew(false); load(); }} />}
    </main>
  );
}

function StatusColumn({ status, deals, onEdit }: { status: DealStatus; deals: Deal[]; onEdit: () => void }) {
  const { setNodeRef, isOver } = useDroppable({ id: `col:${status}` });
  const total = deals.reduce((s, d) => s + Number(d.commission || 0), 0);
  const colorMap: Record<DealStatus, string> = {
    not_yet_submitted: "bg-slate-100 border-slate-300",
    in_processing: "bg-amber-50 border-amber-300",
    on_risk_nyp: "bg-sky-50 border-sky-300",
    paid: "bg-emerald-50 border-emerald-400",
    cancelled: "bg-rose-50 border-rose-300",
  };
  return (
    <div ref={setNodeRef} className={`rounded-lg border ${colorMap[status]} ${isOver ? "ring-2 ring-slate-400" : ""} min-h-[400px]`}>
      <div className="px-3 py-2 border-b border-slate-200 flex items-center justify-between">
        <div className="font-medium text-sm">{STATUS_LABELS[status]}</div>
        <div className="text-xs text-slate-600 tabular-nums">{deals.length} · {gbp(total)}</div>
      </div>
      <div className="p-2 space-y-2">
        <SortableContext items={deals.map(d => d.id)} strategy={verticalListSortingStrategy}>
          {deals.map(d => <DealCard key={d.id} deal={d} onEdit={onEdit} />)}
        </SortableContext>
        {deals.length === 0 && <p className="text-xs text-slate-400 text-center py-4">Drop here</p>}
      </div>
    </div>
  );
}

function DealCard({ deal, onEdit, dragging }: { deal: Deal; onEdit: () => void; dragging?: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: deal.id });
  const [editing, setEditing] = useState(false);
  const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging || dragging ? 0.5 : 1 };
  return (
    <>
      <div ref={setNodeRef} style={style} {...attributes} {...listeners}
           className="bg-white rounded border border-slate-200 p-2 shadow-sm hover:shadow cursor-grab">
        <div className="flex items-center justify-between">
          <div className="font-medium text-sm">{deal.client}</div>
          <button onClick={(e) => { e.stopPropagation(); setEditing(true); }}
                  onPointerDown={(e) => e.stopPropagation()}
                  className="text-xs text-slate-400 hover:text-slate-700">edit</button>
        </div>
        <div className="text-xs text-slate-500 mt-1">{deal.postcode || "—"} · {deal.provider || "—"}</div>
        <div className="text-xs mt-1 flex justify-between tabular-nums">
          <span className="text-slate-600">Week {deal.week}</span>
          <span className="font-medium">{gbp(deal.commission)}</span>
        </div>
      </div>
      {editing && <EditDealModal deal={deal} onClose={() => { setEditing(false); onEdit(); }} />}
    </>
  );
}

function BusinessTracker({ tracker }: { tracker: Tracker }) {
  const totals = tracker.reduce((acc, r) => ({
    paid: acc.paid + r.paid, on_risk_nyp: acc.on_risk_nyp + r.on_risk_nyp,
    in_processing: acc.in_processing + r.in_processing, nys: acc.nys + r.nys,
    cxl: acc.cxl + r.cxl, total: acc.total + r.total,
  }), { paid: 0, on_risk_nyp: 0, in_processing: 0, nys: 0, cxl: 0, total: 0 });
  const pct = (n: number, d: number) => d > 0 ? `${Math.round(n/d*100)}%` : "–";
  return (
    <section className="bg-white shadow rounded-lg overflow-x-auto">
      <h2 className="text-lg font-medium p-4 border-b">Business Tracker</h2>
      <table className="w-full text-sm">
        <thead className="bg-slate-100">
          <tr>
            <th className="text-left px-3 py-2">Week</th>
            <th className="text-right px-3 py-2">Paid</th>
            <th className="text-right px-3 py-2 text-slate-500">%</th>
            <th className="text-right px-3 py-2">On Risk NYP</th>
            <th className="text-right px-3 py-2 text-slate-500">%</th>
            <th className="text-right px-3 py-2">In Processing</th>
            <th className="text-right px-3 py-2 text-slate-500">%</th>
            <th className="text-right px-3 py-2">Not Yet Submitted</th>
            <th className="text-right px-3 py-2 text-slate-500">%</th>
            <th className="text-right px-3 py-2">Cancelled</th>
            <th className="text-right px-3 py-2 text-slate-500">%</th>
            <th className="text-right px-3 py-2">Total</th>
          </tr>
        </thead>
        <tbody>
          {tracker.map((r) => (
            <tr key={r.week} className="border-t border-slate-100">
              <td className="px-3 py-2">Week {r.week}</td>
              <td className="text-right px-3 py-2 tabular-nums">{gbp(r.paid)}</td>
              <td className="text-right px-3 py-2 text-slate-500">{pct(r.paid, r.total)}</td>
              <td className="text-right px-3 py-2 tabular-nums">{gbp(r.on_risk_nyp)}</td>
              <td className="text-right px-3 py-2 text-slate-500">{pct(r.on_risk_nyp, r.total)}</td>
              <td className="text-right px-3 py-2 tabular-nums">{gbp(r.in_processing)}</td>
              <td className="text-right px-3 py-2 text-slate-500">{pct(r.in_processing, r.total)}</td>
              <td className="text-right px-3 py-2 tabular-nums">{gbp(r.nys)}</td>
              <td className="text-right px-3 py-2 text-slate-500">{pct(r.nys, r.total)}</td>
              <td className="text-right px-3 py-2 tabular-nums">{gbp(r.cxl)}</td>
              <td className="text-right px-3 py-2 text-slate-500">{pct(r.cxl, r.total)}</td>
              <td className="text-right px-3 py-2 tabular-nums font-medium">{gbp(r.total)}</td>
            </tr>
          ))}
          <tr className="bg-slate-100 font-semibold border-t border-slate-200">
            <td className="px-3 py-2">TOTAL</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.paid)}</td>
            <td className="text-right px-3 py-2 text-slate-500">{pct(totals.paid, totals.total)}</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.on_risk_nyp)}</td>
            <td className="text-right px-3 py-2 text-slate-500">{pct(totals.on_risk_nyp, totals.total)}</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.in_processing)}</td>
            <td className="text-right px-3 py-2 text-slate-500">{pct(totals.in_processing, totals.total)}</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.nys)}</td>
            <td className="text-right px-3 py-2 text-slate-500">{pct(totals.nys, totals.total)}</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.cxl)}</td>
            <td className="text-right px-3 py-2 text-slate-500">{pct(totals.cxl, totals.total)}</td>
            <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.total)}</td>
          </tr>
        </tbody>
      </table>
    </section>
  );
}

function NewDealModal({ slug, year, onClose }: { slug: string; year: number; onClose: () => void }) {
  return <DealFormModal
    title="New deal"
    initial={{ client: "", week: 1, status: "not_yet_submitted", commission: 0, year }}
    onSubmit={async (payload) => {
      const r = await fetch(`/api/reci/${slug}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...payload, year }),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }}
    onClose={onClose}
  />;
}

function EditDealModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
  return <DealFormModal
    title="Edit deal"
    initial={deal}
    canDelete
    onSubmit={async (payload) => {
      const r = await fetch(`/api/reci/deals/${deal.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }}
    onDelete={async () => {
      if (!confirm(`Delete ${deal.client}? This cannot be undone.`)) return;
      const r = await fetch(`/api/reci/deals/${deal.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
    }}
    onClose={onClose}
  />;
}

function DealFormModal({ title, initial, canDelete, onSubmit, onDelete, onClose }: {
  title: string;
  initial: Partial<Deal> & { year?: number };
  canDelete?: boolean;
  onSubmit: (payload: Record<string, unknown>) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}) {
  const [form, setForm] = useState<Record<string, any>>({
    client: initial.client ?? "",
    postcode: initial.postcode ?? "",
    no_of_deals: initial.no_of_deals ?? 1,
    provider: initial.provider ?? "",
    premium: initial.premium ?? "",
    confirmed_date: initial.confirmed_date ?? "",
    poz_listened: initial.poz_listened ?? "",
    miscellaneous: initial.miscellaneous ?? "",
    submitted: initial.submitted ?? "",
    acc_ref: initial.acc_ref ?? "",
    status: initial.status ?? "not_yet_submitted",
    commission: initial.commission ?? 0,
    notes: initial.notes ?? "",
    gl_sp: initial.gl_sp ?? "",
    gl_txt: initial.gl_txt ?? "",
    trust_done: initial.trust_done ?? "",
    trust_sent: initial.trust_sent ?? "",
    week: initial.week ?? 1,
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    try { await onSubmit(form); onClose(); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "save failed"); }
    finally { setSaving(false); }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl w-full max-w-3xl">
        <header className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">{title}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </header>
        <div className="p-4 grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <Field label="Client" className="col-span-2" required>
            <input value={form.client} onChange={set("client")} required
                   className="w-full border rounded px-2 py-1" />
          </Field>
          <Field label="Postcode"><input value={form.postcode} onChange={set("postcode")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Week"><input type="number" min={1} max={53} value={form.week} onChange={set("week")} className="w-full border rounded px-2 py-1" /></Field>

          <Field label="Provider"><input value={form.provider} onChange={set("provider")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Premium"><input type="number" step="0.01" value={form.premium} onChange={set("premium")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="No. deals"><input type="number" min={0} value={form.no_of_deals} onChange={set("no_of_deals")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Confirmed date"><input value={form.confirmed_date} onChange={set("confirmed_date")} placeholder="21/4 or 21/4/2026" className="w-full border rounded px-2 py-1" /></Field>

          <Field label="POZ/Pauline listened"><input value={form.poz_listened} onChange={set("poz_listened")} placeholder="Yes/No" className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Miscellaneous"><input value={form.miscellaneous} onChange={set("miscellaneous")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Submitted"><input value={form.submitted} onChange={set("submitted")} placeholder="Yes/No" className="w-full border rounded px-2 py-1" /></Field>
          <Field label="ACC/REF">
            <select value={form.acc_ref} onChange={set("acc_ref")} className="w-full border rounded px-2 py-1">
              <option value="">—</option><option>ACC</option><option>REF</option>
            </select>
          </Field>

          <Field label="Status" className="col-span-2">
            <select value={form.status} onChange={set("status")} className="w-full border rounded px-2 py-1">
              {DEAL_STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
          <Field label="Commission £" className="col-span-2">
            <input type="number" step="0.01" value={form.commission} onChange={set("commission")} className="w-full border rounded px-2 py-1" />
          </Field>

          <Field label="GL SP"><input value={form.gl_sp} onChange={set("gl_sp")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="GL TXT"><input value={form.gl_txt} onChange={set("gl_txt")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Trust done"><input value={form.trust_done} onChange={set("trust_done")} className="w-full border rounded px-2 py-1" /></Field>
          <Field label="Trust sent"><input value={form.trust_sent} onChange={set("trust_sent")} className="w-full border rounded px-2 py-1" /></Field>

          <Field label="Notes" className="col-span-4">
            <textarea value={form.notes} onChange={set("notes")} rows={2} className="w-full border rounded px-2 py-1" />
          </Field>
        </div>
        {err && <p className="text-sm text-red-600 px-4">{err}</p>}
        <footer className="px-4 py-3 border-t flex items-center justify-between">
          {canDelete && onDelete ? (
            <button type="button" onClick={async () => { try { await onDelete(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "delete failed"); } }}
                    className="text-sm text-red-600 hover:underline">Delete</button>
          ) : <span />}
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 text-slate-600 hover:text-slate-900">Cancel</button>
            <button type="submit" disabled={saving}
                    className="bg-slate-900 text-white rounded px-4 py-2 text-sm font-medium hover:bg-slate-800 disabled:opacity-50">
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
        </footer>
      </form>
    </div>
  );
}

function Field({ label, required, className, children }: { label: string; required?: boolean; className?: string; children: React.ReactNode }) {
  return (
    <label className={`block ${className || ""}`}>
      <span className="block text-xs font-medium text-slate-600 mb-1">{label}{required && " *"}</span>
      {children}
    </label>
  );
}
