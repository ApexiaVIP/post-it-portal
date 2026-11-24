"use client";

/**
 * One client's Fact Find, completed on the call (Jimmy, 24 Nov 2026). Saves
 * itself a moment after each change, shows the key answers still blank while
 * the client is on the phone, and runs the advice check on what's there.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { FactFindForm } from "@/components/fact-find-form";
import { sheetFor } from "@/lib/factfind";
import { looksPersonal, missing } from "@/lib/factfind/view";
import type { Data } from "@/lib/factfind/types";
import { READINESS_STYLE, type CheckSummary } from "@/lib/advice/shared";

interface Form {
  id: number; adviser_name: string | null; created_by: string; client_label: string; case_type: "one_call" | "two_call";
  fact_find_date: string; sheet_version: string; data: Data; rev: number; presented: boolean; purged_at: string | null;
}
interface CheckLite { id: number; status: string; presented: boolean; created_at: string; stage: string | null; summary: CheckSummary | null }
type Meta = Pick<Form, "client_label" | "case_type" | "fact_find_date" | "presented">;
type SaveState = "saved" | "waiting" | "saving" | "offline" | "conflict";

const SAVE_AFTER = 1200;
const RETRY_AFTER = 5000;

export default function FactFindPage() {
  const id = Number(useParams<{ id: string }>().id);
  const router = useRouter();
  const [form, setForm] = useState<Form | null>(null);
  const [checks, setChecks] = useState<CheckLite[]>([]);
  const [data, setData] = useState<Data>({});
  const [meta, setMeta] = useState<Meta | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [state, setState] = useState<SaveState>("saved");
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [restore, setRestore] = useState<Data | null>(null);
  const [notesAnyway, setNotesAnyway] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checkErr, setCheckErr] = useState<string | null>(null);

  // What the server last had, and what is on screen now.
  const rev = useRef(0);
  const latest = useRef<{ data: Data; meta: Meta | null }>({ data: {}, meta: null });
  const dirty = useRef(false);
  const saving = useRef<Promise<boolean> | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const backupKey = `fact-find-${id}`;

  const loadChecks = useCallback(async () => {
    const r = await fetch(`/api/advice-check/form/${id}`, { cache: "no-store" }).catch(() => null);
    if (r?.ok) setChecks((await r.json()).checks);
  }, [id]);

  useEffect(() => {
    (async () => {
      const r = await fetch(`/api/advice-check/form/${id}`, { cache: "no-store" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErr(j.error === "not found" ? "Form not found." : j.error || `HTTP ${r.status}`); return; }
      const f = j.form as Form;
      rev.current = f.rev;
      const m: Meta = { client_label: f.client_label, case_type: f.case_type, fact_find_date: f.fact_find_date, presented: f.presented };
      latest.current = { data: f.data, meta: m };
      setForm(f); setData(f.data); setMeta(m); setChecks(j.checks);
      try {
        const b = localStorage.getItem(`fact-find-${id}`);
        if (b) {
          const p = JSON.parse(b) as { rev: number; data: Data };
          if (p.rev === f.rev) setRestore(p.data); else localStorage.removeItem(`fact-find-${id}`);
        }
      } catch { /* no backup to offer */ }
    })().catch(() => setErr("Couldn't load the form. Check your connection and reload."));
  }, [id]);

  /** Saves what is on screen. Resolves true once the server has it. */
  const save = useCallback(async (): Promise<boolean> => {
    if (saving.current) { await saving.current; if (!dirty.current) return true; }
    const job = (async () => {
      const sent = latest.current;
      dirty.current = false;
      setState("saving");
      try {
        const r = await fetch(`/api/advice-check/form/${id}`, {
          method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: rev.current, data: sent.data, ...sent.meta }),
        });
        const j = await r.json().catch(() => ({}));
        if (r.status === 409 && j.conflict) { dirty.current = true; setState("conflict"); return false; }
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        rev.current = j.rev;
        setSavedAt(new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }));
        try { localStorage.removeItem(`fact-find-${id}`); } catch { /* nothing kept */ }
        setState(dirty.current ? "waiting" : "saved");
        return true;
      } catch {
        dirty.current = true;
        setState("offline");
        // Kept on this computer only until the next save gets through.
        try { localStorage.setItem(`fact-find-${id}`, JSON.stringify({ rev: rev.current, data: latest.current.data })); } catch { /* still on screen */ }
        if (timer.current) clearTimeout(timer.current);
        timer.current = setTimeout(() => { void save(); }, RETRY_AFTER);
        return false;
      }
    })();
    saving.current = job;
    const ok = await job;
    saving.current = null;
    return ok;
  }, [id]);

  const changed = useCallback(() => {
    dirty.current = true;
    setState((s) => (s === "conflict" ? s : "waiting"));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { void save(); }, SAVE_AFTER);
  }, [save]);

  const onSet = useCallback((k: string, v: unknown) => {
    const next = { ...latest.current.data, [k]: v };
    latest.current = { ...latest.current, data: next };
    setData(next);
    changed();
  }, [changed]);
  const onMeta = useCallback((m: Partial<Meta>) => {
    if (!latest.current.meta) return;
    const next = { ...latest.current.meta, ...m };
    latest.current = { ...latest.current, meta: next };
    setMeta(next);
    changed();
  }, [changed]);

  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => { if (dirty.current) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", warn);
    return () => { window.removeEventListener("beforeunload", warn); if (timer.current) clearTimeout(timer.current); if (dirty.current) void save(); };
  }, [save]);

  const running = checks.some((c) => c.status === "running");
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void loadChecks(); }, 5000);
    return () => clearInterval(t);
  }, [running, loadChecks]);
  useEffect(() => {
    if (form && window.location.hash) document.getElementById(window.location.hash.slice(1))?.scrollIntoView();
  }, [form]);

  const sheet = useMemo(() => sheetFor(form?.sheet_version ?? ""), [form?.sheet_version]);
  const blanks = useMemo(() => missing(sheet, data), [sheet, data]);
  const due = useMemo(() => new Set(blanks.map((b) => b.anchor)), [blanks]);
  const personal = useMemo(() => looksPersonal(data), [data]);

  async function runCheck() {
    setBusy(true); setCheckErr(null);
    if (timer.current) clearTimeout(timer.current);
    const ok = dirty.current ? await save() : saving.current ? await saving.current : true;
    if (!ok) { setBusy(false); setCheckErr("The form hasn't saved yet. Check your connection and try again."); return; }
    const r = await fetch(`/api/advice-check/form/${id}/check`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ rev: rev.current, notes_anyway: notesAnyway }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setCheckErr(j.error || `HTTP ${r.status}`); return; }
    router.push(`/advice-check/${j.id}`);
  }
  async function remove() {
    if (!confirm("Delete this form and everything in it? This can't be undone.")) return;
    if (timer.current) clearTimeout(timer.current);
    dirty.current = false;
    const r = await fetch(`/api/advice-check/form/${id}`, { method: "DELETE" });
    if (r.ok) { try { localStorage.removeItem(backupKey); } catch { /* none kept */ } router.push("/advice-check"); }
    else setCheckErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  }

  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!form || !meta) return <main className="p-8 text-slate-500">Loading…</main>;
  if (form.purged_at) return <main className="p-8 text-slate-600">This form&apos;s answers have been cleared: it is past the time TopQuote keeps them.</main>;

  const before = meta.case_type === "two_call" && !meta.presented;
  const saveText = state === "saving" || state === "waiting" ? "Saving…" : state === "offline" ? "Not saved: no connection. Keep going, it will save when it's back."
    : state === "conflict" ? "Changed somewhere else" : savedAt ? `Saved ${savedAt}` : "Saved";

  return (
    <main className="mx-auto max-w-7xl px-4 py-4">
      <div className="sticky top-12 z-20 -mx-4 border-b border-slate-300 bg-slate-50 px-4 py-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-xs text-slate-500"><Link href="/advice-check" className="hover:underline">Advice check</Link> / Fact Find {form.adviser_name ? `· ${form.adviser_name}` : ""}</p>
            <h1 className="truncate text-xl font-bold">{meta.client_label}</h1>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span role="status" className={state === "offline" || state === "conflict" ? "font-semibold text-red-700" : "text-slate-500"}>{saveText}</span>
            <Link href={`/advice-check/form/${id}/print`} target="_blank" className="rounded border border-slate-300 bg-white px-3 py-1.5 hover:bg-slate-50">Print</Link>
            <button type="button" onClick={runCheck} disabled={busy || running || state === "conflict"} className="rounded bg-teal-700 px-4 py-1.5 font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
              {busy ? "Starting…" : running ? "Checking…" : "Run the check"}
            </button>
          </div>
        </div>
        {checkErr && <p className="mt-1 text-sm text-red-700">{checkErr}</p>}
        {state === "conflict" && <p className="mt-1 text-sm text-red-700">This form was changed in another window. <button type="button" onClick={() => window.location.reload()} className="underline">Reload to get the latest</button> (copy anything you&apos;ve just typed first).</p>}
        {personal && <p className="mt-1 text-sm text-amber-800">There&apos;s {personal} on this form. Leave addresses, postcodes and dates of birth out: they go straight into Concert.</p>}
        {restore && (
          <p className="mt-1 text-sm text-amber-800">
            Some changes hadn&apos;t saved last time.{" "}
            <button type="button" className="font-semibold underline" onClick={() => { latest.current = { ...latest.current, data: restore }; setData(restore); setRestore(null); changed(); }}>Put them back</button>{" "}
            <button type="button" className="underline" onClick={() => { try { localStorage.removeItem(backupKey); } catch { /* none kept */ } setRestore(null); }}>Discard them</button>
          </p>
        )}
      </div>

      <div className="mt-4 grid grid-cols-1 gap-6 lg:grid-cols-[17rem_1fr]">
        <aside className="lg:sticky lg:top-40 lg:max-h-[calc(100vh-11rem)] lg:self-start lg:overflow-y-auto">
          <div className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
            <label className="block text-xs text-slate-600" htmlFor="label">Client first name(s)</label>
            <input id="label" maxLength={80} value={meta.client_label} onChange={(e) => onMeta({ client_label: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
            <label className="mt-2 block text-xs text-slate-600" htmlFor="ffd">Date of the fact find call</label>
            <input id="ffd" type="date" value={meta.fact_find_date} onChange={(e) => onMeta({ fact_find_date: e.target.value })} className="mt-1 w-full rounded border border-slate-300 px-2 py-1" />
            <div className="mt-2 flex gap-3">
              <label className="flex items-center gap-1"><input type="radio" name="ct" checked={meta.case_type === "two_call"} onChange={() => onMeta({ case_type: "two_call" })} />Two calls</label>
              <label className="flex items-center gap-1"><input type="radio" name="ct" checked={meta.case_type === "one_call"} onChange={() => onMeta({ case_type: "one_call" })} />One call</label>
            </div>
            <label className="mt-2 flex items-start gap-2"><input type="checkbox" className="mt-1" checked={meta.presented} onChange={(e) => onMeta({ presented: e.target.checked })} />I have already presented the recommendation</label>
            {before ? (
              <p className="mt-2 text-xs text-slate-600">The check gives the licence answer and the red lines. After the advice call, tick the box above, fill in the last section and run it again for the justification and notes.</p>
            ) : (
              <label className="mt-2 flex items-start gap-2 text-xs"><input type="checkbox" className="mt-0.5" checked={notesAnyway} onChange={(e) => setNotesAnyway(e.target.checked)} />If something is missing, still draft the notes for the parts that are complete</label>
            )}
          </div>

          <div className={`mt-3 rounded-lg border p-3 text-sm ${blanks.length ? "border-amber-400 bg-amber-50" : "border-emerald-500 bg-emerald-50"}`}>
            <p className="font-bold">{blanks.length ? `${blanks.length} key answer${blanks.length === 1 ? "" : "s"} still blank` : "Every key answer is filled in"}</p>
            <ul className="mt-1 space-y-2">
              {sheet.sections.filter((s) => blanks.some((b) => b.section === s.key)).map((s) => (
                <li key={s.key}>
                  <a href={`#s-${s.key}`} className="text-xs font-semibold text-slate-700 hover:underline">{s.title}</a>
                  <ul className="ml-2 space-y-0.5">
                    {blanks.filter((b) => b.section === s.key).map((b, i) => <li key={i}><a href={`#${b.anchor}`} className="text-xs text-amber-900 hover:underline">{b.label}</a></li>)}
                  </ul>
                </li>
              ))}
            </ul>
          </div>

          {checks.length > 0 && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-sm">
              <p className="font-bold">Checks on this form</p>
              <ul className="mt-1 space-y-1">
                {checks.map((c) => (
                  <li key={c.id}>
                    <Link href={`/advice-check/${c.id}`} className="text-teal-800 hover:underline">{new Date(c.created_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</Link>{" "}
                    {c.summary ? <span className={`rounded px-1 text-[11px] font-semibold ${READINESS_STYLE[c.summary.readiness]}`}>{c.summary.label}</span>
                      : <span className="text-xs text-slate-500">{c.status === "running" ? "checking" : c.status === "failed" ? "didn't finish" : c.status}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <button type="button" onClick={remove} className="mt-3 text-xs text-red-700 underline">Delete this form</button>
        </aside>
        <FactFindForm sheet={sheet} data={data} due={due} onSet={onSet} />
      </div>
    </main>
  );
}
