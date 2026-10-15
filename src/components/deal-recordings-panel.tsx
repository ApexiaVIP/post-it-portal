"use client";

/**
 * Sale recordings on a deal, for Poz (15 Oct 2026). Listen here, then
 * either send each recording to Call QA (transcribed in London, then the
 * audio is removed) or delete it. Held audio is deleted automatically
 * after the keep period either way.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RecordingDrop } from "@/components/recording-drop";

interface Rec {
  id: number; filename: string | null; size_bytes: number; client_phone: string | null;
  call_started_at: string | null; status: "held" | "sent" | "deleted";
  uploaded_by: string; uploaded_at: string; audio_removed_at: string | null; removed_by: string | null;
  qa_call_id: number | null; qa_case_id: number | null; qa_call_status: string | null;
}
interface Resp {
  slug: string; recordings: Rec[]; keep_days: number; call_qa: boolean;
  uk: { ready: boolean; reason?: string };
}

const CALL_TYPES: [string, string][] = [
  ["fact_find", "Fact find call"], ["advice", "Advice / sale call"], ["one_call", "One call (fact find + advice)"], ["other", "Other"],
];

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function DealRecordingsPanel({ dealId }: { dealId: number }) {
  const [data, setData] = useState<Resp | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reci/deals/${dealId}/recordings`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [dealId]);
  useEffect(() => { void load(); }, [load]);

  if (!data) return null;
  return (
    <section className="col-span-2 md:col-span-4 rounded border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-teal-900">Call recordings</h3>
        <button type="button" onClick={() => setAdding((v) => !v)}
          className="rounded border border-teal-300 bg-white px-2 py-0.5 text-xs text-teal-800 hover:bg-teal-50">
          {adding ? "Close" : "Add recording"}
        </button>
      </div>
      {data.recordings.length === 0 && !adding && (
        <p className="mt-1 text-xs text-slate-500">None yet. The seller can drop the 3CX recording on their board, or add it here.</p>
      )}
      <div className="mt-2 space-y-2">
        {data.recordings.map((r) => <RecordingRow key={r.id} r={r} data={data} onChanged={load} />)}
      </div>
      {adding && (
        <div className="mt-2">
          <RecordingDrop slug={data.slug} dealId={dealId} label="Drag the recording here" onDone={() => { setAdding(false); void load(); }} />
        </div>
      )}
      {data.recordings.some((r) => r.status === "held") && (
        <p className="mt-2 text-xs text-slate-500">
          Recordings are kept for {data.keep_days} days unless you send them to Call QA or delete them first.
        </p>
      )}
    </section>
  );
}

function RecordingRow({ r, data, onChanged }: { r: Rec; data: Resp; onChanged: () => void }) {
  const [callType, setCallType] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send() {
    setBusy("Sending…"); setError(null);
    const res = await fetch(`/api/reci/recordings/${r.id}/transcribe`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ call_type: callType }),
    });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) { setError(j.error || `HTTP ${res.status}`); return; }
    onChanged();
  }
  async function remove() {
    if (!confirm("Delete this recording? It can't be listened to again here.")) return;
    setBusy("Deleting…");
    await fetch(`/api/reci/recordings/${r.id}`, { method: "DELETE" });
    setBusy(null);
    onChanged();
  }

  const sendBlocked = !data.call_qa ? "Call QA access is needed to send recordings"
    : !data.uk.ready ? "Call QA is switched off until the UK processing account is set up"
    : !callType ? "Choose the call type first" : null;

  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="min-w-0 max-w-[20rem] truncate font-medium" title={r.filename ?? ""}>{r.filename ?? "Recording"}</span>
        {r.call_started_at && <span className="text-slate-600">Call {when(r.call_started_at)}</span>}
        {r.client_phone && <span className="text-slate-600">{r.client_phone}</span>}
        <span className="text-slate-400">added by {r.uploaded_by} {when(r.uploaded_at)}</span>
      </div>
      {r.status === "held" && (
        <>
          <audio controls preload="none" src={`/api/reci/recordings/${r.id}/audio`} className="mt-2 w-full" />
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <select value={callType} onChange={(e) => setCallType(e.target.value)} className="rounded border px-1 py-0.5">
              <option value="">Call type…</option>
              {CALL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
            </select>
            <button type="button" onClick={send} disabled={!!busy || !!sendBlocked} title={sendBlocked ?? undefined}
              className="rounded bg-teal-700 px-2 py-0.5 font-medium text-white hover:bg-teal-800 disabled:opacity-50">
              {busy === "Sending…" ? busy : "Transcribe for Call QA"}
            </button>
            <button type="button" onClick={remove} disabled={!!busy}
              className="rounded border border-red-200 px-2 py-0.5 text-red-700 hover:bg-red-50">
              {busy === "Deleting…" ? busy : "Delete recording"}
            </button>
            {sendBlocked && callType && <span className="text-amber-700">{sendBlocked}</span>}
          </div>
        </>
      )}
      {r.status === "sent" && (
        <p className="mt-1 text-teal-800">
          Sent to Call QA{r.qa_call_status === "ready" ? " and transcribed" : r.qa_call_status === "failed" ? ", transcription failed" : ", transcribing"}.{" "}
          {r.qa_case_id && <Link href={`/qa/${r.qa_case_id}`} className="underline">Open in Call QA</Link>}
        </p>
      )}
      {r.status === "deleted" && (
        <p className="mt-1 text-slate-500">Audio deleted {r.removed_by ? `(${r.removed_by}) ` : ""}{when(r.audio_removed_at)}.</p>
      )}
      {error && <p className="mt-1 text-red-700">{error}</p>}
    </div>
  );
}
