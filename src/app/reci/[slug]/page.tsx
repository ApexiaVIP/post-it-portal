"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useSearchParams, useRouter, usePathname } from "next/navigation";
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
  CANCELLATION_REASONS, CANCELLATION_REASON_LABELS, CANCELLATION_REASON_SHORT,
  type CancellationReason,
} from "@/lib/reci/schema";
import { PrintButton, PrintHeader } from "@/components/print";
import { NewDealModal, EditDealModal } from "@/components/deal-modal";

type Tracker = { week: number; paid: number; on_risk_nyp: number; in_processing: number; nys: number; cxl: number; total: number }[];

type CancellationWeek = {
  week: number; npw: number; postponed: number; declined: number; other: number; total: number; commission: number;
};
type CancellationDeal = {
  id: number; client: string; week: number; commission: number;
  reason: CancellationReason | null; notes: string | null;
  cancelled_at: string | null; cancelled_by: string | null; provider: string | null;
};
type Cancellations = { weeks: CancellationWeek[]; deals: CancellationDeal[] };

type BundleResp = { adviser: Adviser; deals: Deal[]; tracker: Tracker; cancellations: Cancellations; year: number };

function gbp(n: number | string | null | undefined) {
  const v = Number(n || 0);
  return v.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
}

export default function AdviserKanbanPage() {
  const { slug } = useParams<{ slug: string }>();
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const [data, setData] = useState<BundleResp | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [activeDealId, setActiveDealId] = useState<number | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [cancelling, setCancelling] = useState<{ deal: Deal } | null>(null);
  // Edit modal opened via ?openDeal=<id> in the URL (drill-through from the
  // Analytics Deals table).
  const [editFromUrl, setEditFromUrl] = useState<Deal | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/reci/${slug}?year=${year}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = (await r.json()) as BundleResp;
      setData(j);
    } catch (e) { setErr(e instanceof Error ? e.message : "load failed"); }
  }, [slug, year]);

  useEffect(() => { load(); }, [load]);

  // If the URL carries ?year=<n>, sync the picker to it. This is set by the
  // Analytics drill-through so the page lands on the same year as the
  // analytics filter.
  useEffect(() => {
    const y = searchParams?.get("year");
    if (!y) return;
    const yNum = Number(y);
    if (Number.isFinite(yNum) && yNum !== year) setYear(yNum);
  }, [searchParams, year]);

  // When data finishes loading (or the URL changes), open the deal requested
  // by ?openDeal=<id>. If the deal isn't in scope for the current year, clear
  // the param.
  useEffect(() => {
    if (!data) return;
    const idStr = searchParams?.get("openDeal");
    if (!idStr) { setEditFromUrl(null); return; }
    const id = Number(idStr);
    if (!Number.isFinite(id)) return;
    const found = data.deals.find((x) => x.id === id);
    if (found) {
      setEditFromUrl(found);
    } else {
      // Not in this year's loaded set — clear the param to avoid a stale URL.
      router.replace(pathname);
    }
  }, [data, searchParams, router, pathname]);

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

  async function moveStatus(dealId: number, newStatus: DealStatus, extra?: { reason?: CancellationReason; notes?: string }) {
    // optimistic update
    setData((d) => d && ({ ...d, deals: d.deals.map(x => x.id === dealId ? { ...x, status: newStatus } : x) }));
    const r = await fetch(`/api/reci/deals/${dealId}/status`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: newStatus, ...(extra ?? {}) }),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert(`Move failed: ${j.error || `HTTP ${r.status}`}`);
      load();
      return;
    }
    load(); // refresh tracker + cancellations
  }

  function onDragStart(e: DragStartEvent) {
    setActiveDealId(Number(e.active.id));
  }
  function onDragEnd(e: DragEndEvent) {
    setActiveDealId(null);
    const dealId = Number(e.active.id);
    const overId = e.over?.id;
    if (!overId) return;
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
    // Intercept move-to-cancelled — open the reason modal first.
    if (newStatus === "cancelled") {
      setCancelling({ deal: currentDeal });
      return;
    }
    moveStatus(dealId, newStatus);
  }

  const activeDeal = activeDealId ? data?.deals.find(d => d.id === activeDealId) : null;

  if (err) return <main className="p-8 text-red-600">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;

  return (
    <main className="max-w-[1800px] mx-auto p-4 md:p-6 space-y-6">
      <PrintHeader
        title={`${data.adviser.name} — RECI`}
        subtitle={`Year ${year}`}
        meta={[
          { label: "Adviser", value: data.adviser.name },
          { label: "Year",    value: String(year) },
        ]}
      />
      <header className="no-print flex items-center justify-between gap-4 flex-wrap">
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
          <PrintButton />
          <Link href="/reci/analytics" className="text-sm text-blue-600 hover:text-blue-800">Analytics →</Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-700 underline">POST IT Admin</Link>
        </div>
      </header>

      <div className="no-print">
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
      </div>

      <BusinessTracker tracker={data.tracker} />

      <CancellationsBlock cancellations={data.cancellations} year={year} />

      {showNew && <NewDealModal slug={slug} year={year} onClose={() => { setShowNew(false); load(); }} />}

      {cancelling && (
        <CancellationModal
          deal={cancelling.deal}
          onClose={() => setCancelling(null)}
          onConfirm={async (reason, notes) => {
            await moveStatus(cancelling.deal.id, "cancelled", { reason, notes });
            setCancelling(null);
          }}
        />
      )}

      {editFromUrl && (
        <EditDealModal
          deal={editFromUrl}
          onClose={() => {
            setEditFromUrl(null);
            // Clean the URL so a refresh doesn't reopen the modal.
            router.replace(pathname);
            load();
          }}
        />
      )}
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
        {deal.status === "cancelled" && deal.cancellation_reason && (
          <div className="text-xs italic text-rose-600 mt-1 truncate" title={deal.cancellation_notes || ""}>
            {CANCELLATION_REASON_SHORT[deal.cancellation_reason]}
            {deal.cancellation_notes ? ` — ${deal.cancellation_notes}` : ""}
          </div>
        )}
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

function CancellationsBlock({ cancellations, year }: { cancellations: Cancellations; year: number }) {
  const totals = cancellations.weeks.reduce(
    (acc, r) => ({
      npw: acc.npw + r.npw, postponed: acc.postponed + r.postponed,
      declined: acc.declined + r.declined, other: acc.other + r.other,
      total: acc.total + r.total, commission: acc.commission + r.commission,
    }),
    { npw: 0, postponed: 0, declined: 0, other: 0, total: 0, commission: 0 },
  );
  return (
    <section className="bg-white shadow rounded-lg overflow-x-auto">
      <h2 className="text-lg font-medium p-4 border-b">Cancellations</h2>
      {cancellations.weeks.length === 0 ? (
        <p className="px-4 py-6 text-sm text-slate-500">No cancellations on file for {year}.</p>
      ) : (
        <>
          <table className="w-full text-sm">
            <thead className="bg-slate-100">
              <tr>
                <th className="text-left px-3 py-2">Week</th>
                <th className="text-right px-3 py-2">NPW</th>
                <th className="text-right px-3 py-2">Postponed</th>
                <th className="text-right px-3 py-2">Declined</th>
                <th className="text-right px-3 py-2">Other</th>
                <th className="text-right px-3 py-2">Total</th>
                <th className="text-right px-3 py-2">Commission £</th>
              </tr>
            </thead>
            <tbody>
              {cancellations.weeks.map((r) => (
                <tr key={r.week} className="border-t border-slate-100">
                  <td className="px-3 py-2">Week {r.week}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{r.npw}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{r.postponed}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{r.declined}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{r.other}</td>
                  <td className="text-right px-3 py-2 tabular-nums font-medium">{r.total}</td>
                  <td className="text-right px-3 py-2 tabular-nums">{gbp(r.commission)}</td>
                </tr>
              ))}
              <tr className="bg-slate-100 font-semibold border-t border-slate-200">
                <td className="px-3 py-2">TOTAL</td>
                <td className="text-right px-3 py-2 tabular-nums">{totals.npw}</td>
                <td className="text-right px-3 py-2 tabular-nums">{totals.postponed}</td>
                <td className="text-right px-3 py-2 tabular-nums">{totals.declined}</td>
                <td className="text-right px-3 py-2 tabular-nums">{totals.other}</td>
                <td className="text-right px-3 py-2 tabular-nums">{totals.total}</td>
                <td className="text-right px-3 py-2 tabular-nums">{gbp(totals.commission)}</td>
              </tr>
            </tbody>
          </table>
          <details className="px-4 py-3 border-t">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Show all cancelled deals ({cancellations.deals.length})</summary>
            <table className="w-full text-sm mt-3">
              <thead className="bg-slate-50">
                <tr>
                  <th className="text-left px-3 py-2">Client</th>
                  <th className="text-left px-3 py-2">Week</th>
                  <th className="text-left px-3 py-2">Provider</th>
                  <th className="text-left px-3 py-2">Reason</th>
                  <th className="text-left px-3 py-2">Notes</th>
                  <th className="text-left px-3 py-2">When</th>
                  <th className="text-right px-3 py-2">£</th>
                </tr>
              </thead>
              <tbody>
                {cancellations.deals.map((d) => (
                  <tr key={d.id} className="border-t border-slate-100">
                    <td className="px-3 py-2">{d.client}</td>
                    <td className="px-3 py-2">Week {d.week}</td>
                    <td className="px-3 py-2">{d.provider || "—"}</td>
                    <td className="px-3 py-2">{d.reason ? CANCELLATION_REASON_SHORT[d.reason] : "—"}</td>
                    <td className="px-3 py-2 max-w-[28ch] truncate" title={d.notes || ""}>{d.notes || "—"}</td>
                    <td className="px-3 py-2 text-slate-500">{d.cancelled_at ? new Date(d.cancelled_at).toLocaleDateString("en-GB") : "—"}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{gbp(d.commission)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
    </section>
  );
}

function CancellationModal({ deal, onConfirm, onClose }: {
  deal: Deal;
  onConfirm: (reason: CancellationReason, notes: string) => Promise<void>;
  onClose: () => void;
}) {
  const [reason, setReason] = useState<CancellationReason | "">("");
  const [notes, setNotes]   = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!reason) { setErr("Choose a reason"); return; }
    setSaving(true); setErr(null);
    try { await onConfirm(reason as CancellationReason, notes); }
    catch (e2) { setErr(e2 instanceof Error ? e2.message : "save failed"); }
    finally { setSaving(false); }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl w-full max-w-md">
        <header className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">Cancel deal — {deal.client}</h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </header>
        <div className="p-4 space-y-3 text-sm">
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Reason *</span>
            <select required value={reason}
                    onChange={(e) => setReason(e.target.value as CancellationReason)}
                    className="w-full border rounded px-2 py-1">
              <option value="">— Choose —</option>
              {CANCELLATION_REASONS.map(r => (
                <option key={r} value={r}>{CANCELLATION_REASON_LABELS[r]}</option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="block text-xs font-medium text-slate-600 mb-1">Notes</span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3}
                      placeholder="Anything the adviser needs to know to win this back"
                      className="w-full border rounded px-2 py-1" />
          </label>
          <p className="text-xs text-slate-500">
            An email will be sent to the adviser (and CC&apos;d to Pauline / management)
            asking them to call the client back.
          </p>
          {err && <p className="text-sm text-red-600">{err}</p>}
        </div>
        <footer className="px-4 py-3 border-t flex items-center justify-end gap-2">
          <button type="button" onClick={onClose} className="text-sm px-3 py-2 text-slate-600 hover:text-slate-900">
            Cancel
          </button>
          <button type="submit" disabled={saving}
                  className="bg-rose-600 text-white rounded px-4 py-2 text-sm font-medium hover:bg-rose-700 disabled:opacity-50">
            {saving ? "Cancelling…" : "Confirm cancellation"}
          </button>
        </footer>
      </form>
    </div>
  );
}


