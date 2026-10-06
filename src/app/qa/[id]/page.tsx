"use client";

/**
 * Call QA case page (Guy + Poz brief, 6 Oct 2026).
 *
 * Upload the case's call recordings (transcribed with timestamps and
 * speakers; the audio is deleted afterwards), run Gate 1 on the calls,
 * upload the suitability report and run Gate 2. The report follows
 * Guy's order, and every piece of evidence links to the moment in the
 * transcript it came from.
 */
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { CALL_TYPE_LABELS, fmtTime, type QaCall, type QaCase, type CallType } from "@/lib/qa/shared";
import type {
  Gate1Result, Gate2Result, EvidenceItem, ExceptionItem,
} from "@/lib/qa/schemas";

interface Run {
  id: number;
  gate: 1 | 2;
  status: "running" | "done" | "failed";
  model: string | null;
  result: unknown;
  error: string | null;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
}
interface Detail {
  case: QaCase;
  calls: QaCall[];
  document: { id: number; filename: string | null; size_bytes: number; uploaded_by: string | null; uploaded_at: string } | null;
  runs: Run[];
}

const CHUNK = 4 * 1024 * 1024 - 1024;

const RESULT_STYLE: Record<string, string> = {
  PASS: "bg-emerald-100 text-emerald-800",
  DELIVERED_IN_FULL: "bg-emerald-100 text-emerald-800",
  MATCHES: "bg-emerald-100 text-emerald-800",
  CONSISTENT: "bg-emerald-100 text-emerald-800",
  AGREED: "bg-emerald-100 text-emerald-800",
  FACT: "bg-slate-100 text-slate-700",
  INFERENCE: "bg-violet-100 text-violet-800",
  FAIL: "bg-red-600 text-white",
  MISSING: "bg-red-600 text-white",
  DOES_NOT_MATCH: "bg-red-600 text-white",
  IN_REPORT_NOT_SUPPORTED_BY_CALL: "bg-red-100 text-red-800",
  ON_CALL_MISSING_FROM_REPORT: "bg-red-100 text-red-800",
  ISSUES_FOUND: "bg-red-100 text-red-800",
  HIGH: "bg-red-600 text-white",
  PARTIAL: "bg-amber-100 text-amber-900",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-900",
  NOT_ESTABLISHED: "bg-amber-100 text-amber-900",
  MEDIUM: "bg-amber-100 text-amber-900",
  LOW: "bg-slate-100 text-slate-700",
  NOT_APPLICABLE: "bg-slate-100 text-slate-500",
  DECLINED: "bg-slate-100 text-slate-700",
  DEFERRED: "bg-slate-100 text-slate-700",
};

function Chip({ v }: { v: string }) {
  return (
    <span className={`inline-block whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${RESULT_STYLE[v] ?? "bg-slate-100 text-slate-700"}`}>
      {v.replace(/_/g, " ")}
    </span>
  );
}

function parseTime(t: string): number {
  const parts = t.split(":").map((x) => Number(x));
  if (parts.some((n) => Number.isNaN(n))) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

export default function CallQaCasePage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const caseId = Number(params.id);
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [openCall, setOpenCall] = useState<number | null>(null);
  const [target, setTarget] = useState<{ call: number; time: number } | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/qa/cases/${caseId}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Case not found." : r.status === 403 ? "You don't have access to Call QA." : `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [caseId]);
  useEffect(() => { void load(); }, [load]);

  // Poll while something is in progress.
  const busy = !!data && (data.runs.some((r) => r.status === "running") || data.calls.some((c) => c.status === "transcribing"));
  useEffect(() => {
    if (!busy) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [busy, load]);

  const gate1 = data?.runs.find((r) => r.gate === 1) ?? null;
  const gate2 = data?.runs.find((r) => r.gate === 2) ?? null;

  const jump = useCallback((ev: EvidenceItem) => {
    const call = data?.calls.find((c) => c.call_number === ev.call);
    if (!call) return;
    setOpenCall(call.id);
    setTarget({ call: call.id, time: parseTime(ev.time) });
  }, [data]);

  async function deleteCase() {
    if (!confirm("Delete this case and its transcripts?")) return;
    await fetch(`/api/qa/cases/${caseId}`, { method: "DELETE" });
    router.push("/qa");
  }

  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;
  const c = data.case;
  const readyCalls = data.calls.filter((k) => k.status === "ready");

  return (
    <main className="mx-auto max-w-6xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <div className="no-print text-sm text-slate-500"><Link href="/qa" className="hover:underline">Call QA</Link> / case {c.id}</div>
          <h1 className="text-2xl font-bold">{c.client_name}</h1>
          <p className="text-sm text-slate-600">
            Adviser {c.adviser_name ?? "not set"} · {c.case_type === "one_call" ? "One call" : "Fact find call + advice call"}
            {c.notes ? ` · ${c.notes}` : ""}
          </p>
        </div>
        <div className="no-print flex gap-2 text-sm">
          <button type="button" onClick={() => window.print()} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Print report</button>
          <button type="button" onClick={deleteCase} className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">Delete case</button>
        </div>
      </div>

      <section className="no-print mt-5">
        <h2 className="text-lg font-bold">Calls</h2>
        <div className="mt-2 space-y-2">
          {data.calls.map((k) => (
            <CallRow key={k.id} call={k} open={openCall === k.id}
              onToggle={() => setOpenCall(openCall === k.id ? null : k.id)}
              target={target?.call === k.id ? target.time : null}
              onChanged={load} />
          ))}
          {data.calls.length === 0 && <p className="text-sm text-slate-500">No calls yet. Upload the recording(s) for this case below.</p>}
        </div>
        <UploadCall caseId={caseId} caseType={c.case_type} existing={data.calls.length} onDone={load} />
      </section>

      <section className="no-print mt-6">
        <h2 className="text-lg font-bold">Suitability report (for Gate 2)</h2>
        <SuitabilityUpload caseId={caseId} doc={data.document} onDone={load} />
      </section>

      <section className="no-print mt-6 grid grid-cols-1 gap-3 md:grid-cols-2">
        <GateControl caseId={caseId} gate={1} run={gate1}
          title="Gate 1: the calls"
          blurb="Run at Confirmation Check. Openwork observation form, mandatory disclosures, client facts, recommendation and consistency."
          disabledReason={readyCalls.length === 0 ? "Upload and transcribe the call(s) first." : null}
          onStarted={load} />
        <GateControl caseId={caseId} gate={2} run={gate2}
          title="Gate 2: the suitability report"
          blurb="Run once the report is produced, before it is issued. Compares the report with what was said on the calls."
          disabledReason={readyCalls.length === 0 ? "Upload and transcribe the call(s) first." : !data.document ? "Upload the suitability report first." : null}
          onStarted={load} />
      </section>

      <Report gate1={gate1} gate2={gate2} onJump={jump} />
    </main>
  );
}

// ---------------------------------------------------------------- calls

function CallRow({ call, open, onToggle, target, onChanged }: {
  call: QaCall; open: boolean; onToggle: () => void; target: number | null; onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const speakers = useMemo(() => Array.from(new Set((call.utterances ?? []).map((u) => u.s))).sort(), [call.utterances]);

  async function patch(body: Record<string, unknown>) {
    setBusy(true);
    await fetch(`/api/qa/calls/${call.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    setBusy(false);
    onChanged();
  }
  async function retry() {
    setBusy(true);
    await fetch(`/api/qa/calls/${call.id}/transcribe`, { method: "POST" });
    setBusy(false);
    onChanged();
  }
  async function remove() {
    if (!confirm(`Delete call ${call.call_number} and its transcript?`)) return;
    await fetch(`/api/qa/calls/${call.id}`, { method: "DELETE" });
    onChanged();
  }

  const statusCls =
    call.status === "ready" ? "text-emerald-700" :
    call.status === "failed" ? "text-red-700" : "text-amber-700";

  return (
    <div className="rounded border border-slate-200 bg-white">
      <div className="flex flex-wrap items-center gap-3 px-3 py-2 text-sm">
        <span className="font-semibold">Call {call.call_number}</span>
        <select value={call.call_type} disabled={busy} onChange={(e) => patch({ call_type: e.target.value })}
          className="rounded border px-1 py-0.5 text-xs">
          {(Object.keys(CALL_TYPE_LABELS) as CallType[]).map((t) => <option key={t} value={t}>{CALL_TYPE_LABELS[t]}</option>)}
        </select>
        <input type="date" value={call.call_date ?? ""} disabled={busy} onChange={(e) => patch({ call_date: e.target.value })}
          className="rounded border px-1 py-0.5 text-xs" />
        <span className={`text-xs font-medium ${statusCls}`}>
          {call.status === "ready" ? `Transcribed${call.duration_seconds ? ` · ${fmtTime(call.duration_seconds)}` : ""}` :
           call.status === "transcribing" ? "Transcribing…" :
           call.status === "uploading" ? "Upload not finished" : `Failed: ${call.error ?? ""}`}
        </span>
        {call.status === "ready" && speakers.length > 1 && (
          <label className="flex items-center gap-1 text-xs text-slate-600">
            Adviser is
            <select value={call.adviser_speaker ?? ""} disabled={busy} onChange={(e) => patch({ adviser_speaker: e.target.value })}
              className="rounded border px-1 py-0.5">
              {speakers.map((s) => <option key={s} value={s}>speaker {s}</option>)}
            </select>
          </label>
        )}
        <span className="ml-auto flex gap-2">
          {call.status === "failed" && (
            <button type="button" onClick={retry} disabled={busy} className="rounded border px-2 py-0.5 text-xs hover:bg-slate-50">Retry transcription</button>
          )}
          {call.status === "ready" && (
            <button type="button" onClick={onToggle} className="rounded border px-2 py-0.5 text-xs hover:bg-slate-50">
              {open ? "Hide transcript" : "Show transcript"}
            </button>
          )}
          <button type="button" onClick={remove} className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-700 hover:bg-red-50">Delete</button>
        </span>
      </div>
      {open && call.utterances && <Transcript call={call} target={target} />}
    </div>
  );
}

function Transcript({ call, target }: { call: QaCall; target: number | null }) {
  const ref = useRef<HTMLDivElement>(null);
  const utts = call.utterances ?? [];
  const speakers = Array.from(new Set(utts.map((u) => u.s)));
  const others = speakers.filter((s) => s !== call.adviser_speaker);
  const role = (s: string) => s === call.adviser_speaker ? "Adviser" : others.length === 1 ? "Client" : `Speaker ${s}`;
  const hit = target === null ? -1 : utts.reduce((best, u, i) => (u.start <= target + 1 ? i : best), 0);

  useEffect(() => {
    if (hit < 0 || !ref.current) return;
    const el = ref.current.querySelector(`[data-i="${hit}"]`);
    el?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [hit, target]);

  return (
    <div ref={ref} className="max-h-96 overflow-y-auto border-t border-slate-100 px-3 py-2 text-sm">
      {utts.map((u, i) => (
        <div key={i} data-i={i}
          className={`grid grid-cols-[4.5rem_4.5rem_1fr] gap-2 py-0.5 ${i === hit ? "rounded bg-yellow-100" : ""}`}>
          <span className="font-mono text-xs text-slate-400">{fmtTime(u.start)}</span>
          <span className={`text-xs font-semibold ${u.s === call.adviser_speaker ? "text-teal-800" : "text-slate-600"}`}>{role(u.s)}</span>
          <span>{u.text}</span>
        </div>
      ))}
    </div>
  );
}

function UploadCall({ caseId, caseType, existing, onDone }: {
  caseId: number; caseType: "one_call" | "two_call"; existing: number; onDone: () => void;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const defaultType: CallType = caseType === "one_call" ? "one_call" : existing === 0 ? "fact_find" : "advice";
  const [callType, setCallType] = useState<CallType>(defaultType);
  const [callDate, setCallDate] = useState("");
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setCallType(defaultType); }, [defaultType]);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose a recording first."); return; }
    setError(null);
    try {
      setProgress("Starting upload…");
      const r = await fetch(`/api/qa/cases/${caseId}/calls`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ call_type: callType, call_date: callDate || null, filename: file.name, mime_type: file.type, size_bytes: file.size }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
      const callId = j.id as number;
      const total = Math.ceil(file.size / CHUNK);
      for (let seq = 0; seq < total; seq++) {
        setProgress(`Uploading ${Math.round((seq / total) * 100)}%`);
        const part = file.slice(seq * CHUNK, Math.min(file.size, (seq + 1) * CHUNK));
        const pr = await fetch(`/api/qa/calls/${callId}/chunk?seq=${seq}`, {
          method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part,
        });
        if (!pr.ok) {
          const pj = await pr.json().catch(() => ({}));
          throw new Error(pj.error || `Upload failed (HTTP ${pr.status})`);
        }
      }
      setProgress("Transcribing… this usually takes under a minute");
      const tr = await fetch(`/api/qa/calls/${callId}/transcribe`, { method: "POST" });
      const tj = await tr.json().catch(() => ({}));
      if (!tr.ok) throw new Error(tj.error || `Transcription failed (HTTP ${tr.status})`);
      setProgress(null);
      if (fileRef.current) fileRef.current.value = "";
      setCallDate("");
      onDone();
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "upload failed");
      onDone();
    }
  }

  return (
    <div className="mt-3 rounded border border-dashed border-slate-300 bg-slate-50 p-3 text-sm">
      <div className="flex flex-wrap items-end gap-3">
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Recording</span>
          <input ref={fileRef} type="file" accept="audio/*,.wav,.mp3,.m4a,.ogg,.opus,.webm" className="text-xs" />
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Call type</span>
          <select value={callType} onChange={(e) => setCallType(e.target.value as CallType)} className="rounded border px-2 py-1">
            {(Object.keys(CALL_TYPE_LABELS) as CallType[]).map((t) => <option key={t} value={t}>{CALL_TYPE_LABELS[t]}</option>)}
          </select>
        </label>
        <label>
          <span className="mb-1 block text-xs font-medium text-slate-600">Call date</span>
          <input type="date" value={callDate} onChange={(e) => setCallDate(e.target.value)} className="rounded border px-2 py-1" />
        </label>
        <button type="button" onClick={upload} disabled={!!progress}
          className="rounded bg-slate-900 px-4 py-1.5 font-medium text-white disabled:opacity-50">
          {progress ?? "Upload and transcribe"}
        </button>
      </div>
      <p className="mt-2 text-xs text-slate-500">
        The recording is transcribed with timestamps and speakers, then deleted. Only the transcript is kept.
      </p>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function SuitabilityUpload({ caseId, doc, onDone }: { caseId: number; doc: Detail["document"]; onDone: () => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload() {
    const file = fileRef.current?.files?.[0];
    if (!file) { setError("Choose the PDF first."); return; }
    setBusy(true); setError(null);
    const fd = new FormData();
    fd.set("file", file);
    const r = await fetch(`/api/qa/cases/${caseId}/document`, { method: "POST", body: fd });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setError(j.error || `HTTP ${r.status}`); return; }
    if (fileRef.current) fileRef.current.value = "";
    onDone();
  }

  return (
    <div className="mt-2 rounded border border-slate-200 bg-white p-3 text-sm">
      {doc ? (
        <p>
          <a href={`/api/qa/cases/${caseId}/document`} target="_blank" rel="noreferrer" className="font-medium text-teal-800 underline">
            {doc.filename ?? "Suitability report.pdf"}
          </a>
          <span className="ml-2 text-xs text-slate-500">uploaded {new Date(doc.uploaded_at).toLocaleString("en-GB")} by {doc.uploaded_by}</span>
        </p>
      ) : (
        <p className="text-slate-500">Not uploaded yet. Save the report from ConcertHub as a PDF and upload it here.</p>
      )}
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input ref={fileRef} type="file" accept="application/pdf,.pdf" className="text-xs" />
        <button type="button" onClick={upload} disabled={busy}
          className="rounded border border-slate-300 px-3 py-1 hover:bg-slate-50 disabled:opacity-50">
          {busy ? "Uploading…" : doc ? "Replace PDF" : "Upload PDF"}
        </button>
      </div>
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

function GateControl({ caseId, gate, run, title, blurb, disabledReason, onStarted }: {
  caseId: number; gate: 1 | 2; run: Run | null; title: string; blurb: string;
  disabledReason: string | null; onStarted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const running = run?.status === "running";

  async function start() {
    setError(null);
    const r = await fetch(`/api/qa/cases/${caseId}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gate }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) setError(j.error || `HTTP ${r.status}`);
    onStarted();
  }

  return (
    <div className="rounded-lg border border-slate-300 bg-white p-3 text-sm">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{title}</h3>
        <button type="button" onClick={start} disabled={running || !!disabledReason}
          title={disabledReason ?? undefined}
          className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800 disabled:opacity-40">
          {running ? "Running…" : run ? "Run again" : "Run check"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600">{blurb}</p>
      {disabledReason && <p className="mt-1 text-xs text-slate-500">{disabledReason}</p>}
      {run && (
        <p className="mt-2 text-xs text-slate-500">
          {running ? "Running since " : run.status === "done" ? "Last run " : "Last run failed, "}
          {new Date(run.started_at).toLocaleString("en-GB")} by {run.started_by}
          {running && " · usually 2 to 4 minutes, this page updates itself"}
        </p>
      )}
      {run?.status === "failed" && run.error && <p className="mt-1 text-xs text-red-700">{run.error}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}
    </div>
  );
}

// ---------------------------------------------------------------- report

function EvidenceLinks({ ev, onJump }: { ev: EvidenceItem[]; onJump: (e: EvidenceItem) => void }) {
  if (!ev || ev.length === 0) return <span className="text-xs text-slate-400">no evidence cited</span>;
  return (
    <div className="space-y-0.5">
      {ev.map((e, i) => (
        <div key={i} className="text-xs">
          <button type="button" onClick={() => onJump(e)} className="no-print-link mr-1 font-mono text-teal-800 hover:underline">
            C{e.call} {e.time}
          </button>
          <span className="italic text-slate-600">&ldquo;{e.quote}&rdquo;</span>
        </div>
      ))}
    </div>
  );
}

function SectionTitle({ n, title, note }: { n: number; title: string; note?: string }) {
  return (
    <h2 className="mt-8 border-b border-slate-300 pb-1 text-lg font-bold">
      {n}. {title}
      {note && <span className="ml-2 text-xs font-normal text-slate-500">{note}</span>}
    </h2>
  );
}

function Report({ gate1, gate2, onJump }: { gate1: Run | null; gate2: Run | null; onJump: (e: EvidenceItem) => void }) {
  const g1 = (gate1?.result ?? null) as Partial<Gate1Result> | null;
  const g2 = (gate2?.result ?? null) as Partial<Gate2Result> | null;
  if (!g1 && !g2) {
    return <p className="mt-8 rounded border border-slate-200 bg-white p-4 text-sm text-slate-500">No report yet. Run Gate 1 once the calls are transcribed.</p>;
  }

  const obs = g1?.observation;
  const disc = g1?.disclosures;
  const facts = g1?.facts;
  const cons = g1?.consistency;
  const suit = g2?.suitability;

  // Section 8 collects everything a person needs to look at.
  const exceptions: (ExceptionItem & { from: string })[] = [];
  for (const [from, list] of [
    ["Observation form", obs?.exceptions], ["Disclosures", disc?.exceptions], ["Client facts", facts?.exceptions],
    ["Consistency", cons?.exceptions], ["Suitability report", suit?.exceptions],
  ] as const) {
    for (const x of list ?? []) exceptions.push({ ...x, from });
  }
  for (const k of obs?.checks ?? []) {
    if (k.result === "FAIL" || k.result === "REVIEW_REQUIRED") {
      exceptions.push({ title: `Form ${k.ref}: ${k.requirement}`, detail: k.finding, severity: k.result === "FAIL" ? (k.mandatory ? "HIGH" : "MEDIUM") : "LOW", evidence: k.evidence, from: "Observation form" });
    }
  }
  for (const d of disc?.disclosures ?? []) {
    if (d.result === "MISSING" || d.result === "PARTIAL" || d.result === "REVIEW_REQUIRED") {
      exceptions.push({ title: `${d.name}: ${d.result.replace(/_/g, " ").toLowerCase()}`, detail: d.differences, severity: d.result === "MISSING" ? "HIGH" : "MEDIUM", evidence: d.evidence, from: "Disclosures" });
    }
  }
  for (const f of cons?.consistency.findings ?? []) {
    exceptions.push({ title: f.issue, detail: f.explanation, severity: f.severity, evidence: f.evidence, from: "Consistency" });
  }
  for (const f of facts?.facts ?? []) {
    if (f.label === "NOT_ESTABLISHED") exceptions.push({ title: `Not established: ${f.category.replace(/_/g, " ").toLowerCase()}`, detail: f.item, severity: "LOW", evidence: f.evidence, from: "Client facts" });
  }
  for (const f of suit?.findings ?? []) {
    if (f.result !== "MATCHES") exceptions.push({ title: `Report: ${f.area.replace(/_/g, " ").toLowerCase()}`, detail: f.explanation, severity: f.result === "REVIEW_REQUIRED" ? "MEDIUM" : "HIGH", evidence: f.evidence, from: "Suitability report" });
  }
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  exceptions.sort((a, b) => order[a.severity] - order[b.severity]);

  const fails = (obs?.checks ?? []).filter((k) => k.result === "FAIL").length;
  const reviews = (obs?.checks ?? []).filter((k) => k.result === "REVIEW_REQUIRED").length;

  return (
    <div className="mt-8">
      <div className="rounded-lg border-2 border-slate-900 bg-white p-4">
        <h2 className="text-xl font-bold">QA report</h2>
        <p className="mt-1 text-sm text-slate-600">
          This report establishes facts, checks them against the standards and flags issues. It does not make the suitability decision. A person decides.
        </p>
        <div className="mt-3 flex flex-wrap gap-4 text-sm">
          <span><strong className="text-red-700">{fails}</strong> form checks failed</span>
          <span><strong className="text-amber-700">{reviews}</strong> need review</span>
          <span><strong>{exceptions.filter((x) => x.severity === "HIGH").length}</strong> high-priority exceptions</span>
          <span className="text-slate-500">
            Gate 1 {gate1 ? (gate1.status === "done" ? `run ${new Date(gate1.started_at).toLocaleString("en-GB")}` : gate1.status) : "not run"} ·
            Gate 2 {gate2 ? (gate2.status === "done" ? `run ${new Date(gate2.started_at).toLocaleString("en-GB")}` : gate2.status) : "not run"}
          </span>
        </div>
      </div>

      <SectionTitle n={1} title="Openwork observation check" note="numbered as on the form" />
      {obs ? (
        <>
          <div className="mt-2 flex flex-wrap gap-2 text-xs">
            {obs.stage_outcomes.map((s, i) => (
              <span key={i} className="rounded border border-slate-200 bg-white px-2 py-1" title={s.note}>{s.stage} <Chip v={s.result} /></span>
            ))}
          </div>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="w-14 px-2 py-1">Ref</th><th className="px-2 py-1">Standard</th><th className="w-36 px-2 py-1">Result</th><th className="px-2 py-1">Finding and evidence</th></tr>
            </thead>
            <tbody>
              {obs.checks.map((k, i) => {
                const newStage = i === 0 || obs.checks[i - 1].stage !== k.stage;
                return (
                  <Fragment key={i}>
                    {newStage && <tr><td colSpan={4} className="bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">{k.stage}</td></tr>}
                    <tr className="border-t border-slate-100 align-top">
                      <td className="px-2 py-1.5 font-mono text-xs">{k.ref}</td>
                      <td className="px-2 py-1.5">{k.requirement}{k.mandatory && <span className="ml-1 text-xs font-bold text-red-700">*</span>}</td>
                      <td className="px-2 py-1.5"><Chip v={k.result} /></td>
                      <td className="px-2 py-1.5"><p>{k.finding}</p><EvidenceLinks ev={k.evidence} onJump={onJump} /></td>
                    </tr>
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={2} title="Mandatory disclosures" note="SAY AS WRITTEN passages and mandatory questions" />
      {disc ? (
        <table className="mt-2 w-full border-collapse text-sm">
          <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
            <tr><th className="px-2 py-1">Disclosure</th><th className="w-40 px-2 py-1">Result</th><th className="px-2 py-1">What was missing or changed, and evidence</th></tr>
          </thead>
          <tbody>
            {disc.disclosures.map((d, i) => (
              <tr key={i} className="border-t border-slate-100 align-top">
                <td className="px-2 py-1.5"><p className="font-medium">{d.name}</p><p className="text-xs text-slate-500">{d.source}{d.form_refs.length ? ` · form ${d.form_refs.join(", ")}` : ""}</p></td>
                <td className="px-2 py-1.5"><Chip v={d.result} /></td>
                <td className="px-2 py-1.5">{d.differences && <p>{d.differences}</p>}<EvidenceLinks ev={d.evidence} onJump={onJump} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={3} title="Client fact summary" note="FACT = said on a call · INFERENCE = the AI's reading" />
      {facts ? (
        <table className="mt-2 w-full border-collapse text-sm">
          <tbody>
            {facts.facts.map((f, i) => {
              const newCat = i === 0 || facts.facts[i - 1].category !== f.category;
              return (
                <Fragment key={i}>
                  {newCat && <tr><td colSpan={3} className="bg-slate-50 px-2 py-1 text-xs font-bold uppercase tracking-wide text-slate-700">{f.category.replace(/_/g, " ")}</td></tr>}
                  <tr className="border-t border-slate-100 align-top">
                    <td className="px-2 py-1.5">{f.item}</td>
                    <td className="w-32 px-2 py-1.5"><Chip v={f.label} /></td>
                    <td className="px-2 py-1.5"><EvidenceLinks ev={f.evidence} onJump={onJump} /></td>
                  </tr>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={4} title="Priorities and concerns" />
      {facts ? (
        <div className="mt-2 grid grid-cols-1 gap-4 md:grid-cols-2">
          {([["Priorities", facts.priorities], ["Concerns", facts.concerns]] as const).map(([label, list]) => (
            <div key={label}>
              <h3 className="text-sm font-bold">{label}</h3>
              <ul className="mt-1 space-y-2 text-sm">
                {list.map((p, i) => (
                  <li key={i} className="rounded border border-slate-200 bg-white p-2">
                    <p>{p.text} <Chip v={p.label} /></p>
                    <EvidenceLinks ev={p.evidence} onJump={onJump} />
                  </li>
                ))}
                {list.length === 0 && <li className="text-slate-500">None recorded.</li>}
              </ul>
            </div>
          ))}
        </div>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={5} title="Recommendation and rationale" />
      {cons ? (
        <>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="px-2 py-1">Product</th><th className="px-2 py-1">Provider</th><th className="px-2 py-1">Life assured</th><th className="px-2 py-1">Benefit</th><th className="px-2 py-1">Term</th><th className="px-2 py-1">Premium</th><th className="px-2 py-1">Outcome</th><th className="px-2 py-1">Evidence</th></tr>
            </thead>
            <tbody>
              {cons.recommendations.map((r, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5">{r.product}</td><td className="px-2 py-1.5">{r.provider}</td>
                  <td className="px-2 py-1.5">{r.life_assured}</td><td className="px-2 py-1.5">{r.benefit_amount}</td>
                  <td className="px-2 py-1.5">{r.term}</td><td className="px-2 py-1.5">{r.premium}</td>
                  <td className="px-2 py-1.5"><Chip v={r.outcome} /> <Chip v={r.label} /></td>
                  <td className="px-2 py-1.5"><EvidenceLinks ev={r.evidence} onJump={onJump} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          <h3 className="mt-3 text-sm font-bold">Reasons given on the call</h3>
          <ul className="mt-1 space-y-2 text-sm">
            {cons.rationale.map((r, i) => (
              <li key={i} className="rounded border border-slate-200 bg-white p-2"><p>{r.reason} <Chip v={r.label} /></p><EvidenceLinks ev={r.evidence} onJump={onJump} /></li>
            ))}
          </ul>
          {cons.needs_not_addressed.length > 0 && (
            <>
              <h3 className="mt-3 text-sm font-bold">Needs raised but not addressed</h3>
              <ul className="mt-1 space-y-2 text-sm">
                {cons.needs_not_addressed.map((n, i) => (
                  <li key={i} className="rounded border border-slate-200 bg-white p-2"><p><strong>{n.need}</strong>: {n.reason_given} <Chip v={n.label} /></p><EvidenceLinks ev={n.evidence} onJump={onJump} /></li>
                ))}
              </ul>
            </>
          )}
        </>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={6} title="Consistency check" />
      {cons ? (
        <div className="mt-2 text-sm">
          <p><Chip v={cons.consistency.result} /> <span className="ml-1">{cons.consistency.summary}</span></p>
          <ul className="mt-2 space-y-2">
            {cons.consistency.findings.map((f, i) => (
              <li key={i} className="rounded border border-slate-200 bg-white p-2"><p><Chip v={f.severity} /> <strong>{f.issue}</strong></p><p className="mt-0.5">{f.explanation}</p><EvidenceLinks ev={f.evidence} onJump={onJump} /></li>
            ))}
          </ul>
        </div>
      ) : <Missing gate={gate1} />}

      <SectionTitle n={7} title="Suitability report check" note="Gate 2: report against the calls, both ways" />
      {suit ? (
        <>
          <p className="mt-2 text-sm">{suit.summary}</p>
          <table className="mt-2 w-full border-collapse text-sm">
            <thead className="bg-slate-100 text-left text-xs uppercase tracking-wide text-slate-600">
              <tr><th className="px-2 py-1">Area</th><th className="px-2 py-1">Result</th><th className="px-2 py-1">Report says</th><th className="px-2 py-1">Calls show</th><th className="px-2 py-1">Explanation and evidence</th></tr>
            </thead>
            <tbody>
              {suit.findings.map((f, i) => (
                <tr key={i} className="border-t border-slate-100 align-top">
                  <td className="px-2 py-1.5 text-xs font-semibold">{f.area.replace(/_/g, " ")}<p className="font-normal text-slate-500">{f.report_location}</p></td>
                  <td className="px-2 py-1.5"><Chip v={f.result} /></td>
                  <td className="px-2 py-1.5">{f.report_says}</td>
                  <td className="px-2 py-1.5">{f.call_says}</td>
                  <td className="px-2 py-1.5"><p>{f.explanation}</p><EvidenceLinks ev={f.evidence} onJump={onJump} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      ) : <Missing gate={gate2} label="Upload the suitability report and run Gate 2." />}

      <SectionTitle n={8} title="Exceptions and items for human review" note={`${exceptions.length} items, most serious first`} />
      <ul className="mt-2 space-y-2 text-sm">
        {exceptions.map((x, i) => (
          <li key={i} className="rounded border border-slate-200 bg-white p-2">
            <p><Chip v={x.severity} /> <strong>{x.title}</strong> <span className="text-xs text-slate-500">({x.from})</span></p>
            {x.detail && <p className="mt-0.5">{x.detail}</p>}
            <EvidenceLinks ev={x.evidence} onJump={onJump} />
          </li>
        ))}
        {exceptions.length === 0 && <li className="text-slate-500">Nothing flagged.</li>}
      </ul>
    </div>
  );
}

function Missing({ gate, label }: { gate: Run | null; label?: string }) {
  const text = !gate ? (label ?? "Run Gate 1 to fill this section.")
    : gate.status === "running" ? "Running…"
    : gate.status === "failed" ? "This part did not complete. Run the check again."
    : (label ?? "Not available.");
  return <p className="mt-2 text-sm text-slate-500">{text}</p>;
}
