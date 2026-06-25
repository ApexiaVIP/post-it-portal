"use client";

/**
 * Manual New Case modal. Opens from the "New Case" button in the dashboard
 * header. Used by Poz / Jimmy when a clawback notification arrives via a
 * channel that isn't yet wired into an automatic ingest -- Aviva email,
 * LV email, Royal London spreadsheet, etc.
 *
 * Sections:
 *   1. Provider & policy        provider + policy no + product type + warning
 *   2. Client                   first / last / DOB / postcode / email / phone / address
 *   3. Amounts & dates          premium / outstanding / CB £ / CB date /
 *                               policy start / off-risk
 *   4. Sales agent              active dropdown + Xstaff / Legacy free-text
 *   5. Reference codes & source master agent no / agent no / Old/New OW flag
 *   6. Opening note (optional)
 *
 * Submit calls POST /api/reci/clawback/cases. "Save & add another" resets
 * the form and keeps the modal open. Plain Save closes the modal and
 * reloads the parent dashboard.
 */
import { useEffect, useRef, useState } from "react";

const PROVIDERS = [
  { value: "l&g",          label: "L&G" },
  { value: "aviva",        label: "Aviva" },
  { value: "lv",           label: "LV" },
  { value: "royal_london", label: "Royal London" },
  { value: "exeter",       label: "The Exeter" },
  { value: "zurich",       label: "Zurich" },
  { value: "vitality",     label: "Vitality" },
  { value: "metlife",      label: "MetLife" },
  { value: "guardian",     label: "Guardian" },
  { value: "other",        label: "Other" },
];

const WARNINGS = [
  "Lapse",
  "Bounced DD",
  "Cancelled DD",
  "Cancelled from outset",
  "CFO Redraw",
  "Death of client",
  "Death claim in progress",
  "Death claim accepted",
  "Death claim declined",
  "DD representation",
  "Increasing cover review",
  "5 yearly review",
  "Other",
];

type Adviser = { id: number; name: string };

interface FormState {
  policy_number: string;
  provider: string;
  client_first_name: string;
  client_last_name: string;
  client_dob: string;
  client_email: string;
  client_phone: string;
  postcode: string;
  address: string;
  policy_type: string;
  net_premium: string;
  premium_outstanding: string;
  policy_start_date: string;
  off_risk_date: string;
  clawback_due: string;
  clawback_date: string;
  ebah_warning: string;
  warning_other: string;
  // Sales agent: pick an adviser_id from the dropdown, or "xstaff" / "legacy"
  agent_choice: string;        // numeric adviser_id as string, or "xstaff", "legacy"
  ebah_agent_name: string;     // populated automatically for adviser; typed for xstaff/legacy
  master_agent_no: string;
  agent_no: string;
  source: string;              // "" | "old_ow" | "new_ow" | "other"
  initial_note: string;
}

const EMPTY: FormState = {
  policy_number: "", provider: "l&g",
  client_first_name: "", client_last_name: "",
  client_dob: "", client_email: "", client_phone: "",
  postcode: "", address: "", policy_type: "",
  net_premium: "", premium_outstanding: "",
  policy_start_date: "", off_risk_date: "",
  clawback_due: "", clawback_date: "",
  ebah_warning: "", warning_other: "",
  agent_choice: "", ebah_agent_name: "",
  master_agent_no: "", agent_no: "",
  source: "", initial_note: "",
};

export function NewCaseModal({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [advisers, setAdvisers] = useState<Adviser[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const firstFieldRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    fetch("/api/reci/clawback/advisers", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { advisers: Adviser[] } | null) => {
        if (j?.advisers) setAdvisers(j.advisers);
      })
      .catch(() => { /* ignore */ });
    firstFieldRef.current?.focus();
  }, []);

  function set<K extends keyof FormState>(k: K, v: FormState[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  // When an adviser is picked from the dropdown, auto-fill ebah_agent_name
  // with the canonical "TOP QUOTE LIMITED <NAME>" form so the rest of the
  // dashboard groups it correctly. When Xstaff / Legacy is picked, leave
  // the field blank for Poz to type in.
  function onAgentChoice(v: string) {
    set("agent_choice", v);
    if (v === "xstaff" || v === "legacy" || v === "") {
      set("ebah_agent_name", "");
      return;
    }
    const a = advisers.find((x) => String(x.id) === v);
    if (a) {
      set("ebah_agent_name", `TOP QUOTE LIMITED ${a.name.toUpperCase()}`);
    }
  }

  async function submit(addAnother: boolean) {
    setError(null);
    setSubmitting(true);
    try {
      // Resolve warning: "Other" -> the typed text
      const warning = form.ebah_warning === "Other"
        ? form.warning_other.trim()
        : form.ebah_warning;

      // Resolve agent bucket + adviser_id
      let agent_bucket: "adviser" | "xstaff" | "legacy";
      let adviser_id: number | null;
      if (form.agent_choice === "xstaff") {
        agent_bucket = "xstaff"; adviser_id = null;
      } else if (form.agent_choice === "legacy") {
        agent_bucket = "legacy"; adviser_id = null;
      } else {
        agent_bucket = "adviser"; adviser_id = Number(form.agent_choice);
      }

      const body = {
        policy_number:       form.policy_number.trim(),
        provider:            form.provider,
        client_first_name:   form.client_first_name.trim(),
        client_last_name:    form.client_last_name.trim(),
        client_dob:          form.client_dob || null,
        client_email:        form.client_email.trim() || null,
        client_phone:        form.client_phone.trim() || null,
        postcode:            form.postcode.trim().toUpperCase() || null,
        address:             form.address.trim() || null,
        policy_type:         form.policy_type.trim() || null,
        net_premium:         form.net_premium === "" ? null : Number(form.net_premium),
        premium_outstanding: form.premium_outstanding === "" ? null : Number(form.premium_outstanding),
        policy_start_date:   form.policy_start_date || null,
        off_risk_date:       form.off_risk_date || null,
        clawback_due:        form.clawback_due === "" ? 0 : Number(form.clawback_due),
        clawback_date:       form.clawback_date || null,
        ebah_warning:        warning,
        adviser_id, agent_bucket,
        ebah_agent_name:     form.ebah_agent_name.trim(),
        master_agent_no:     form.master_agent_no.trim() || null,
        agent_no:            form.agent_no.trim() || null,
        source:              form.source || null,
        initial_note:        form.initial_note.trim() || null,
      };

      const r = await fetch("/api/reci/clawback/cases", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) {
        setError(j.error || r.statusText || "Save failed");
        return;
      }
      onSaved();
      // The POST handler returns { ok, id, email } where email is null
      // (no auto-Notify because CB was zero) or { sent, reason } from the
      // Notify dispatcher. Surface the outcome so Pauline knows whether
      // the seller email actually fired.
      const emailTail = j.email
        ? j.email.sent
          ? " · Notify email sent."
          : ` · Notify email NOT sent (${j.email.reason || "see runtime logs"}).`
        : " · No Notify email (clawback is £0).";
      if (addAnother) {
        setToast(`Saved case #${j.id}.${emailTail}`);
        setTimeout(() => setToast(null), 6000);
        // Preserve provider + sales agent + warning between entries so a
        // batch of similar cases doesn't require re-selecting these each
        // time. Everything else resets.
        setForm({
          ...EMPTY,
          provider:         form.provider,
          agent_choice:     form.agent_choice,
          ebah_agent_name:  form.ebah_agent_name,
          ebah_warning:     form.ebah_warning,
          warning_other:    form.warning_other,
        });
        firstFieldRef.current?.focus();
      } else {
        onClose();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <>
      <div
        className="fixed inset-0 z-40 bg-slate-900/40"
        onClick={() => { if (!submitting) onClose(); }}
      />
      <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto p-4">
        <div className="my-8 w-full max-w-3xl rounded-lg bg-white shadow-xl">
          <header className="sticky top-0 z-10 flex items-baseline justify-between gap-4 rounded-t-lg border-b border-slate-200 bg-white px-5 py-4">
            <div>
              <h2 className="text-lg font-semibold">New clawback case</h2>
              <div className="text-xs text-slate-500">
                Manual entry — use this for providers other than L&amp;G or when EBAH hasn't caught up.
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="rounded p-1 text-slate-500 hover:bg-slate-100 disabled:opacity-50"
              aria-label="Close"
            >✕</button>
          </header>

          {toast && (
            <div className="mx-5 mt-3 rounded bg-slate-900 px-3 py-2 text-sm text-white">{toast}</div>
          )}
          {error && (
            <div className="mx-5 mt-3 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </div>
          )}

          <form
            onSubmit={(e) => { e.preventDefault(); void submit(false); }}
            className="space-y-6 px-5 py-4"
          >
            {/* Provider + policy */}
            <Section title="Provider & policy">
              <Row>
                <Field label="Provider" required>
                  <select
                    value={form.provider}
                    onChange={(e) => set("provider", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.value} value={p.value}>{p.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Policy number" required>
                  <input
                    ref={firstFieldRef}
                    type="text"
                    value={form.policy_number}
                    onChange={(e) => set("policy_number", e.target.value)}
                    placeholder="e.g. 0225859685"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Product type">
                  <input
                    type="text"
                    value={form.policy_type}
                    onChange={(e) => set("policy_type", e.target.value)}
                    placeholder="Life Insurance with Critical Illness, etc."
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Warning / Status" required>
                  <select
                    value={form.ebah_warning}
                    onChange={(e) => set("ebah_warning", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Select…</option>
                    {WARNINGS.map((w) => <option key={w} value={w}>{w}</option>)}
                  </select>
                </Field>
              </Row>
              {form.ebah_warning === "Other" && (
                <Row>
                  <Field label="Custom warning text" required>
                    <input
                      type="text"
                      value={form.warning_other}
                      onChange={(e) => set("warning_other", e.target.value)}
                      placeholder="Type the warning category"
                      className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                    />
                  </Field>
                  <div />
                </Row>
              )}
            </Section>

            {/* Client */}
            <Section title="Client">
              <Row>
                <Field label="First name" required>
                  <input
                    type="text"
                    value={form.client_first_name}
                    onChange={(e) => set("client_first_name", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Last name" required>
                  <input
                    type="text"
                    value={form.client_last_name}
                    onChange={(e) => set("client_last_name", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="DOB">
                  <input
                    type="date"
                    value={form.client_dob}
                    onChange={(e) => set("client_dob", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Postcode">
                  <input
                    type="text"
                    value={form.postcode}
                    onChange={(e) => set("postcode", e.target.value)}
                    placeholder="SW1A 1AA"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm uppercase"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Email">
                  <input
                    type="email"
                    value={form.client_email}
                    onChange={(e) => set("client_email", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Phone">
                  <input
                    type="tel"
                    value={form.client_phone}
                    onChange={(e) => set("client_phone", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
              <Field label="Address">
                <textarea
                  rows={2}
                  value={form.address}
                  onChange={(e) => set("address", e.target.value)}
                  className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                />
              </Field>
            </Section>

            {/* Amounts + dates */}
            <Section title="Amounts &amp; dates">
              <Row>
                <Field label="Net premium £">
                  <input
                    type="number" min="0" step="0.01"
                    value={form.net_premium}
                    onChange={(e) => set("net_premium", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Premium outstanding £">
                  <input
                    type="number" min="0" step="0.01"
                    value={form.premium_outstanding}
                    onChange={(e) => set("premium_outstanding", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Clawback £">
                  <input
                    type="number" min="0" step="0.01"
                    value={form.clawback_due}
                    onChange={(e) => set("clawback_due", e.target.value)}
                    placeholder="0.00"
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Clawback date">
                  <input
                    type="date"
                    value={form.clawback_date}
                    onChange={(e) => set("clawback_date", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Policy start date">
                  <input
                    type="date"
                    value={form.policy_start_date}
                    onChange={(e) => set("policy_start_date", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
                <Field label="Off-risk date">
                  <input
                    type="date"
                    value={form.off_risk_date}
                    onChange={(e) => set("off_risk_date", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
            </Section>

            {/* Sales agent */}
            <Section title="Sales agent">
              <Row>
                <Field label="Owner" required>
                  <select
                    value={form.agent_choice}
                    onChange={(e) => onAgentChoice(e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Select…</option>
                    {advisers.map((a) => (
                      <option key={a.id} value={String(a.id)}>{a.name}</option>
                    ))}
                    <option value="xstaff">Xstaff (departed Top Quote)</option>
                    <option value="legacy">Legacy (non-Top-Quote book)</option>
                  </select>
                </Field>
                <Field label="Sales agent name (as on the file)" required>
                  <input
                    type="text"
                    value={form.ebah_agent_name}
                    onChange={(e) => set("ebah_agent_name", e.target.value)}
                    placeholder={
                      form.agent_choice === "xstaff" ? "e.g. TOP QUOTE LIMITED R HARKER"
                      : form.agent_choice === "legacy" ? "e.g. BANK OF IRELAND TRUST"
                      : ""
                    }
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  />
                </Field>
              </Row>
            </Section>

            {/* Reference codes + source */}
            <Section title="Reference codes &amp; source">
              <Row>
                <Field label="Master agent code">
                  <input
                    type="text"
                    value={form.master_agent_no}
                    onChange={(e) => set("master_agent_no", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
                <Field label="Seller / agent code">
                  <input
                    type="text"
                    value={form.agent_no}
                    onChange={(e) => set("agent_no", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm font-mono"
                  />
                </Field>
              </Row>
              <Row>
                <Field label="Source">
                  <select
                    value={form.source}
                    onChange={(e) => set("source", e.target.value)}
                    className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
                  >
                    <option value="">Not flagged</option>
                    <option value="old_ow">Old OW</option>
                    <option value="new_ow">New OW</option>
                    <option value="other">Other</option>
                  </select>
                </Field>
                <div />
              </Row>
            </Section>

            {/* Opening note */}
            <Section title="Opening note (optional)">
              <textarea
                rows={3}
                value={form.initial_note}
                onChange={(e) => set("initial_note", e.target.value)}
                placeholder="Anything Pauline wants to capture up front (why this was added manually, what happened, etc.)"
                className="w-full rounded border border-slate-300 px-2 py-1.5 text-sm"
              />
            </Section>

            <footer className="sticky bottom-0 -mx-5 -mb-4 flex items-center justify-between gap-3 border-t border-slate-200 bg-slate-50 px-5 py-3">
              <button
                type="button"
                onClick={onClose}
                disabled={submitting}
                className="rounded px-3 py-1.5 text-sm text-slate-600 hover:bg-slate-100 disabled:opacity-50"
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void submit(true)}
                  disabled={submitting}
                  className="rounded border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-50"
                >
                  Save &amp; add another
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="rounded bg-amber-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-700 disabled:opacity-50"
                >
                  {submitting ? "Saving…" : "Save case"}
                </button>
              </div>
            </footer>
          </form>
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
function Row({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-2 gap-3">{children}</div>;
}
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-xs uppercase tracking-wide text-slate-500">
        {label}
        {required && <span className="ml-0.5 text-red-500">*</span>}
      </span>
      {children}
    </label>
  );
}
