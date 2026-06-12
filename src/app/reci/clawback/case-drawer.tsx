"use client";

/**
 * Case-detail drawer for the Clawback Dashboard.
 *
 * Slides in from the right when Pauline / Jimmy clicks a case row.
 * Shows the full case header, current workflow state, action buttons
 * (Notify CAM / Change status / Add note / Log contact / Record £ off),
 * and a chronological history timeline.
 *
 * Each action is a small inline form that calls a single API endpoint
 * and then reloads the case + history. The parent <ClawbackPage /> is
 * told via onChange so the table + summary tiles refresh in sync.
 */
import { useCallback, useEffect, useState } from "react";

type Status = "open" | "saved" | "resold" | "dead" | "reinstated" | "closed";
type Bucket = "adviser" | "xstaff" | "legacy" | "needs_review";
type MoneyKind = "saved" | "resold" | "reinstated_cancelled";

export interface DrawerCaseRow {
  id: number;
  policy_number: string;
  provider: string;
  client_name: string;
  client_dob: string | null;
  postcode: string | null;
  policy_type: string | null;
  net_premium: string | null;
  clawback_due: string | null;
  openwork_clawback_due: string | null;
  openwork_cb_updated_by: string | null;
  openwork_cb_updated_at: string | null;
  effective_clawback_due: string | null;
  clawback_date: string | null;
  policy_start_date: string | null;
  off_risk_date: string | null;
  ebah_agent_name: string;
  master_agent_no: string | null;
  agent_no: string | null;
  ebah_warning: string | null;
  status: Status;
  status_note: string | null;
  saved_amount: string | null;
  resold_amount: string | null;
  net_at_risk: string | null;
  notification_week: number | null;
  adviser_id: number | null;
  adviser_name: string | null;
  agent_bucket: Bucket;
  updated_at: string;
}

interface HistoryRow {
  id: number;
  event_type: string;
  field: string | null;
  old_value: string | null;
  new_value: string | null;
  amount: number | null;
  money_kind: string | null;
  note: string | null;
  actor: string;
  created_at: string;
}

const STATUS_LABELS: Record<Status, string> = {
  open: "Open",
  saved: "Saved",
  resold: "Resold",
  dead: "Dead in water",
  reinstated: "Reinstated",
  closed: "Closed",
};
const STATUS_CLS: Record<Status, string> = {
  open:       "bg-slate-100 text-slate-700",
  saved:      "bg-emerald-100 text-emerald-800",
  resold:     "bg-blue-100 text-blue-800",
  dead:       "bg-red-100 text-red-800",
  reinstated: "bg-amber-100 text-amber-800",
  closed:     "bg-slate-200 text-slate-600",
};

function gbp(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CaseDrawer({ row, canEdit, canNotify, canEditOpenworkCb, onClose, onChange }: {
  row: DrawerCaseRow;
  canEdit: boolean;
  canNotify: boolean;
  canEditOpenworkCb: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  // Open form (only one at a time)
  type Panel = null | "status" | "note" | "contact" | "money" | "notify" | "openwork";
  const [panel, setPanel] = useState<Panel>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/history`, { cache: "no-store" });
      const j = await r.json();
      setHistory(j.history || []);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [row.id]);

  useEffect(() => { void loadHistory(); }, [loadHistory]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000); }

  async function patchStatus(newStatus: Status, note: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ status: newStatus, status_note: note || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        const emailNote = j.email
          ? j.email.sent ? " · resolved email sent" : ` · email NOT sent (${j.email.reason})`
          : "";
        flash(`Status set to ${STATUS_LABELS[newStatus]}${emailNote}`);
        await loadHistory();
        onChange();
      }
    } catch (e) {
      flash(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setPanel(null);
    }
  }

  async function postEvent(body: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/events`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        flash("Saved.");
        await loadHistory();
        onChange();
      }
    } catch (e) {
      flash(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setPanel(null);
    }
  }

  async function notify(note: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/notify`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Notify failed: ${j.reason || j.error || r.statusText}`);
      } else {
        flash("Notification email sent.");
        await loadHistory();
        onChange();
      }
    } catch (e) {
      flash(`Notify failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setPanel(null);
    }
  }

  async function saveOpenworkCb(amount: number | null, note: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/openwork-cb`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, note: note || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        flash(amount === null ? "Openwork CB cleared." : `Openwork CB set to ${amount.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}.`);
        await loadHistory();
        onChange();
      }
    } catch (e) {
      flash(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setPanel(null);
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-slate-900/40" onClick={onClose} />
      <aside className="fixed inset-y-0 right-0 z-50 flex w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl">
        <header className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-5 py-4">
          <div className="min-w-0">
            <div className="text-xs uppercase tracking-wide text-slate-500">
              {row.provider.toUpperCase()} · Policy {row.policy_number}
            </div>
            <h2 className="truncate text-lg font-semibold">{row.client_name}</h2>
            <div className="mt-0.5 text-xs text-slate-500">
              {row.postcode || "—"} · {row.policy_type || "—"}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-slate-500 hover:bg-slate-100"
            aria-label="Close"
          >
            ✕
          </button>
        </header>

        {toast && (
          <div className="mx-5 mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white">
            {toast}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 px-5 pt-4">
          <Stat
            label={row.openwork_clawback_due !== null ? "CB due £ (Openwork)" : "CB due £"}
            value={gbp(row.effective_clawback_due ?? row.clawback_due)}
            accent="amber"
            subline={row.openwork_clawback_due !== null
              ? <>Provider: {gbp(row.clawback_due)}</>
              : null}
          />
          <Stat label="Net at risk £" value={gbp(row.net_at_risk)} accent={Number(row.net_at_risk || 0) > 0 ? "amber" : "green"} />
          <Stat label="Saved £" value={gbp(row.saved_amount)} accent="green" />
          <Stat label="Resold £" value={gbp(row.resold_amount)} accent="blue" />
        </div>

        {canEditOpenworkCb && (
          <div className="mt-3 px-5">
            <div className="flex items-center justify-between rounded border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-blue-900">Openwork CB:</span>{" "}
                {row.openwork_clawback_due !== null
                  ? <strong>{gbp(row.openwork_clawback_due)}</strong>
                  : <span className="text-slate-500">not set (using provider {gbp(row.clawback_due)})</span>}
                {row.openwork_cb_updated_at && (
                  <span className="ml-2 text-xs text-slate-500">
                    last set by {row.openwork_cb_updated_by} on {new Date(row.openwork_cb_updated_at).toLocaleDateString("en-GB")}
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setPanel("openwork")}
                className="rounded border border-blue-300 bg-white px-3 py-1 text-xs font-medium text-blue-800 hover:bg-blue-100"
              >
                {row.openwork_clawback_due !== null ? "Edit" : "Set"}
              </button>
            </div>
          </div>
        )}

        <section className="mt-4 grid grid-cols-2 gap-3 px-5 text-sm">
          <FieldRow label="DOB" value={row.client_dob || "—"} />
          <FieldRow label="Sales agent" value={row.ebah_agent_name} />
          <FieldRow label="Bucket" value={row.agent_bucket === "adviser" && row.adviser_name ? row.adviser_name : row.agent_bucket} />
          <FieldRow label="Master Agent" value={row.master_agent_no || "—"} mono />
          <FieldRow label="Agent No" value={row.agent_no || "—"} mono />
          <FieldRow label="Warning" value={row.ebah_warning || "—"} />
          <FieldRow label="CB date" value={row.clawback_date || "—"} />
          <FieldRow label="Policy start" value={row.policy_start_date || "—"} />
          <FieldRow label="Off-risk" value={row.off_risk_date || "—"} />
          <FieldRow label="Net premium" value={gbp(row.net_premium)} />
          <FieldRow label="Updated" value={new Date(row.updated_at).toLocaleString("en-GB")} />
        </section>

        <section className="mt-5 px-5">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm text-slate-600">
              Current status:{" "}
              <span className={`ml-1 inline-block rounded px-2 py-0.5 text-xs font-medium ${STATUS_CLS[row.status]}`}>
                {STATUS_LABELS[row.status]}
              </span>
              {row.status_note && (
                <span className="ml-2 text-xs text-slate-500">&ldquo;{row.status_note}&rdquo;</span>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <ActionBtn label="Change status" onClick={() => setPanel("status")} />
                {canNotify && (
                  <ActionBtn
                    label={row.status === "open" ? "Notify CAM" : "Re-notify CAM"}
                    onClick={() => setPanel("notify")}
                    accent="amber"
                  />
                )}
                <ActionBtn label="Add note" onClick={() => setPanel("note")} />
                <ActionBtn label="Log contact" onClick={() => setPanel("contact")} />
                <ActionBtn label="Record £ off" onClick={() => setPanel("money")} accent="green" />
              </>
            ) : (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                Read-only view. Status updates are made by the assigned CAM or Pauline.
              </div>
            )}
          </div>
        </section>

        {panel === "status" && (
          <StatusForm
            current={row.status}
            busy={busy}
            onCancel={() => setPanel(null)}
            onSubmit={patchStatus}
          />
        )}
        {panel === "note" && (
          <NoteForm
            busy={busy}
            label="Note"
            placeholder="Free-text note that goes into the case timeline..."
            onCancel={() => setPanel(null)}
            onSubmit={(note) => postEvent({ kind: "note", note })}
          />
        )}
        {panel === "contact" && (
          <ContactForm
            busy={busy}
            onCancel={() => setPanel(null)}
            onSubmit={(outcome, note) => postEvent({ kind: "contact_attempt", outcome, note })}
          />
        )}
        {panel === "money" && (
          <MoneyForm
            busy={busy}
            onCancel={() => setPanel(null)}
            onSubmit={(amount, money_kind, note) => postEvent({ kind: "money_off", amount, money_kind, note })}
          />
        )}
        {panel === "notify" && (
          <NoteForm
            busy={busy}
            label="Optional note to the CAM"
            placeholder="Anything Pauline wants the CAM to know before they ring the client..."
            submitLabel={row.status === "open" ? "Send notification" : "Send re-notification"}
            onCancel={() => setPanel(null)}
            onSubmit={notify}
          />
        )}
        {panel === "openwork" && (
          <OpenworkForm
            busy={busy}
            currentAmount={row.openwork_clawback_due}
            providerAmount={row.clawback_due}
            onCancel={() => setPanel(null)}
            onSubmit={saveOpenworkCb}
          />
        )}

        <section className="mt-6 border-t border-slate-200 px-5 py-4">
          <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-600">History</h3>
          {historyLoading ? (
            <div className="text-sm text-slate-400">Loading...</div>
          ) : history.length === 0 ? (
            <div className="text-sm text-slate-400">No events yet.</div>
          ) : (
            <ol className="space-y-2">
              {history.map((h) => <HistoryRowView key={h.id} h={h} />)}
            </ol>
          )}
        </section>
      </aside>
    </>
  );
}

function Stat({ label, value, accent, subline }: { label: string; value: string; accent?: "green" | "amber" | "blue"; subline?: React.ReactNode }) {
  const cls =
    accent === "green" ? "border-emerald-200 bg-emerald-50" :
    accent === "amber" ? "border-amber-200 bg-amber-50" :
    accent === "blue"  ? "border-blue-200 bg-blue-50" :
    "border-slate-200 bg-white";
  return (
    <div className={`rounded border p-3 ${cls}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-base font-semibold">{value}</div>
      {subline && <div className="mt-0.5 text-xs text-slate-500">{subline}</div>}
    </div>
  );
}

function FieldRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-xs uppercase tracking-wide text-slate-500">{label}</span>
      <span className={mono ? "font-mono text-xs" : ""}>{value}</span>
    </div>
  );
}

function ActionBtn({ label, onClick, accent }: { label: string; onClick: () => void; accent?: "amber" | "green" }) {
  const cls =
    accent === "amber" ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100" :
    accent === "green" ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" :
    "border-slate-300 bg-white text-slate-700 hover:bg-slate-50";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded border px-3 py-1.5 text-sm font-medium ${cls}`}
    >
      {label}
    </button>
  );
}

function StatusForm({ current, busy, onCancel, onSubmit }: { current: Status; busy: boolean; onCancel: () => void; onSubmit: (s: Status, note: string) => void }) {
  const [newStatus, setNewStatus] = useState<Status>(current);
  const [note, setNote] = useState("");
  const needsNote = newStatus !== current && newStatus !== "open";
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(newStatus, note); }}
      className="mx-5 mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">New status</span>
        <select
          value={newStatus}
          onChange={(e) => setNewStatus(e.target.value as Status)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          {(Object.keys(STATUS_LABELS) as Status[]).map((k) => (
            <option key={k} value={k}>{STATUS_LABELS[k]}</option>
          ))}
        </select>
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">
          Note {needsNote && <span className="text-amber-600">(recommended)</span>}
        </span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={needsNote ? "What happened? (saved by adviser, client passed away, etc.)" : ""}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Save status" />
    </form>
  );
}

function NoteForm({ busy, label, placeholder, submitLabel, onCancel, onSubmit }: {
  busy: boolean;
  label: string;
  placeholder: string;
  submitLabel?: string;
  onCancel: () => void;
  onSubmit: (note: string) => void;
}) {
  const [note, setNote] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(note); }}
      className="mx-5 mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={placeholder}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel={submitLabel || "Save"} />
    </form>
  );
}

function ContactForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (outcome: string, note: string) => void }) {
  const [outcome, setOutcome] = useState("Called client - spoke");
  const [note, setNote] = useState("");
  const presets = [
    "Called client - spoke",
    "Called client - left voicemail",
    "Called client - no answer",
    "Texted client",
    "Emailed client",
    "Other (typed below)",
  ];
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(outcome, note); }}
      className="mx-5 mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
    >
      <label className="flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Contact outcome</span>
        <select
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        >
          {presets.map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Note</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Any detail about the call..."
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Log contact" />
    </form>
  );
}

function MoneyForm({ busy, onCancel, onSubmit }: { busy: boolean; onCancel: () => void; onSubmit: (amount: number, money_kind: MoneyKind, note: string) => void }) {
  const [amount, setAmount] = useState("");
  const [moneyKind, setMoneyKind] = useState<MoneyKind>("saved");
  const [note, setNote] = useState("");
  const n = Number(amount);
  const valid = Number.isFinite(n) && n > 0;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(n, moneyKind, note); }}
      className="mx-5 mt-3 rounded border border-slate-200 bg-slate-50 p-3 text-sm"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Amount £</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Kind</span>
          <select
            value={moneyKind}
            onChange={(e) => setMoneyKind(e.target.value as MoneyKind)}
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          >
            <option value="saved">Saved (CB not taken)</option>
            <option value="resold">Resold (replacement sale credit)</option>
            <option value="reinstated_cancelled">Reinstated then cancelled again</option>
          </select>
        </label>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Note</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? e.g. adviser DD reinstated, new policy ref..."
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Record" disabled={!valid} />
    </form>
  );
}

function OpenworkForm({ busy, currentAmount, providerAmount, onCancel, onSubmit }: {
  busy: boolean;
  currentAmount: string | null;
  providerAmount: string | null;
  onCancel: () => void;
  onSubmit: (amount: number | null, note: string) => void;
}) {
  const [amount, setAmount] = useState(currentAmount ?? "");
  const [note, setNote] = useState("");
  const trimmed = amount.trim();
  const next = trimmed === "" ? null : Number(trimmed);
  const valid = trimmed === "" || (Number.isFinite(next) && (next as number) >= 0);
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(next, note); }}
      className="mx-5 mt-3 rounded border border-blue-200 bg-blue-50 p-3 text-sm"
    >
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Openwork CB £</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Leave blank to clear"
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Provider (L&amp;G)</span>
          <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-600">
            {providerAmount === null
              ? "—"
              : Number(providerAmount).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 })}
          </div>
        </div>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Reconciliation note (optional)</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why is the Openwork figure different? (Old OW reduced rate, New OW correction, etc.)"
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel={trimmed === "" ? "Clear override" : "Save Openwork CB"}
        disabled={!valid}
      />
    </form>
  );
}

function FormActions({ busy, onCancel, submitLabel, disabled }: { busy: boolean; onCancel: () => void; submitLabel: string; disabled?: boolean }) {
  return (
    <div className="mt-3 flex justify-end gap-2">
      <button
        type="button"
        onClick={onCancel}
        className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100"
        disabled={busy}
      >
        Cancel
      </button>
      <button
        type="submit"
        className="rounded bg-slate-900 px-3 py-1.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        disabled={busy || disabled}
      >
        {busy ? "Working..." : submitLabel}
      </button>
    </div>
  );
}

function HistoryRowView({ h }: { h: HistoryRow }) {
  const when = new Date(h.created_at).toLocaleString("en-GB");
  let line: React.ReactNode = null;
  switch (h.event_type) {
    case "created":
      line = <>Case created from EBAH upload</>;
      break;
    case "ebah_change":
      line = (
        <>L&amp;G changed <code className="text-xs">{h.field}</code>: <s className="text-slate-400">{h.old_value || "—"}</s> → <strong>{h.new_value || "—"}</strong></>
      );
      break;
    case "status_change":
      line = (
        <>Status: <s className="text-slate-400">{h.old_value}</s> → <strong>{h.new_value}</strong></>
      );
      break;
    case "note":
      line = <>Note</>;
      break;
    case "contact_attempt":
      line = <>Contact attempt</>;
      break;
    case "money_off":
      line = <>£ off recorded: <strong>{gbp(h.amount)}</strong> ({h.money_kind})</>;
      break;
    case "email_sent":
      line = <>Email sent</>;
      break;
    default:
      line = <>{h.event_type}</>;
  }
  return (
    <li className="rounded border border-slate-200 bg-white p-3 text-sm">
      <div className="flex items-baseline justify-between gap-3">
        <div className="font-medium text-slate-800">{line}</div>
        <div className="whitespace-nowrap text-xs text-slate-500">{when}</div>
      </div>
      {h.note && (
        <div className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{h.note}</div>
      )}
      <div className="mt-0.5 text-xs text-slate-500">by {h.actor}</div>
    </li>
  );
}
