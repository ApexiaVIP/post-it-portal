"use client";

/**
 * Welcome email panel (Poz, 28 Sep 2026). Opens when a deal is dragged
 * into On Risk NYP (and from the deal form). Shows the details the email
 * needs, offers to fold the client's other On Risk NYP policies into the
 * same email, previews exactly what the client will see, and only sends
 * when Poz clicks Send.
 */
import { useCallback, useEffect, useState } from "react";
import { providerDisplayName } from "@/lib/reci/welcome-email";

interface WelcomeDeal {
  id: number;
  client: string;
  status: string;
  provider: string | null;
  providerDisplay: string;
  policy_number: string | null;
  policy_start_date: string | null;
  first_dd_date: string | null;
  premium: number | null;
  client_email: string | null;
  client_email_2: string | null;
  welcome_sent_at: string | null;
  welcome_sent_to: string | null;
  welcome_sent_by: string | null;
  missing: string[];
}
interface Info {
  live: boolean;
  testRecipients: string[];
  adviserName: string;
  deal: WelcomeDeal;
  siblings: WelcomeDeal[];
}
interface PolicyForm {
  provider: string;
  policy_number: string;
  policy_start_date: string;
  first_dd_date: string;
  premium: string;
}

const toForm = (d: WelcomeDeal): PolicyForm => ({
  provider: d.provider ?? "",
  policy_number: d.policy_number ?? "",
  policy_start_date: d.policy_start_date ?? "",
  first_dd_date: d.first_dd_date ?? "",
  premium: d.premium != null ? String(d.premium) : "",
});

export function WelcomeEmailPanel({ dealId, onClose, onChanged }: {
  dealId: number;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const [info, setInfo] = useState<Info | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [email2, setEmail2] = useState("");
  const [forms, setForms] = useState<Record<number, PolicyForm>>({});
  const [extras, setExtras] = useState<Set<number>>(new Set());
  const [preview, setPreview] = useState<{ html: string | null; missing: Record<string, string[]>; emailConflict: string[] | null } | null>(null);
  const [busy, setBusy] = useState(false);
  const [resend, setResend] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/reci/deals/${dealId}/welcome`, { cache: "no-store" });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const i = j as Info;
      setInfo(i);
      setEmail(i.deal.client_email ?? i.siblings.find((s) => s.client_email)?.client_email ?? "");
      setEmail2(i.deal.client_email_2 ?? i.siblings.find((s) => s.client_email_2)?.client_email_2 ?? "");
      const f: Record<number, PolicyForm> = { [i.deal.id]: toForm(i.deal) };
      for (const s of i.siblings) f[s.id] = toForm(s);
      setForms(f);
      setExtras(new Set(i.siblings.map((s) => s.id)));
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [dealId]);
  useEffect(() => { void load(); }, [load]);

  const selected: WelcomeDeal[] = info ? [info.deal, ...info.siblings.filter((s) => extras.has(s.id))] : [];

  const setField = (id: number, k: keyof PolicyForm, v: string) => {
    setForms((f) => ({ ...f, [id]: { ...f[id], [k]: v } }));
    setPreview(null);
  };

  async function saveAndPreview() {
    if (!info) return;
    setBusy(true); setErr(null);
    try {
      for (const d of selected) {
        const f = forms[d.id];
        const r = await fetch(`/api/reci/deals/${d.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            client_email: email,
            client_email_2: email2,
            provider: f.provider,
            policy_number: f.policy_number,
            policy_start_date: f.policy_start_date,
            first_dd_date: f.first_dd_date,
            premium: f.premium === "" ? null : Number(f.premium),
          }),
        });
        if (!r.ok) throw new Error(`Saving ${d.client} failed (HTTP ${r.status})`);
      }
      const r = await fetch(`/api/reci/deals/${dealId}/welcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "preview", dealIds: selected.map((d) => d.id) }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setPreview({ html: j.html, missing: j.missing, emailConflict: j.emailConflict });
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "save failed");
    } finally {
      setBusy(false);
    }
  }

  async function send() {
    if (!info || !preview?.html) return;
    const clientTo = [email, email2].map((e) => e.trim()).filter(Boolean).join(" and ");
    const target = info.live ? clientTo : info.testRecipients.join(", ");
    const msg = info.live
      ? `Send the welcome email to ${clientTo}?`
      : `TEST MODE: send this to ${target} (not the client)?`;
    if (!confirm(msg)) return;
    setBusy(true); setErr(null);
    try {
      const r = await fetch(`/api/reci/deals/${dealId}/welcome`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send", dealIds: selected.map((d) => d.id), resend }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setDone(j.live ? `Sent to ${clientTo}.` : `Test sent to ${(j.sentTo as string[]).join(", ")}.`);
      onChanged?.();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "send failed");
    } finally {
      setBusy(false);
    }
  }

  const alreadySent = info?.deal.welcome_sent_at;
  const notOnRisk = info && info.deal.status !== "on_risk_nyp";
  const missingAny = preview ? Object.values(preview.missing).some((m) => m.length > 0) : true;

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4"
      onPointerDown={(e) => e.stopPropagation()}>
      <div className="w-full max-w-5xl rounded-lg bg-white shadow-xl">
        <header className="flex items-center justify-between border-b px-4 py-3">
          <h2 className="font-semibold">
            Welcome email{info ? `: ${info.deal.client}` : ""}
            {info && <span className="ml-2 text-xs font-normal text-slate-500">adviser shown as {info.adviserName}</span>}
          </h2>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-700">✕</button>
        </header>

        {!info && !err && <p className="p-4 text-sm text-slate-500">Loading…</p>}
        {err && <p className="px-4 pt-3 text-sm text-red-700">{err}</p>}

        {info && (
          <div className="space-y-4 p-4 text-sm">
            {!info.live && (
              <div className="rounded border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900">
                <strong>Test mode.</strong> Send goes to {info.testRecipients.join(", ") || "management"}, not the
                client, until the wording is signed off. Nothing is marked as sent.
              </div>
            )}
            {notOnRisk && (
              <div className="rounded border border-slate-300 bg-slate-50 px-3 py-2 text-slate-700">
                Welcome emails go once a deal is On Risk NYP. You can fill in the details now and send after the move.
              </div>
            )}
            {alreadySent && (
              <div className="rounded border border-emerald-300 bg-emerald-50 px-3 py-2 text-emerald-900">
                Welcome email already sent on {new Date(alreadySent).toLocaleString("en-GB")} to {info.deal.welcome_sent_to}
                {info.deal.welcome_sent_by ? ` by ${info.deal.welcome_sent_by}` : ""}.
                <label className="ml-3 inline-flex items-center gap-1">
                  <input type="checkbox" checked={resend} onChange={(e) => setResend(e.target.checked)} /> send it again
                </label>
              </div>
            )}

            <div className="grid max-w-3xl grid-cols-1 gap-3 md:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Client email *</span>
                <input type="email" value={email} onChange={(e) => { setEmail(e.target.value); setPreview(null); }}
                  className="w-full rounded border px-2 py-1" placeholder="client@example.com" />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-medium text-slate-600">Second email (joint policy, optional)</span>
                <input type="email" value={email2} onChange={(e) => { setEmail2(e.target.value); setPreview(null); }}
                  className="w-full rounded border px-2 py-1" placeholder="partner@example.com" />
              </label>
            </div>

            {info.siblings.length > 0 && (
              <div className="rounded border border-indigo-200 bg-indigo-50 px-3 py-2">
                <div className="mb-1 font-medium text-indigo-900">
                  {info.deal.client} has {info.siblings.length} other On Risk NYP {info.siblings.length === 1 ? "policy" : "policies"}. Include in the same email?
                </div>
                {info.siblings.map((s) => (
                  <label key={s.id} className="mr-4 inline-flex items-center gap-1 text-indigo-900">
                    <input type="checkbox" checked={extras.has(s.id)}
                      onChange={(e) => {
                        setExtras((prev) => {
                          const n = new Set(prev);
                          if (e.target.checked) n.add(s.id); else n.delete(s.id);
                          return n;
                        });
                        setPreview(null);
                      }} />
                    {s.providerDisplay || "no provider"} {s.premium != null ? `£${s.premium.toFixed(2)}` : ""}
                  </label>
                ))}
              </div>
            )}

            <table className="w-full border-collapse text-xs">
              <thead className="bg-slate-100 text-[10px] uppercase tracking-wide text-slate-600">
                <tr>
                  <th className="px-2 py-1 text-left">Provider</th>
                  <th className="px-2 py-1 text-left">Policy number *</th>
                  <th className="px-2 py-1 text-left">Policy start date *</th>
                  <th className="px-2 py-1 text-left">First DD date *</th>
                  <th className="px-2 py-1 text-left">Monthly premium £ *</th>
                </tr>
              </thead>
              <tbody>
                {selected.map((d) => {
                  const f = forms[d.id];
                  if (!f) return null;
                  const miss = preview?.missing[String(d.id)] ?? [];
                  return (
                    <tr key={d.id} className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1">
                        <input value={f.provider} onChange={(e) => setField(d.id, "provider", e.target.value)}
                          className="w-full rounded border px-2 py-1" />
                        {(() => {
                          const pd = providerDisplayName(f.provider);
                          if (!f.provider.trim()) return null;
                          if (!pd.recognised) return <div className="mt-0.5 text-[11px] text-amber-700">Not a name we recognise. The email will say &quot;{f.provider.trim()}&quot;.</div>;
                          if (pd.name !== f.provider.trim()) return <div className="mt-0.5 text-[11px] text-slate-500">Email will say &quot;{pd.name}&quot;</div>;
                          return null;
                        })()}
                      </td>
                      <td className="px-2 py-1">
                        <input value={f.policy_number} onChange={(e) => setField(d.id, "policy_number", e.target.value)}
                          className="w-full rounded border px-2 py-1 font-mono" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="date" value={f.policy_start_date} onChange={(e) => setField(d.id, "policy_start_date", e.target.value)}
                          className="w-full rounded border px-2 py-1" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="date" value={f.first_dd_date} onChange={(e) => setField(d.id, "first_dd_date", e.target.value)}
                          className="w-full rounded border px-2 py-1" />
                      </td>
                      <td className="px-2 py-1">
                        <input type="number" step="0.01" min={0} value={f.premium} onChange={(e) => setField(d.id, "premium", e.target.value)}
                          className="w-full rounded border px-2 py-1 text-right" />
                        {miss.length > 0 && <div className="mt-0.5 text-[11px] text-red-700">Missing: {miss.join(", ")}</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {preview?.emailConflict && (
              <p className="text-red-700">These policies have different emails on file ({preview.emailConflict.join(" / ")}). Save and preview again so they all use the same email(s).</p>
            )}

            {preview?.html && (
              <div>
                <div className="mb-1 text-xs font-medium uppercase tracking-wide text-slate-500">Preview: exactly what the client will see</div>
                <iframe title="Welcome email preview" srcDoc={preview.html} sandbox=""
                  className="h-[520px] w-full rounded border border-slate-300" />
              </div>
            )}

            {done && <p className="rounded bg-emerald-50 px-3 py-2 font-medium text-emerald-800">{done}</p>}
          </div>
        )}

        <footer className="flex items-center justify-end gap-2 border-t px-4 py-3">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-slate-600 hover:text-slate-900">
            {done ? "Close" : "Not now"}
          </button>
          {info && !done && (
            <>
              <button type="button" disabled={busy} onClick={saveAndPreview}
                className="rounded border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                {busy ? "Working…" : "Save and preview"}
              </button>
              <button type="button"
                disabled={busy || !preview?.html || missingAny || !!notOnRisk || (!!alreadySent && info.live && !resend)}
                onClick={send}
                title={!preview?.html ? "Save and preview first" : undefined}
                className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-40">
                {info.live ? "Send welcome email" : "Send test"}
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
