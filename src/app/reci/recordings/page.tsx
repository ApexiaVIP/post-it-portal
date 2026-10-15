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
interface Resp { sales: PoolSale[]; call_qa: boolean; uk: { ready: boolean; reason?: string } }

export default function ListeningPoolPage() {
  const [data, setData] = useState<Resp | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    const r = await fetch("/api/reci/recordings", { cache: "no-store" });
    if (!r.ok) { setErr(r.status === 403 ? "You don't have access to the listening pool." : `HTTP ${r.status}`); return; }
    setData(await r.json());
  }, []);
  useEffect(() => { void load(); }, [load]);

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

      {data.sales.length === 0 && <p className="py-10 text-center text-sm text-slate-500">Nothing waiting to be listened to.</p>}

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
    </main>
  );
}
