"use client";

/**
 * A sale's call recordings (Guy + Poz, 15 Oct 2026), shown in the deal
 * form and in the listening pool. Poz listens, then presses Transcribe to
 * send only this sale's untranscribed recordings to Call QA, or marks the
 * sale as listened with no transcription. Recordings stay saved on the
 * sale for future reference either way.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { RecordingDrop } from "@/components/recording-drop";

export interface Rec {
  id: number; filename: string | null; size_bytes: number; client_phone: string | null;
  call_started_at: string | null; call_type: "fact_find" | "advice" | "one_call" | null;
  status: "held" | "sent" | "deleted";
  uploaded_by: string; uploaded_at: string; audio_removed_at: string | null; removed_by: string | null;
  listened_at: string | null; listened_by: string | null;
  qa_call_id: number | null; qa_case_id: number | null; qa_call_status: string | null;
}

export const CALL_TYPE_SHORT: Record<string, string> = { fact_find: "FF - Fact Find", advice: "AC - Advice Call", one_call: "Both" };

const when = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

/** One recording: details, player and its transcription state. */
export function RecordingItem({ r, onDelete }: { r: Rec; onDelete?: () => void }) {
  return (
    <div className="rounded border border-slate-200 bg-white p-2 text-xs">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="rounded bg-slate-100 px-1.5 py-0.5 font-semibold text-slate-700">
          {r.call_type ? CALL_TYPE_SHORT[r.call_type] : "Call type not set"}
        </span>
        <span className="min-w-0 max-w-[18rem] truncate" title={r.filename ?? ""}>{r.filename ?? "Recording"}</span>
        {r.call_started_at && <span className="text-slate-600">Call {when(r.call_started_at)}</span>}
        {r.client_phone && <span className="text-slate-600">{r.client_phone}</span>}
        <span className="text-slate-400">added by {r.uploaded_by} {when(r.uploaded_at)}</span>
        {r.qa_call_id ? (
          <span className="text-teal-800">
            {r.qa_call_status === "ready" ? "Transcribed" : r.qa_call_status === "failed" ? "Transcription failed" : "Transcribing"}
            {r.qa_case_id && <> · <Link href={`/qa/${r.qa_case_id}`} className="underline">Call QA</Link></>}
          </span>
        ) : r.listened_at ? (
          <span className="text-slate-500">Listened by {r.listened_by}, not transcribed</span>
        ) : null}
        {onDelete && r.status === "held" && (
          <button type="button" onClick={onDelete} className="ml-auto text-red-700 hover:underline">Delete</button>
        )}
      </div>
      {r.status === "held" ? (
        <audio controls preload="none" src={`/api/reci/recordings/${r.id}/audio`} className="mt-2 h-9 w-full" />
      ) : (
        <p className="mt-1 text-slate-500">Recording deleted {r.removed_by ? `by ${r.removed_by} ` : ""}{when(r.audio_removed_at)}.</p>
      )}
    </div>
  );
}

/** Transcribe / listened buttons for a sale (used here and in the pool). */
export function SaleDecision({ dealId, recordings, callQa, uk, onDone }: {
  dealId: number; recordings: Rec[]; callQa: boolean; uk: { ready: boolean; reason?: string }; onDone: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const waiting = recordings.filter((r) => r.status === "held" && !r.qa_call_id);
  const undecided = waiting.filter((r) => !r.listened_at);
  if (waiting.length === 0) return null;

  const blocked = !callQa ? "Call QA access is needed to transcribe"
    : !uk.ready ? "Transcription is switched off until the UK processing account is set up" : null;

  async function transcribe() {
    setBusy("Sending…"); setMsg(null);
    const r = await fetch(`/api/reci/deals/${dealId}/transcribe`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(null);
    if (!r.ok) { setMsg({ ok: false, text: j.error || `HTTP ${r.status}` }); return; }
    setMsg({ ok: !j.failed?.length, text: j.failed?.length
      ? `${j.sent} sent; ${j.failed.length} failed: ${j.failed.join(" | ")}`
      : `${j.sent} recording${j.sent === 1 ? "" : "s"} sent for transcription.` });
    onDone();
  }
  async function listened() {
    setBusy("Saving…"); setMsg(null);
    await fetch(`/api/reci/deals/${dealId}/listened`, { method: "POST" });
    setBusy(null);
    onDone();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button type="button" onClick={transcribe} disabled={!!busy || !!blocked} title={blocked ?? undefined}
        className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-50">
        {busy === "Sending…" ? busy : `Transcribe${waiting.length > 1 ? ` (${waiting.length} recordings)` : ""}`}
      </button>
      {undecided.length > 0 && (
        <button type="button" onClick={listened} disabled={!!busy}
          className="rounded border border-slate-300 bg-white px-3 py-1 text-xs text-slate-700 hover:bg-slate-50">
          {busy === "Saving…" ? busy : "Listened, no transcription"}
        </button>
      )}
      {blocked && <span className="text-xs text-amber-700">{blocked}</span>}
      {msg && <span className={`text-xs ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span>}
    </div>
  );
}

interface Resp { slug: string; recordings: Rec[]; call_qa: boolean; uk: { ready: boolean; reason?: string } }

export function DealRecordingsPanel({ dealId }: { dealId: number }) {
  const [data, setData] = useState<Resp | null>(null);
  const [adding, setAdding] = useState(false);

  const load = useCallback(async () => {
    const r = await fetch(`/api/reci/deals/${dealId}/recordings`, { cache: "no-store" });
    if (r.ok) setData(await r.json());
  }, [dealId]);
  useEffect(() => { void load(); }, [load]);

  async function remove(id: number) {
    if (!confirm("Delete this recording from the sale? It can't be listened to again.")) return;
    await fetch(`/api/reci/recordings/${id}`, { method: "DELETE" });
    void load();
  }

  if (!data) return null;
  return (
    <section className="col-span-2 md:col-span-4 rounded border border-teal-200 bg-teal-50/40 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-teal-900">Call recordings</h3>
        <div className="flex flex-wrap items-center gap-2">
          <SaleDecision dealId={dealId} recordings={data.recordings} callQa={data.call_qa} uk={data.uk} onDone={load} />
          <button type="button" onClick={() => setAdding((v) => !v)}
            className="rounded border border-teal-300 bg-white px-2 py-1 text-xs text-teal-800 hover:bg-teal-50">
            {adding ? "Close" : "Add recording"}
          </button>
        </div>
      </div>
      {data.recordings.length === 0 && !adding && (
        <p className="mt-1 text-xs text-slate-500">None yet. The agent adds the 3CX recording when they create the sale.</p>
      )}
      <div className="mt-2 space-y-2">
        {data.recordings.map((r) => <RecordingItem key={r.id} r={r} onDelete={() => remove(r.id)} />)}
      </div>
      {adding && (
        <div className="mt-2">
          <RecordingDrop slug={data.slug} dealId={dealId} label="Drag the recording here" onDone={() => { setAdding(false); void load(); }} />
        </div>
      )}
      {data.recordings.length > 0 && <p className="mt-2 text-xs text-slate-500">Recordings stay saved on this sale for future reference.</p>}
    </section>
  );
}
