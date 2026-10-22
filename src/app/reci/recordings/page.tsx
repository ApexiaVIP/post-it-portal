"use client";

/**
 * Poz's listening pool (Guy + Poz, 15 Oct 2026): every sale an agent has
 * created from a call recording that Poz hasn't decided on yet. She
 * listens, then presses Transcribe (only that sale goes to Call QA) or
 * "Listened, no transcription". Either way the recordings stay saved on
 * the sale.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RecordingItem, SaleDecision, type Rec } from "@/components/deal-recordings-panel";

interface PoolSale {
  deal_id: number; client: string; week: number; year: number; status: string;
  adviser_name: string; adviser_slug: string; recordings: Rec[];
}
interface SentSale {
  deal_id: number; client: string; adviser_name: string; adviser_slug: string; year: number;
  case_id: number; calls: number; ready: number; failed: number; sent_at: string;
  check_status: "running" | "done" | "failed" | null;
  waiting_for_aws: boolean;
}
interface Resp { sales: PoolSale[]; sent: SentSale[]; call_qa: boolean; uk: { ready: boolean; reason?: string } }

/** Where a sent sale has got to, in plain words. */
function progress(s: SentSale): { text: string; tone: string; done: boolean } {
  if (s.failed > 0) return { text: "Transcription failed: open it to retry", tone: "text-red-700", done: true };
  if (s.ready < s.calls) return { text: `Transcribing (${s.ready} of ${s.calls} done)`, tone: "text-amber-700", done: false };
  if (s.check_status === "done") return { text: "Report ready", tone: "text-emerald-700 font-semibold", done: true };
  if (s.check_status === "failed" && s.waiting_for_aws) {
    return { text: "Transcribed. The check will run once Amazon switches the AI on", tone: "text-amber-700", done: true };
  }
  if (s.check_status === "failed") return { text: "Check didn't finish: open it to run again", tone: "text-red-700", done: true };
  if (s.check_status === "running") return { text: "Transcribed, checking now", tone: "text-amber-700", done: false };
  return { text: "Transcribed, check starting shortly", tone: "text-amber-700", done: false };
}

export default function ListeningPoolPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/reci/recordings", { cache: "no-store" });
    if (!r.ok) { setErr(r.status === 403 ? "You don't have access to the listening pool." : `HTTP ${r.status}`); return; }
    setData(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

  // Keep the "Sent for transcription" list moving while anything is in progress.
  const inProgress = !!data?.sent.some((s) => !progress(s).done);
  useEffect(() => {
    if (!inProgress) return;
    const t = setInterval(() => { void load(); }, 20000);
    return () => clearInterval(t);
  }, [inProgress, load]);

  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;

  return (
    <main className="mx-auto max-w-5xl space-y-4 p-4 md:p-6">
      <header className="flex flex-wrap items-end justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <div className="text-sm text-slate-500"><Link href="/reci" className="hover:underline">RECI</Link> / Listening pool</div>
          <h1 className="text-2xl font-semibold">Listening pool</h1>
          <p className="text-sm text-slate-600">
            New sales with call recordings from the agents. Listen, then transcribe the ones you&apos;re happy with.
            Only what you transcribe goes to Call QA.
          </p>
        </div>
        <Link href="/qa" className="rounded border border-teal-300 bg-teal-50 px-3 py-1.5 text-sm font-medium text-teal-800 hover:bg-teal-100">Call QA</Link>
      </header>

      {!data.uk.ready && (
        <p className="rounded border border-amber-300 bg-amber-50 p-2 text-sm text-amber-900">
          You can listen now. Transcribe switches on once the UK processing account is set up.
        </p>
      )}

      <h2 className="text-lg font-semibold">To listen to</h2>
      {data.sales.length === 0 && <p className="py-6 text-center text-sm text-slate-500">Nothing waiting to be listened to.</p>}

      {data.sales.map((s) => (
        <section key={s.deal_id} className="rounded-lg border border-slate-300 bg-white">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2">
            <div className="text-sm">
              <span className="font-semibold">{s.client}</span>
              <span className="ml-2 text-slate-600">{s.adviser_name} · week {s.week}</span>
              <Link href={`/reci/${s.adviser_slug}?year=${s.year}&openDeal=${s.deal_id}`} className="ml-3 text-xs text-blue-700 hover:underline">
                Open sale
              </Link>
            </div>
            <SaleDecision dealId={s.deal_id} recordings={s.recordings} callQa={data.call_qa} uk={data.uk} onDone={load} />
          </div>
          <div className="space-y-2 p-2">
            {s.recordings.map((r) => <RecordingItem key={r.id} r={r} />)}
          </div>
        </section>
      ))}
      <section className="pt-4">
        <h2 className="text-lg font-semibold">Sent for transcription</h2>
        <p className="text-sm text-slate-600">
          Each sale you transcribe shows here. Transcription takes a few minutes, then the check runs on its own
          and you get an email when the report is ready.
        </p>
        {data.sent.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Nothing sent in the last two weeks.</p>
        ) : (
          <div className="mt-2 overflow-hidden rounded-lg border border-slate-300 bg-white">
            {data.sent.map((s) => {
              const p = progress(s);
              return (
                <div key={s.deal_id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-slate-100 px-3 py-2 text-sm first:border-t-0">
                  <span className="font-semibold">{s.client}</span>
                  <span className="text-slate-600">{s.adviser_name}</span>
                  <span className="text-xs text-slate-400">
                    sent {new Date(s.sent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <span className={`text-xs ${p.tone}`}>{p.text}</span>
                  <Link href={`/qa/${s.case_id}`} className="ml-auto rounded border border-teal-300 bg-teal-50 px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-100">
                    {s.check_status === "done" ? "Open report" : "Open in Call QA"}
                  </Link>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </main>
  );
}
