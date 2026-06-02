"use client";

/**
 * Shared deal modal components, extracted from the per-adviser RECI board so
 * the Analytics page can also open the edit modal in-place.
 *
 * Exports:
 *  - EditDealModal: edit an existing deal (PATCH /api/reci/deals/[id])
 *  - NewDealModal:  create a deal for an adviser (POST /api/reci/[slug])
 *
 * Internal:
 *  - DealFormModal: the actual modal UI shared by both
 *  - Field:         small label wrapper
 */
import { useRef, useState } from "react";
import {
  DEAL_STATUSES, STATUS_LABELS, type Deal,
  CANCELLATION_REASONS, CANCELLATION_REASON_LABELS,
  IN_PROCESSING_STAGES, IN_PROCESSING_STAGE_LABELS,
} from "@/lib/reci/schema";
import { isoWeekNumber } from "@/lib/schema";

export function NewDealModal({ slug, year, onClose }: { slug: string; year: number; onClose: () => void }) {
  // Default to the current ISO week in London time so Pauline doesn't have to
  // calculate it. If she's adding a deal for a different week she can still
  // edit the field.
  return <DealFormModal
    title="New deal"
    initial={{ client: "", week: isoWeekNumber(), status: "not_yet_submitted", commission: 0, year }}
    allowAddAnother
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

export function EditDealModal({ deal, onClose }: { deal: Deal; onClose: () => void }) {
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

function DealFormModal({ title, initial, canDelete, allowAddAnother, onSubmit, onDelete, onClose }: {
  title: string;
  initial: Partial<Deal> & { year?: number };
  canDelete?: boolean;
  /** Show a "Save and add another" button. Used by NewDealModal so Pauline can
   *  enter multiple policies for one client without retyping client-level
   *  fields (client, postcode, week, listened-to, confirmed date, etc.). */
  allowAddAnother?: boolean;
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
    cancellation_reason: initial.cancellation_reason ?? "",
    cancellation_notes:  initial.cancellation_notes ?? "",
    in_processing_stage: initial.in_processing_stage ?? "",
  });
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // "Save and add another" mode: which button triggered the submit, and how
  // many deals we've already saved in this modal session (shown in the banner).
  const continueModeRef = useRef(false);
  const [savedCount, setSavedCount] = useState(0);
  const [lastSavedClient, setLastSavedClient] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true); setErr(null);
    const wasContinue = continueModeRef.current;
    continueModeRef.current = false;
    try {
      await onSubmit(form);
      if (wasContinue) {
        // Keep the modal open: increment counter and reset only per-policy
        // fields. Client-level fields stay so Pauline can enter the next
        // policy for the same person without retyping their info.
        setSavedCount((c) => c + 1);
        setLastSavedClient(String(form.client || "this client"));
        setForm((f) => ({
          ...f,
          no_of_deals: 1,
          provider: "",
          premium: "",
          acc_ref: "",
          status: "not_yet_submitted",
          commission: 0,
          notes: "",
          gl_sp: "",
          gl_txt: "",
          trust_done: "",
          trust_sent: "",
          cancellation_reason: "",
          cancellation_notes: "",
          in_processing_stage: "",
          // KEEP: client, postcode, week, poz_listened, miscellaneous,
          //       confirmed_date, submitted, year
        }));
      } else {
        onClose();
      }
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "save failed");
    } finally {
      setSaving(false);
    }
  }

  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const isCancelled    = form.status === "cancelled";
  const isInProcessing = form.status === "in_processing";

  return (
    <div className="fixed inset-0 bg-black/30 flex items-start md:items-center justify-center z-50 p-4 overflow-y-auto">
      <form onSubmit={submit} className="bg-white rounded-lg shadow-xl w-full max-w-3xl">
        <header className="px-4 py-3 border-b flex items-center justify-between">
          <h2 className="font-semibold">
            {title}
            {savedCount > 0 && (
              <span className="ml-2 text-xs font-normal text-emerald-700">
                {savedCount} saved so far
              </span>
            )}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </header>
        {allowAddAnother && savedCount > 0 && lastSavedClient && (
          <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm text-emerald-800">
            ✓ Saved deal {savedCount} for <strong>{lastSavedClient}</strong>. Client details are kept below — enter the next policy and Save again.
          </div>
        )}
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

          {isInProcessing && (
            <Field label="In Processing stage" className="col-span-4">
              <select value={form.in_processing_stage} onChange={set("in_processing_stage")} className="w-full border rounded px-2 py-1">
                <option value="">— pick a stage —</option>
                {IN_PROCESSING_STAGES.map((s) => (
                  <option key={s} value={s}>{IN_PROCESSING_STAGE_LABELS[s]}</option>
                ))}
              </select>
            </Field>
          )}

          {isCancelled && (
            <>
              <Field label="Cancellation reason" className="col-span-2">
                <select value={form.cancellation_reason} onChange={set("cancellation_reason")} className="w-full border rounded px-2 py-1">
                  <option value="">—</option>
                  {CANCELLATION_REASONS.map(r => (
                    <option key={r} value={r}>{CANCELLATION_REASON_LABELS[r]}</option>
                  ))}
                </select>
              </Field>
              <Field label="Cancellation notes" className="col-span-4">
                <textarea value={form.cancellation_notes} onChange={set("cancellation_notes")} rows={2}
                          className="w-full border rounded px-2 py-1" />
              </Field>
            </>
          )}

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
            <button type="button" onClick={onClose} className="text-sm px-3 py-2 text-slate-600 hover:text-slate-900">
              {savedCount > 0 ? "Done" : "Cancel"}
            </button>
            {allowAddAnother && (
              <button
                type="submit"
                disabled={saving}
                onClick={() => { continueModeRef.current = true; }}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                title="Save this deal and keep the modal open so you can add another for the same client"
              >
                {saving ? "Saving…" : "Save and add another"}
              </button>
            )}
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
