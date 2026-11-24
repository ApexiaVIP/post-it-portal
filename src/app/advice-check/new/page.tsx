"use client";

/**
 * Advice check: a new check, or a repeat after a callback (?from=<id>)
 * (Guy, 22 Nov 2026). The seller uploads the completed Fact Find sheet (or
 * types it). Their recommendation is read from its policy pages, 7 to 9
 * (Jimmy, 24 Nov 2026), and they can type it as well or instead.
 */
import { Suspense, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { uploadPage } from "@/lib/advice/upload";

interface Prefill {
  id: number;
  client_label: string;
  case_type: "one_call" | "two_call";
  fact_find_date: string;
  recommendation: string;
  presented: boolean;
  notes_anyway: boolean;
  sheet_text: string | null;
  adviser_id: number | null;
  adviser_name: string | null;
}

function today(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });
}

function NewCheckForm() {
  const router = useRouter();
  const params = useSearchParams();
  const from = params.get("from");
  const after = params.get("after") === "1";
  const [reviewer, setReviewer] = useState(false);
  const [advisers, setAdvisers] = useState<{ id: number; name: string }[]>([]);
  const [prev, setPrev] = useState<Prefill | null>(null);
  const [loading, setLoading] = useState(true);

  const [adviserId, setAdviserId] = useState("");
  const [client, setClient] = useState("");
  const [caseType, setCaseType] = useState<"two_call" | "one_call">("two_call");
  const [date, setDate] = useState(today());
  const [files, setFiles] = useState<File[]>([]);
  const [typed, setTyped] = useState("");
  const [rec, setRec] = useState("");
  const [presented, setPresented] = useState(false);
  const [notesAnyway, setNotesAnyway] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const list = await fetch("/api/advice-check", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (list) { setReviewer(!!list.me?.reviewer); setAdvisers(list.advisers ?? []); }
      if (from) {
        const r = await fetch(`/api/advice-check/${from}`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          const c = j.check as Prefill;
          setPrev(c);
          setClient(c.client_label); setCaseType(c.case_type); setDate(c.fact_find_date);
          setRec(c.recommendation); setPresented(c.presented || after); setNotesAnyway(c.notes_anyway);
          setTyped(c.sheet_text ?? "");
        } else {
          setError("Couldn't find the earlier check.");
        }
      }
      setLoading(false);
    })();
  }, [from, after]);

  function addFiles(list: FileList | null) {
    if (!list) return;
    // Copied now: the list empties as soon as the file box is cleared for the next pick.
    const picked = Array.from(list);
    setFiles((f) => [...f, ...picked].slice(0, 20));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (files.length === 0 && !typed.trim()) { setError("Upload the pages of your sheet, or type it in."); return; }
    setBusy("Saving…");
    const r = await fetch("/api/advice-check", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_label: client, case_type: caseType, fact_find_date: date, recommendation: rec,
        presented, notes_anyway: notesAnyway, sheet_typed: typed, previous_id: prev?.id ?? null,
        adviser_id: reviewer && !prev ? Number(adviserId) || null : undefined,
      }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(null); setError(j.error || `HTTP ${r.status}`); return; }
    const id = j.id as number;
    for (let i = 0; i < files.length; i++) {
      setBusy(`Uploading page ${i + 1} of ${files.length}…`);
      const fail = await uploadPage(id, files[i]);
      if (fail) {
        await fetch(`/api/advice-check/${id}`, { method: "DELETE" });
        setBusy(null); setError(fail); return;
      }
    }
    setBusy("Starting the check…");
    const run = await fetch(`/api/advice-check/${id}/run`, { method: "POST" });
    if (!run.ok) {
      const rj = await run.json().catch(() => ({}));
      setBusy(null);
      setError(`${rj.error || `HTTP ${run.status}`} Your check is saved: open it from the list to try again.`);
      return;
    }
    router.push(`/advice-check/${id}`);
  }

  if (loading) return <main className="p-8 text-slate-500">Loading…</main>;

  const field = "mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm";
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <div className="text-sm text-slate-500"><Link href="/advice-check" className="hover:underline">Advice check</Link> / {prev ? "run again" : "new"}</div>
      <h1 className="mt-1 text-2xl font-bold">{prev ? `Run the check again: ${prev.client_label}` : "New advice check"}</h1>
      {prev && (
        <p className="mt-1 text-sm text-slate-600">
          Update the sheet below with what the client told you on the call, or upload new photos of the updated sheet, then run it again.
        </p>
      )}

      <form onSubmit={submit} className="mt-5 space-y-5">
        {reviewer && !prev && (
          <div>
            <label className="text-sm font-semibold" htmlFor="adviser">Whose case is it?</label>
            <select id="adviser" required value={adviserId} onChange={(e) => setAdviserId(e.target.value)} className={field}>
              <option value="">Choose the seller</option>
              {advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div className="sm:col-span-2">
            <label className="text-sm font-semibold" htmlFor="client">Client first name(s)</label>
            <input id="client" required maxLength={80} value={client} onChange={(e) => setClient(e.target.value)}
              placeholder="e.g. Sarah and Tom" className={field} />
          </div>
          <div>
            <label className="text-sm font-semibold" htmlFor="date">Date of the fact find call</label>
            <input id="date" type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
          </div>
        </div>

        <fieldset>
          <legend className="text-sm font-semibold">Calls</legend>
          <div className="mt-1 flex flex-wrap gap-4 text-sm">
            <label className="flex items-center gap-2">
              <input type="radio" name="type" checked={caseType === "two_call"} onChange={() => setCaseType("two_call")} />
              Two calls (fact find, then advice)
            </label>
            <label className="flex items-center gap-2">
              <input type="radio" name="type" checked={caseType === "one_call"} onChange={() => setCaseType("one_call")} />
              One call
            </label>
          </div>
        </fieldset>

        <div>
          <p className="text-sm font-semibold">Your completed Fact Find sheet</p>
          <p className="text-xs text-slate-600">Photos or a scan of every page, both sides, sharp enough to read every figure. A phone photo is fine. If your writing won&apos;t be readable, type it below instead. Only the sheet: no call recordings, no emails from Openwork.</p>
          <p className="mt-1 text-xs text-slate-600">
            <span className="font-semibold">Your recommendation and reasons are read from pages 7, 8 and 9</span> (Policy 1, 2 and 3, for each person),
            so fill those in first. Pages 7 and 8 are the front and back of one page.
          </p>
          <input type="file" multiple accept="image/jpeg,image/png,image/webp,application/pdf"
            onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }}
            className="mt-2 block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-slate-100 file:px-3 file:py-1.5 file:text-sm" />
          {files.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm">
              {files.map((f, i) => (
                <li key={i} className="flex items-center justify-between rounded border border-slate-200 bg-white px-2 py-1">
                  <span>Page {i + 1}: {f.name}</span>
                  <button type="button" onClick={() => setFiles((x) => x.filter((_, j) => j !== i))} className="text-xs text-red-700 underline">Remove</button>
                </li>
              ))}
            </ul>
          )}
          <label className="mt-3 block text-sm" htmlFor="typed">
            {prev ? "The sheet as the last check read it. Add what the client told you:" : "Or type or paste it instead (or as well):"}
          </label>
          <textarea id="typed" rows={prev ? 14 : 5} value={typed} onChange={(e) => setTyped(e.target.value)} className={`${field} font-mono text-xs`} />
          {prev && typed && (
            <button type="button" onClick={() => setTyped("")} className="mt-1 text-xs text-teal-800 underline">
              Clear it (if you&apos;re uploading photos of the whole updated sheet)
            </button>
          )}
        </div>

        <div>
          <label className="text-sm font-semibold" htmlFor="rec">Your recommendation and reasons</label>
          <p className="text-xs text-slate-600">Leave this empty if pages 7 to 9 are filled in and easy to read. Use it for what they have no box for (trust, joint or single life, a fourth policy), or if your writing won&apos;t scan clearly.</p>
          <textarea id="rec" rows={3} maxLength={6000} value={rec} onChange={(e) => setRec(e.target.value)} className={field} />
        </div>

        <div className="space-y-2 text-sm">
          <label className="flex items-start gap-2">
            <input type="checkbox" className="mt-1" checked={presented} onChange={(e) => setPresented(e.target.checked)} />
            I have already presented the recommendation to the client
          </label>
          {caseType === "two_call" && !presented ? (
            <p className="text-xs text-slate-600">
              This checks the case before your advice call: whether we can advise, and any red lines. After the advice call, run it again with
              the box above ticked and it fills in your Concert Hub page.
            </p>
          ) : (
            <label className="flex items-start gap-2">
              <input type="checkbox" className="mt-1" checked={notesAnyway} onChange={(e) => setNotesAnyway(e.target.checked)} />
              If something is missing, still fill in the Concert Hub page for the parts that are complete
            </label>
          )}
        </div>

        <p className="rounded border border-slate-200 bg-slate-50 p-3 text-xs text-slate-600">
          Leave surnames, dates of birth, addresses and policy or bank details off anything you type. First names and ages are enough.
          The check reads your photos in London and leaves those details out of what it keeps, and the photos are deleted once read.
        </p>

        {error && <p className="text-sm text-red-700">{error}</p>}
        <div className="flex items-center gap-3">
          <button type="submit" disabled={!!busy}
            className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">
            {busy ?? "Run the check"}
          </button>
          <Link href={prev ? `/advice-check/${prev.id}` : "/advice-check"} className="text-sm text-slate-600 hover:underline">Cancel</Link>
        </div>
      </form>
    </main>
  );
}

export default function NewAdviceCheckPage() {
  return (
    <Suspense fallback={<main className="p-8 text-slate-500">Loading…</main>}>
      <NewCheckForm />
    </Suspense>
  );
}
