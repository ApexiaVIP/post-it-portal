"use client";

/** Start a Fact Find form (Jimmy, 24 Nov 2026). */
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

const today = () => new Date().toLocaleDateString("en-CA", { timeZone: "Europe/London" });

export default function NewFactFindPage() {
  const router = useRouter();
  const [client, setClient] = useState("");
  const [date, setDate] = useState(today());
  const [caseType, setCaseType] = useState<"two_call" | "one_call">("two_call");
  const [reviewer, setReviewer] = useState(false);
  const [advisers, setAdvisers] = useState<{ id: number; name: string }[]>([]);
  const [adviser, setAdviser] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/advice-check", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).then((j) => {
      if (j) { setReviewer(!!j.me?.reviewer); setAdvisers(j.advisers ?? []); }
    }).catch(() => { /* the form still works */ });
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null);
    const r = await fetch("/api/advice-check/form", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ client_label: client, fact_find_date: date, case_type: caseType, adviser_id: Number(adviser) || null }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setBusy(false); setError(j.error || `HTTP ${r.status}`); return; }
    router.push(`/advice-check/form/${j.id}`);
  }

  const field = "mt-1 w-full rounded border border-slate-300 px-3 py-2 text-sm";
  return (
    <main className="mx-auto max-w-xl px-4 py-6">
      <div className="text-sm text-slate-500"><Link href="/advice-check" className="hover:underline">Advice check</Link> / new Fact Find</div>
      <h1 className="mt-1 text-2xl font-bold">New Fact Find</h1>
      <p className="mt-1 text-sm text-slate-600">Fill it in on the call. It saves as you go, and it&apos;s the same sheet in the same order.</p>
      <form onSubmit={start} className="mt-5 space-y-4">
        {reviewer && (
          <div>
            <label className="text-sm font-semibold" htmlFor="adviser">Whose case is it?</label>
            <select id="adviser" value={adviser} onChange={(e) => setAdviser(e.target.value)} className={field}>
              <option value="">No one: I&apos;m trying it out</option>
              {advisers.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </div>
        )}
        <div>
          <label className="text-sm font-semibold" htmlFor="client">Client first name(s)</label>
          <input id="client" required maxLength={80} value={client} onChange={(e) => setClient(e.target.value)} placeholder="e.g. Sarah and Tom" className={field} />
        </div>
        <div>
          <label className="text-sm font-semibold" htmlFor="date">Date of the fact find call</label>
          <input id="date" type="date" required max={today()} value={date} onChange={(e) => setDate(e.target.value)} className={field} />
        </div>
        <fieldset className="flex gap-4 text-sm">
          <label className="flex items-center gap-2"><input type="radio" name="ct" checked={caseType === "two_call"} onChange={() => setCaseType("two_call")} />Two calls</label>
          <label className="flex items-center gap-2"><input type="radio" name="ct" checked={caseType === "one_call"} onChange={() => setCaseType("one_call")} />One call</label>
        </fieldset>
        {error && <p className="text-sm text-red-700">{error}</p>}
        <button type="submit" disabled={busy} className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-50">{busy ? "Starting…" : "Start"}</button>
      </form>
    </main>
  );
}
