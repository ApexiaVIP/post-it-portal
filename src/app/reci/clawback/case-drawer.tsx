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
import { fmtDate } from "./format";

type Status = "open" | "saved" | "resold" | "dead" | "reinstated" | "closed";
type Bucket = "adviser" | "xstaff" | "legacy" | "needs_review";
type MoneyKind = "saved" | "resold" | "reinstated_cancelled";

export interface DrawerCaseRow {
  id: number;
  policy_number: string;
  provider: string;
  client_name: string;
  client_first_name: string | null;
  client_last_name: string | null;
  client_dob: string | null;
  client_phone: string | null;
  client_email: string | null;
  postcode: string | null;
  policy_type: string | null;
  net_premium: string | null;
  clawback_due: string | null;
  final_clawback_due: string | null;
  final_cb_updated_by: string | null;
  final_cb_updated_at: string | null;
  effective_clawback_due: string | null;
  source: "old_ow" | "new_ow" | "other" | null;
  source_updated_by: string | null;
  source_updated_at: string | null;
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
  dead: "Lost",
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

/**
 * Per-warning workflow guidance, pulled straight from Pauline's brief.
 * Each entry tells the seller what the warning means and what action
 * Pauline expects them to take. The quick-action buttons open the
 * matching form panel (and pre-set a status when sensible).
 *
 * Key strings match the EBAH "Warning" column verbatim. Anything not in
 * this map renders a generic "log contact / add note" hint so we always
 * give the seller somewhere to start.
 */
type Suggestion = {
  panel: "status" | "note" | "contact" | "money";
  label: string;
  // For status panel: prefilled status to mark.
  prefillStatus?: Status;
  // For money panel: which £ tab to prefill.
  prefillMoneyKind?: MoneyKind;
  accent?: "amber" | "green" | "blue";
};
interface WarningGuide {
  title: string;
  description: string;
  suggestions: Suggestion[];
}
const WARNING_GUIDES: Record<string, WarningGuide> = {
  "Bounced DD": {
    title: "Bounced DD",
    description:
      "L&G will continue attempting to collect premiums until the account is brought up to date. Contact the client and record the outcome. Pauline confirms whether the clawback was ultimately saved via OLPC.",
    suggestions: [
      { panel: "contact", label: "Log call to client" },
      { panel: "note",    label: "Add note" },
    ],
  },
  "Cancelled DD": {
    title: "DD Cancelled",
    description:
      "The direct debit mandate must be reinstated to save this clawback. Once the client has confirmed the DD is back on, mark the case as Saved.",
    suggestions: [
      { panel: "contact", label: "Log call to client" },
      { panel: "status",  label: "Mark as Saved (mandate reinstated)", prefillStatus: "saved", accent: "green" },
    ],
  },
  "Cancelled from outset": {
    title: "CFO (Cancelled From Outset)",
    description:
      "Critical. The policy cancelled within the first 30 days after going live. Take immediate action to attempt to re-sell and save the impending clawback. If a replacement sale lands, record the resold amount.",
    suggestions: [
      { panel: "contact", label: "Log call to client" },
      { panel: "money",   label: "Record £ saved",  prefillMoneyKind: "saved",  accent: "green" },
      { panel: "money",   label: "Record £ resold", prefillMoneyKind: "resold", accent: "blue" },
    ],
  },
  "Lapse": {
    title: "Lapsed",
    description:
      "A lapse generally has one of two causes: three months or more of premium arrears, OR the client cancelled the policy after the cooling-off period (mid-term, or at a time of their choosing). Some providers will allow reinstatement, others won't -- check before promising the client anything. Record the saved amount if reinstated, or the resold amount if replaced with a new sale.",
    suggestions: [
      { panel: "contact", label: "Log call to client" },
      { panel: "money",   label: "Record £ saved (reinstated)", prefillMoneyKind: "saved",  accent: "green" },
      { panel: "money",   label: "Record £ resold (new sale)", prefillMoneyKind: "resold", accent: "blue" },
    ],
  },
  "Increasing cover review": {
    title: "Increasing cover review",
    description:
      "L&G is reviewing an increase in cover. No CB action is required unless the review results in a cancellation or DD issue. Log a note if you've spoken to the client.",
    suggestions: [
      { panel: "note", label: "Add note" },
    ],
  },
  "5 yearly review": {
    title: "5-yearly review",
    description:
      "Routine review notification. No CB action required unless flagged by Pauline.",
    suggestions: [
      { panel: "note", label: "Add note" },
    ],
  },
  "Death claim in progress": {
    title: "Death claim in progress",
    description:
      "Sensitive case. Do not contact the client. Pauline will manage this with L&G.",
    suggestions: [
      { panel: "note", label: "Add note for Pauline" },
    ],
  },
  "Death claim accepted": {
    title: "Death claim accepted",
    description: "Claim has been accepted by L&G. No CB action.",
    suggestions: [
      { panel: "status", label: "Close case", prefillStatus: "closed" },
    ],
  },
  "Death claim declined": {
    title: "Death claim declined",
    description: "Claim has been declined by L&G. Pauline will advise on next steps.",
    suggestions: [
      { panel: "note", label: "Add note for Pauline" },
    ],
  },
  "DD representation": {
    title: "DD representation",
    description:
      "L&G is re-attempting the direct debit. No immediate action required unless the re-attempt also fails.",
    suggestions: [
      { panel: "note", label: "Add note" },
    ],
  },
};
const GENERIC_GUIDE: WarningGuide = {
  title: "Workflow",
  description:
    "Pauline hasn't set specific guidance for this warning yet. Contact the client where appropriate and log the outcome.",
  suggestions: [
    { panel: "contact", label: "Log contact" },
    { panel: "note",    label: "Add note" },
  ],
};

function gbp(v: string | number | null | undefined) {
  if (v === null || v === undefined || v === "") return "—";
  const n = typeof v === "string" ? Number(v) : v;
  if (!Number.isFinite(n)) return "—";
  return n.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function CaseDrawer({ row, canEdit, needsGate, ownerLabel, canNotify, canEditFinalCb, canEditDetails, onClose, onChange }: {
  row: DrawerCaseRow;
  canEdit: boolean;
  /**
   * When true, the action panel sits behind a "Take action on this case"
   * confirm button. Junior sellers (Gurdaht, Atikur) get this on their
   * own cases so each save is deliberate. Resets every time the drawer
   * is reopened.
   */
  needsGate?: boolean;
  /** Display label for the owning seller (Tan, Hayder, Xstaff, etc). */
  ownerLabel?: string;
  canNotify: boolean;
  canEditFinalCb: boolean;
  /** Admin only: gates the "Edit case details" button + form. */
  canEditDetails: boolean;
  onClose: () => void;
  onChange: () => void;
}) {
  const [history, setHistory] = useState<HistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  // Verification gate: true means actions are unlocked. Resets to false
  // every time the drawer is opened on a new case (parent unmounts +
  // remounts the component when openCase changes).
  const [unlocked, setUnlocked] = useState(!needsGate);

  // Open form (only one at a time). Prefill state lets the warning-guide
  // buttons launch a panel with a sensible starting point (e.g. status =
  // 'saved' for "Mark mandate reinstated").
  type Panel = null | "status" | "note" | "contact" | "money" | "notify" | "final" | "lost" | "details" | "delete";
  const [panel, setPanel] = useState<Panel>(null);
  const [statusPrefill, setStatusPrefill] = useState<Status | null>(null);
  const [moneyPrefill, setMoneyPrefill] = useState<MoneyKind | null>(null);

  function openPanel(p: Panel) {
    setStatusPrefill(null);
    setMoneyPrefill(null);
    setPanel(p);
  }
  function applySuggestion(s: { panel: Panel; prefillStatus?: Status; prefillMoneyKind?: MoneyKind }) {
    setStatusPrefill(s.prefillStatus ?? null);
    setMoneyPrefill(s.prefillMoneyKind ?? null);
    setPanel(s.panel);
  }

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

  // Sibling policies for the same client. Used by the Add note and Log
  // contact forms so the lads can tick "also apply to these" instead
  // of typing the same note into every policy. Loaded once when the
  // drawer opens; not needed for money_off (each policy has its own £).
  const [siblings, setSiblings] = useState<SiblingCase[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/reci/clawback/cases/${row.id}/siblings`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        setSiblings(Array.isArray(j?.siblings) ? j.siblings : []);
      })
      .catch(() => { if (!cancelled) setSiblings([]); });
    return () => { cancelled = true; };
  }, [row.id]);

  function flash(msg: string) { setToast(msg); setTimeout(() => setToast(null), 4000); }

  async function patchStatus(newStatus: Status, note: string, lostReason?: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          status: newStatus,
          status_note: note || undefined,
          lost_reason: lostReason || undefined,
        }),
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

  async function saveSource(next: "old_ow" | "new_ow" | "other" | null) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/source`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ source: next }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        flash(next === null ? "Source cleared." : `Source set to ${next === "old_ow" ? "Old OW" : next === "new_ow" ? "New OW" : "Other"}.`);
        await loadHistory();
        onChange();
      }
    } catch (e) {
      flash(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  }

  async function saveFinalCb(amount: number | null, note: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/final-cb`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amount, note: note || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        flash(amount === null ? "Final CB cleared." : `Final CB set to ${amount.toLocaleString("en-GB", { style: "currency", currency: "GBP" })}.`);
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

  async function deleteCase(reason: string) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}`, {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ reason: reason || undefined }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
        return;
      }
      // Tell parent to refresh + close the drawer (case is now hidden).
      onChange();
      onClose();
    } catch (e) {
      flash(`Failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
      setPanel(null);
    }
  }

  async function saveDetails(patch: Record<string, unknown>) {
    setBusy(true);
    try {
      const r = await fetch(`/api/reci/clawback/cases/${row.id}/details`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patch),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        flash(`Failed: ${j.error || r.statusText}`);
      } else {
        flash("Case details updated.");
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

  // Adviser list for the routing dropdown in EditDetailsForm. Loaded once
  // the first time the user opens the Edit panel.
  const [advisers, setAdvisers] = useState<{ id: number; name: string }[] | null>(null);
  useEffect(() => {
    if (panel !== "details" || advisers !== null) return;
    let cancelled = false;
    fetch("/api/reci/clawback/advisers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (cancelled) return;
        if (j && Array.isArray(j.advisers)) {
          setAdvisers(j.advisers as { id: number; name: string }[]);
        } else {
          setAdvisers([]);
        }
      })
      .catch(() => { if (!cancelled) setAdvisers([]); });
    return () => { cancelled = true; };
  }, [panel, advisers]);

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
            label={row.final_clawback_due !== null ? "CB due £ (Final)" : "CB due £"}
            value={gbp(row.effective_clawback_due ?? row.clawback_due)}
            accent={row.final_clawback_due !== null ? "green" : "amber"}
            subline={row.final_clawback_due !== null ? <>Provider: {gbp(row.clawback_due)}</> : null}
          />
          {(() => {
            const cb     = Number(row.effective_clawback_due ?? row.clawback_due ?? 0);
            const saved  = Number(row.saved_amount ?? 0);
            const resold = Number(row.resold_amount ?? 0);
            // Net position = CB minus everything recovered. Can go
            // negative when the resell covers more than the clawback
            // (Poz's Lucena case: -£620.93 = £620.93 profit on the swap).
            const netPos = cb - saved - resold;
            const inProfit = netPos < 0;
            return (
              <Stat
                label={inProfit ? "Net profit £" : "Net at risk £"}
                value={gbp(Math.abs(netPos).toFixed(2))}
                accent={inProfit ? "green" : netPos > 0 ? "amber" : "green"}
                subline={
                  saved > 0 || resold > 0
                    ? <>CB {gbp(cb)} - saved {gbp(saved)} - resold {gbp(resold)}</>
                    : null
                }
              />
            );
          })()}
          <Stat label="Saved £" value={gbp(row.saved_amount)} accent="green" />
          <Stat label="Resold £" value={gbp(row.resold_amount)} accent="blue" />
        </div>

        {canEditFinalCb && (
          <div className="mt-3 px-5">
            <div className="flex items-center justify-between gap-3 rounded border border-purple-200 bg-purple-50 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-purple-900">Source:</span>{" "}
                {row.source === null
                  ? <span className="text-slate-500">not yet flagged (Old OW / New OW / Other)</span>
                  : <strong>{row.source === "old_ow" ? "Old OW" : row.source === "new_ow" ? "New OW" : "Other"}</strong>}
                {row.source_updated_at && (
                  <span className="ml-2 text-xs text-slate-500">
                    set by {row.source_updated_by} on {new Date(row.source_updated_at).toLocaleDateString("en-GB")}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1">
                <SourceBtn label="Old OW" active={row.source === "old_ow"} onClick={() => saveSource("old_ow")} disabled={busy} />
                <SourceBtn label="New OW" active={row.source === "new_ow"} onClick={() => saveSource("new_ow")} disabled={busy} />
                <SourceBtn label="Other"  active={row.source === "other"}  onClick={() => saveSource("other")}  disabled={busy} />
                {row.source !== null && (
                  <button
                    type="button"
                    onClick={() => saveSource(null)}
                    disabled={busy}
                    className="rounded px-2 py-1 text-xs text-slate-500 hover:bg-slate-100"
                    title="Clear flag"
                  >
                    ✕
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {canEditFinalCb && (
          <>
            <div className="mt-3 px-5">
              <div className="flex items-center justify-between rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm">
                <div>
                  <span className="font-medium text-emerald-900">Final CB:</span>{" "}
                  {row.final_clawback_due !== null
                    ? <strong>{gbp(row.final_clawback_due)}</strong>
                    : <span className="text-slate-500">not set (using provider {gbp(row.clawback_due)})</span>}
                  {row.final_cb_updated_at && (
                    <span className="ml-2 text-xs text-slate-500">
                      last set by {row.final_cb_updated_by} on {new Date(row.final_cb_updated_at).toLocaleDateString("en-GB")}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPanel(panel === "final" ? null : "final")}
                  className="rounded border border-emerald-400 bg-white px-3 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100"
                >
                  {panel === "final" ? "Cancel" : row.final_clawback_due !== null ? "Edit" : "Set"}
                </button>
              </div>
            </div>
            {panel === "final" && (
              <FinalCbForm
                busy={busy}
                currentAmount={row.final_clawback_due}
                providerAmount={row.clawback_due}
                onCancel={() => setPanel(null)}
                onSubmit={saveFinalCb}
              />
            )}
          </>
        )}

        <section className="mt-4 grid grid-cols-2 gap-3 px-5 text-sm">
          <FieldRow label="DOB" value={fmtDate(row.client_dob)} />
          <FieldRow label="Sales agent" value={row.ebah_agent_name} />
          <FieldRow label="Bucket" value={row.agent_bucket === "adviser" && row.adviser_name ? row.adviser_name : row.agent_bucket} />
          <FieldRow label="Master Agent" value={row.master_agent_no || "—"} mono />
          <FieldRow label="Agent No" value={row.agent_no || "—"} mono />
          <FieldRow label="Warning" value={row.ebah_warning || "—"} />
          <FieldRow label="CB date" value={fmtDate(row.clawback_date)} />
          <FieldRow label="Policy start" value={fmtDate(row.policy_start_date)} />
          <FieldRow label="Off-risk" value={fmtDate(row.off_risk_date)} />
          <FieldRow label="Net premium" value={gbp(row.net_premium)} />
          <FieldRow label="Updated" value={new Date(row.updated_at).toLocaleString("en-GB")} />
        </section>

        {canEdit && row.ebah_warning && (() => {
          const guide = WARNING_GUIDES[row.ebah_warning] || GENERIC_GUIDE;
          return (
            <section className="mx-5 mt-4 rounded border border-amber-200 bg-amber-50 p-3">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Suggested next step — {guide.title}
              </div>
              <div className="mt-1 text-sm text-slate-700">{guide.description}</div>
              {guide.suggestions.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {guide.suggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onClick={() => applySuggestion(s)}
                      className={`rounded border px-3 py-1 text-xs font-medium ${
                        s.accent === "green" ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" :
                        s.accent === "blue"  ? "border-blue-400 bg-blue-50 text-blue-800 hover:bg-blue-100" :
                        s.accent === "amber" ? "border-amber-400 bg-white text-amber-800 hover:bg-amber-100" :
                        "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              )}
            </section>
          );
        })()}

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
            {!canEdit ? (
              <div className="rounded border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
                {ownerLabel
                  ? <>Read-only view. This case is assigned to <strong>{ownerLabel}</strong>. Status updates are made by the assigned CAM or Pauline.</>
                  : <>Read-only view. Status updates are made by the assigned CAM or Pauline.</>}
              </div>
            ) : !unlocked ? (
              // Junior seller verification gate: keep the action panel hidden
              // behind one click so saves are deliberate, not accidental.
              <div className="flex flex-col gap-2">
                <div className="text-xs text-slate-500">
                  You can review the case freely. When you're ready to record an
                  action (status change, note, contact attempt, £ off, or Mark
                  as LOST), click below to unlock the action buttons.
                </div>
                <div>
                  <button
                    type="button"
                    onClick={() => setUnlocked(true)}
                    className="rounded border border-amber-400 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-100"
                  >
                    Take action on this case
                  </button>
                </div>
              </div>
            ) : (
              <>
                <ActionBtn label="Change status" onClick={() => openPanel("status")} />
                {canNotify && (
                  <ActionBtn
                    label={row.status === "open" ? "Notify CAM" : "Re-notify CAM"}
                    onClick={() => openPanel("notify")}
                    accent="amber"
                  />
                )}
                <ActionBtn label="Add note" onClick={() => openPanel("note")} />
                <ActionBtn label="Log contact" onClick={() => openPanel("contact")} />
                <ActionBtn label="Record £ off" onClick={() => openPanel("money")} accent="green" />
                {row.status !== "dead" && (
                  <ActionBtn
                    label="Mark as LOST"
                    onClick={() => openPanel("lost")}
                    accent="red"
                  />
                )}
                {canEditDetails && (
                  <ActionBtn
                    label="Edit case details"
                    onClick={() => openPanel("details")}
                  />
                )}
                {canEditDetails && (
                  <ActionBtn
                    label="Delete case"
                    onClick={() => openPanel("delete")}
                    accent="red"
                  />
                )}
              </>
            )}
          </div>
        </section>

        {panel === "status" && (
          <StatusForm
            current={row.status}
            prefill={statusPrefill}
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
            siblings={siblings}
            onCancel={() => setPanel(null)}
            onSubmit={(note, alsoApplyTo) => postEvent({ kind: "note", note, also_apply_to: alsoApplyTo })}
          />
        )}
        {panel === "contact" && (
          <ContactForm
            busy={busy}
            siblings={siblings}
            onCancel={() => setPanel(null)}
            onSubmit={(outcome, note, alsoApplyTo) => postEvent({ kind: "contact_attempt", outcome, note, also_apply_to: alsoApplyTo })}
          />
        )}
        {panel === "money" && (
          <MoneyForm
            prefillKind={moneyPrefill}
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
        {panel === "lost" && (
          <LostForm
            busy={busy}
            clientName={row.client_name}
            clawbackDue={Number(row.effective_clawback_due ?? row.clawback_due ?? 0)}
            onCancel={() => setPanel(null)}
            onSubmit={(note, lostReason) => patchStatus("dead", note, lostReason)}
          />
        )}
        {panel === "details" && (
          <EditDetailsForm
            busy={busy}
            row={row}
            advisers={advisers}
            onCancel={() => setPanel(null)}
            onSubmit={saveDetails}
          />
        )}
        {panel === "delete" && (
          <DeleteForm
            busy={busy}
            clientName={row.client_name}
            policyNumber={row.policy_number}
            onCancel={() => setPanel(null)}
            onSubmit={deleteCase}
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

function SourceBtn({ label, active, onClick, disabled }: { label: string; active: boolean; onClick: () => void; disabled: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`rounded border px-2 py-1 text-xs font-medium transition-colors disabled:opacity-50 ${
        active
          ? "border-purple-600 bg-purple-600 text-white"
          : "border-purple-300 bg-white text-purple-800 hover:bg-purple-50"
      }`}
    >
      {label}
    </button>
  );
}

function ActionBtn({ label, onClick, accent }: { label: string; onClick: () => void; accent?: "amber" | "green" | "red" }) {
  const cls =
    accent === "amber" ? "border-amber-400 bg-amber-50 text-amber-800 hover:bg-amber-100" :
    accent === "green" ? "border-emerald-400 bg-emerald-50 text-emerald-800 hover:bg-emerald-100" :
    accent === "red"   ? "border-red-600 bg-red-600 text-white hover:bg-red-700" :
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

function StatusForm({ current, prefill, busy, onCancel, onSubmit }: { current: Status; prefill: Status | null; busy: boolean; onCancel: () => void; onSubmit: (s: Status, note: string) => void }) {
  const [newStatus, setNewStatus] = useState<Status>(prefill ?? current);
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

function NoteForm({ busy, label, placeholder, submitLabel, siblings, onCancel, onSubmit }: {
  busy: boolean;
  label: string;
  placeholder: string;
  submitLabel?: string;
  siblings?: SiblingCase[];
  onCancel: () => void;
  onSubmit: (note: string, alsoApplyTo: number[]) => void;
}) {
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set((siblings ?? []).map((s) => s.id)),
  );
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(note, Array.from(selected)); }}
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
      <SiblingPicker
        siblings={siblings ?? []}
        selected={selected}
        setSelected={setSelected}
        actionLabel="note"
      />
      <FormActions busy={busy} onCancel={onCancel} submitLabel={submitLabel || "Save"} />
    </form>
  );
}

function ContactForm({ busy, siblings, onCancel, onSubmit }: {
  busy: boolean;
  siblings?: SiblingCase[];
  onCancel: () => void;
  onSubmit: (outcome: string, note: string, alsoApplyTo: number[]) => void;
}) {
  const [outcome, setOutcome] = useState("Called client - spoke");
  const [note, setNote] = useState("");
  const [selected, setSelected] = useState<Set<number>>(
    () => new Set((siblings ?? []).map((s) => s.id)),
  );
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
      onSubmit={(e) => { e.preventDefault(); onSubmit(outcome, note, Array.from(selected)); }}
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
      <SiblingPicker
        siblings={siblings ?? []}
        selected={selected}
        setSelected={setSelected}
        actionLabel="contact log"
      />
      <FormActions busy={busy} onCancel={onCancel} submitLabel="Log contact" />
    </form>
  );
}

interface SiblingCase {
  id: number; policy_number: string; provider: string;
  client_name: string; postcode: string | null;
  clawback_due: string | null; status: string;
}

function SiblingPicker({ siblings, selected, setSelected, actionLabel }: {
  siblings: SiblingCase[];
  selected: Set<number>;
  setSelected: (s: Set<number>) => void;
  actionLabel: string;
}) {
  if (siblings.length === 0) return null;
  const toggle = (id: number) => {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  };
  return (
    <div className="mt-3 rounded border border-blue-200 bg-blue-50 p-2">
      <div className="text-xs font-medium text-blue-900">
        This client has {siblings.length} other active {siblings.length === 1 ? "policy" : "policies"}. Also apply this {actionLabel} to:
      </div>
      <div className="mt-1 space-y-1">
        {siblings.map((s) => (
          <label key={s.id} className="flex items-center gap-2 text-xs">
            <input
              type="checkbox"
              checked={selected.has(s.id)}
              onChange={() => toggle(s.id)}
            />
            <span>
              <strong>{s.policy_number}</strong>
              <span className="ml-1 uppercase text-slate-500">{s.provider}</span>
              <span className="ml-1 text-slate-500">
                ({s.status}
                {s.clawback_due ? `, £${Number(s.clawback_due).toLocaleString("en-GB")}` : ""}
                )
              </span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}

function MoneyForm({ prefillKind, busy, onCancel, onSubmit }: { prefillKind: MoneyKind | null; busy: boolean; onCancel: () => void; onSubmit: (amount: number, money_kind: MoneyKind, note: string) => void }) {
  const [amount, setAmount] = useState("");
  const [moneyKind, setMoneyKind] = useState<MoneyKind>(prefillKind ?? "saved");
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

function FinalCbForm({ busy, currentAmount, providerAmount, onCancel, onSubmit }: {
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
  const gbpFmt = (v: string | null) =>
    v === null ? "—" : Number(v).toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(next, note); }}
      className="mx-5 mt-3 rounded border border-emerald-300 bg-emerald-50 p-3 text-sm"
    >
      <p className="mb-2 text-xs text-emerald-900">
        Final clawback amount: the figure actually charged once the decision is made.
        Overrides the Provider (L&amp;G) figure everywhere (tiles, reports, forecast).
      </p>
      <div className="grid grid-cols-2 gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Final CB £</span>
          <input
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="Blank to clear"
            className="rounded border border-slate-300 bg-white px-2 py-1.5"
          />
        </label>
        <div className="flex flex-col gap-1">
          <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Provider (L&amp;G)</span>
          <div className="rounded border border-slate-200 bg-white px-2 py-1.5 text-slate-600">{gbpFmt(providerAmount)}</div>
        </div>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-500">Reason for the final figure (optional)</span>
        <textarea
          rows={2}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Why is the final amount what it is? (partial CB agreed, reinstated portion, etc.)"
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <FormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel={trimmed === "" ? "Clear final" : "Save final CB"}
        disabled={!valid}
      />
    </form>
  );
}

const LOST_REASONS: { value: string; label: string; hint: string }[] = [
  { value: "dead_client",    label: "Dead client (can't resell)", hint: "Claim declined; provider must cancel from outset and refund premiums." },
  { value: "dead_contact",   label: "Dead contact",               hint: "Lost the means to speak to the client." },
  { value: "pitched_missed", label: "Lost (pitched and missed)",  hint: "Spoke to client; couldn't reinstate or resell." },
  { value: "other",          label: "Other",                      hint: "Use the note to explain." },
];

function LostForm({ busy, clientName, clawbackDue, onCancel, onSubmit }: {
  busy: boolean;
  clientName: string;
  clawbackDue: number;
  onCancel: () => void;
  onSubmit: (note: string, lostReason: string) => void;
}) {
  const [note, setNote] = useState("");
  const [lostReason, setLostReason] = useState("");
  const valid = note.trim().length > 0 && lostReason.length > 0;
  const cb = clawbackDue.toLocaleString("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2 });
  const activeHint = LOST_REASONS.find((r) => r.value === lostReason)?.hint;
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); if (valid) onSubmit(note.trim(), lostReason); }}
      className="mx-5 mt-3 rounded border-2 border-red-300 bg-red-50 p-3 text-sm"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="inline-block rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
          Confirm
        </span>
        <div className="text-sm text-red-900">
          <strong>Mark {clientName} as Lost?</strong>
          <div className="mt-1 text-xs text-red-800">
            This confirms the clawback of <strong>{cb}</strong> will happen. The case will
            stay on the dashboard for reporting but drop out of forecast alerts. A
            resolution email goes to Guy and Poz.
          </div>
        </div>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Lost category (required)
        </span>
        <select
          value={lostReason}
          onChange={(e) => setLostReason(e.target.value)}
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
          autoFocus
        >
          <option value="">Pick a reason...</option>
          {LOST_REASONS.map((r) => (
            <option key={r.value} value={r.value}>{r.label}</option>
          ))}
        </select>
        {activeHint && <span className="text-xs text-red-800">{activeHint}</span>}
      </label>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Note (required)
        </span>
        <textarea
          rows={3}
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Detail of the conversation, decision, or contact attempt."
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy || !valid}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Working..." : "Mark as LOST"}
        </button>
      </div>
    </form>
  );
}

function DeleteForm({ busy, clientName, policyNumber, onCancel, onSubmit }: {
  busy: boolean;
  clientName: string;
  policyNumber: string;
  onCancel: () => void;
  onSubmit: (reason: string) => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); onSubmit(reason.trim()); }}
      className="mx-5 mt-3 rounded border-2 border-red-300 bg-red-50 p-3 text-sm"
    >
      <div className="mb-2 flex items-start gap-2">
        <span className="inline-block rounded bg-red-600 px-2 py-0.5 text-xs font-bold uppercase text-white">
          Confirm
        </span>
        <div className="text-sm text-red-900">
          <strong>Delete case for {clientName} ({policyNumber})?</strong>
          <div className="mt-1 text-xs text-red-800">
            The case will disappear from the dashboard, reports, forecast and notifications.
            It stays in the database (with its full history) so we can restore it later if needed.
            Reason is optional but helpful for the audit log.
          </div>
        </div>
      </div>
      <label className="mt-2 flex flex-col gap-1">
        <span className="text-xs font-medium uppercase tracking-wide text-slate-600">
          Reason (optional)
        </span>
        <textarea
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. Increasing cover (no CB), duplicate entry, wrong policy"
          className="rounded border border-slate-300 bg-white px-2 py-1.5"
          autoFocus
        />
      </label>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={busy}
          className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={busy}
          className="rounded bg-red-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? "Working…" : "Delete case"}
        </button>
      </div>
    </form>
  );
}

function EditDetailsForm({ busy, row, advisers, onCancel, onSubmit }: {
  busy: boolean;
  row: DrawerCaseRow;
  advisers: { id: number; name: string }[] | null;
  onCancel: () => void;
  onSubmit: (patch: Record<string, unknown>) => void;
}) {
  // Each field is held as a string so empty input = clear. Date inputs
  // use yyyy-mm-dd which matches what the API expects.
  const [firstName, setFirstName]     = useState(row.client_first_name ?? "");
  const [lastName,  setLastName]      = useState(row.client_last_name  ?? "");
  const [dob,        setDob]          = useState(row.client_dob        ?? "");
  const [phone,      setPhone]        = useState(row.client_phone      ?? "");
  const [email,      setEmail]        = useState(row.client_email      ?? "");
  const [postcode,   setPostcode]     = useState(row.postcode          ?? "");
  const [policyType, setPolicyType]   = useState(row.policy_type       ?? "");
  const [warning,    setWarning]      = useState(row.ebah_warning      ?? "");
  const [cbDate,     setCbDate]       = useState(row.clawback_date     ?? "");
  const [netPrem,    setNetPrem]      = useState(row.net_premium ?? "");
  const [ebahAgent,  setEbahAgent]    = useState(row.ebah_agent_name);
  // Seller routing: combine adviser_id + bucket into a single dropdown.
  // "a:<id>" picks a named adviser. "b:<bucket>" picks a bucket (xstaff,
  // legacy, needs_review).
  const initialAssignment = row.adviser_id !== null
    ? `a:${row.adviser_id}`
    : `b:${row.agent_bucket || "needs_review"}`;
  const [assignment, setAssignment] = useState(initialAssignment);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // Diff against the original row; only send keys that actually
    // changed. Treat empty string as "clear to null" for nullable
    // string fields, and equal to "" only for ebah_agent_name (NOT
    // NULL).
    const patch: Record<string, unknown> = {};
    const orig = {
      client_first_name: row.client_first_name ?? "",
      client_last_name:  row.client_last_name  ?? "",
      client_dob:        row.client_dob        ?? "",
      client_phone:      row.client_phone      ?? "",
      client_email:      row.client_email      ?? "",
      postcode:          row.postcode          ?? "",
      policy_type:       row.policy_type       ?? "",
      ebah_warning:      row.ebah_warning      ?? "",
      clawback_date:     row.clawback_date     ?? "",
      net_premium:       row.net_premium       ?? "",
      ebah_agent_name:   row.ebah_agent_name,
    };
    const next = {
      client_first_name: firstName.trim(),
      client_last_name:  lastName.trim(),
      client_dob:        dob.trim(),
      client_phone:      phone.trim(),
      client_email:      email.trim(),
      postcode:          postcode.trim(),
      policy_type:       policyType.trim(),
      ebah_warning:      warning.trim(),
      clawback_date:     cbDate.trim(),
      net_premium:       netPrem.trim(),
      ebah_agent_name:   ebahAgent.trim(),
    };
    for (const k of Object.keys(next) as (keyof typeof next)[]) {
      if (next[k] !== orig[k]) {
        // null-clears for empty strings, except ebah_agent_name (NOT NULL)
        if (next[k] === "" && k !== "ebah_agent_name") {
          patch[k] = null;
        } else if (k === "net_premium") {
          patch[k] = next[k] === "" ? null : Number(next[k]);
        } else {
          patch[k] = next[k];
        }
      }
    }
    // Routing diff
    if (assignment !== initialAssignment) {
      if (assignment.startsWith("a:")) {
        const id = Number(assignment.slice(2));
        if (Number.isFinite(id) && id > 0) {
          patch.adviser_id   = id;
          patch.agent_bucket = "adviser";
        }
      } else if (assignment.startsWith("b:")) {
        patch.adviser_id   = null;
        patch.agent_bucket = assignment.slice(2);
      }
    }
    if (Object.keys(patch).length === 0) {
      onCancel();
      return;
    }
    onSubmit(patch);
  }

  // Validate basic inputs so we don't post garbage.
  const dobValid    = dob === "" || /^\d{4}-\d{2}-\d{2}$/.test(dob);
  const cbDateValid = cbDate === "" || /^\d{4}-\d{2}-\d{2}$/.test(cbDate);
  const premValid   = netPrem === "" || (Number.isFinite(Number(netPrem)) && Number(netPrem) >= 0);
  const allValid    = dobValid && cbDateValid && premValid;

  return (
    <form
      onSubmit={handleSubmit}
      className="mx-5 mt-3 rounded border border-slate-300 bg-slate-50 p-3 text-sm"
    >
      <p className="mb-2 text-xs text-slate-700">
        Fix anything wrong on the case. Policy number, provider, CB amount,
        Source flag, status and £ Saved / Resold are edited elsewhere. Every
        change you save is written to the case timeline.
      </p>
      <div className="grid grid-cols-2 gap-3">
        <Field label="First name">
          <input value={firstName} onChange={(e) => setFirstName(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Last name">
          <input value={lastName} onChange={(e) => setLastName(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="DOB (yyyy-mm-dd)" error={!dobValid ? "Bad date" : undefined}>
          <input type="date" value={dob} onChange={(e) => setDob(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Postcode">
          <input value={postcode} onChange={(e) => setPostcode(e.target.value.toUpperCase())} className={INPUT_CLS} />
        </Field>
        <Field label="Phone">
          <input value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Email">
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Policy type">
          <input value={policyType} onChange={(e) => setPolicyType(e.target.value)} className={INPUT_CLS} placeholder="e.g. Life Insurance" />
        </Field>
        <Field label="Warning category">
          <input value={warning} onChange={(e) => setWarning(e.target.value)} className={INPUT_CLS} placeholder="e.g. Lapse" />
        </Field>
        <Field label="Clawback date (yyyy-mm-dd)" error={!cbDateValid ? "Bad date" : undefined}>
          <input type="date" value={cbDate} onChange={(e) => setCbDate(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Net premium £" error={!premValid ? "Must be a number" : undefined}>
          <input type="number" min="0" step="0.01" value={netPrem} onChange={(e) => setNetPrem(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Sales agent name (L&amp;G)">
          <input value={ebahAgent} onChange={(e) => setEbahAgent(e.target.value)} className={INPUT_CLS} />
        </Field>
        <Field label="Assigned seller / bucket">
          {advisers === null ? (
            <div className="rounded border border-slate-300 bg-white px-2 py-1.5 text-slate-400">Loading sellers…</div>
          ) : (
            <select value={assignment} onChange={(e) => setAssignment(e.target.value)} className={INPUT_CLS}>
              <optgroup label="Sellers">
                {advisers.map((a) => (
                  <option key={a.id} value={`a:${a.id}`}>{a.name}</option>
                ))}
              </optgroup>
              <optgroup label="Buckets">
                <option value="b:xstaff">Xstaff</option>
                <option value="b:legacy">Legacy</option>
                <option value="b:needs_review">Needs review</option>
              </optgroup>
            </select>
          )}
        </Field>
      </div>
      <FormActions
        busy={busy}
        onCancel={onCancel}
        submitLabel="Save changes"
        disabled={!allValid}
      />
    </form>
  );
}

const INPUT_CLS = "rounded border border-slate-300 bg-white px-2 py-1.5";

function Field({ label, children, error }: { label: string; children: React.ReactNode; error?: string }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</span>
      {children}
      {error && <span className="text-xs text-red-700">{error}</span>}
    </label>
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
