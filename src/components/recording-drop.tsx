"use client";

/**
 * Drop box for sale recordings (Guy + Poz, 15 Oct 2026). The agent drags
 * the 3CX download(s) in, picks the call type for each (FF, AC or Both)
 * and, for a new sale, types the client's surname. Several files at once
 * go on the same sale. Without dealId it creates a new sale in the Call
 * recordings column, which then shows in Poz's listening pool.
 */
import { useEffect, useRef, useState } from "react";

const CHUNK = 4 * 1024 * 1024 - 1024;
const AUDIO_EXT = /\.(wav|mp3|m4a|mp4|ogg|opus|flac|webm|amr|wma|aac)$/i;

const CALL_TYPES: [string, string][] = [["fact_find", "FF - Fact Find"], ["advice", "AC - Advice Call"], ["one_call", "Both"]];

interface Picked { file: File; callType: string }

export function RecordingDrop({ slug, dealId, onDone, label }: {
  slug: string;
  dealId?: number;
  onDone: (dealId: number) => void;
  label?: string;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<Picked[]>([]);
  const [surname, setSurname] = useState("");
  const [over, setOver] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // A file dropped just outside the box shouldn't open in the browser.
  useEffect(() => {
    const stop = (e: DragEvent) => { if (e.dataTransfer?.types.includes("Files")) e.preventDefault(); };
    window.addEventListener("dragover", stop);
    window.addEventListener("drop", stop);
    return () => { window.removeEventListener("dragover", stop); window.removeEventListener("drop", stop); };
  }, []);

  function add(list: FileList | null) {
    if (!list) return;
    const all = Array.from(list);
    const audio = all.filter((f) => f.type.startsWith("audio/") || AUDIO_EXT.test(f.name));
    setError(audio.length < all.length ? "Only call recordings can be added; other files were left out." : null);
    setFiles((cur) => {
      const have = new Set(cur.map((x) => `${x.file.name}|${x.file.size}`));
      return [...cur, ...audio.filter((f) => !have.has(`${f.name}|${f.size}`)).map((file) => ({ file, callType: "" }))];
    });
  }

  const missing = files.length === 0 ? "Add the recording first"
    : files.some((x) => !x.callType) ? "Choose the call type for each recording"
    : !dealId && !surname.trim() ? "Enter the client's surname" : null;

  async function upload() {
    if (missing) { setError(missing); return; }
    setError(null);
    try {
      const ids: number[] = [];
      for (const [i, { file, callType }] of files.entries()) {
        const label = files.length > 1 ? `Recording ${i + 1} of ${files.length}: ` : "";
        setProgress(`${label}starting…`);
        const r = await fetch(`/api/reci/${slug}/recordings`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ filename: file.name, mime_type: file.type, size_bytes: file.size, call_type: callType, deal_id: dealId ?? null }),
        });
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`);
        if (j.other_seller && !confirm(
          `${file.name} was recorded on ${j.other_seller}, not this seller's phone.\n\nAdd it to this board anyway?`,
        )) {
          throw new Error(`Stopped: that recording belongs to ${j.other_seller}. Open their board and add it there.`);
        }
        const total = Math.ceil(file.size / CHUNK);
        for (let seq = 0; seq < total; seq++) {
          setProgress(`${label}${Math.round((seq / total) * 100)}%`);
          const pr = await fetch(`/api/reci/recordings/${j.id}/chunk?seq=${seq}`, {
            method: "PUT", headers: { "Content-Type": "application/octet-stream" },
            body: file.slice(seq * CHUNK, Math.min(file.size, (seq + 1) * CHUNK)),
          });
          if (!pr.ok) {
            const pj = await pr.json().catch(() => ({}));
            throw new Error(pj.error || `Upload failed (HTTP ${pr.status})`);
          }
        }
        ids.push(j.id);
      }
      setProgress("Saving…");
      const f = await fetch(`/api/reci/${slug}/recordings/finish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recording_ids: ids, deal_id: dealId ?? null, surname }),
      });
      const fj = await f.json().catch(() => ({}));
      if (!f.ok) throw new Error(fj.error || `HTTP ${f.status}`);
      setFiles([]);
      setSurname("");
      setProgress(null);
      onDone(fj.deal_id);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : "Upload failed");
    }
  }

  const busy = progress !== null;
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); if (!busy) setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); if (!busy) add(e.dataTransfer.files); }}
      className={`rounded-lg border-2 border-dashed p-5 text-center text-sm ${over ? "border-teal-500 bg-teal-50" : "border-slate-300 bg-slate-50"}`}>
      <p className="text-slate-700">
        {label ?? "Drag the call recording here"}, or{" "}
        <button type="button" disabled={busy} onClick={() => fileRef.current?.click()} className="font-medium text-teal-800 underline">
          choose the file
        </button>.
      </p>
      <p className="mt-1 text-xs text-slate-500">Download it from 3CX first. You can add more than one, e.g. the fact find and the sale call.</p>
      <input ref={fileRef} type="file" multiple accept="audio/*,.wav,.mp3,.m4a,.mp4,.ogg,.opus,.flac,.webm,.amr,.wma,.aac" className="hidden"
        onChange={(e) => { add(e.target.files); e.target.value = ""; }} />

      {files.length > 0 && (
        <div className="mx-auto mt-3 max-w-md space-y-2 text-left">
          {!dealId && (
            <label className="block">
              <span className="mb-1 block text-xs font-medium text-slate-700">Client surname *</span>
              <input value={surname} onChange={(e) => setSurname(e.target.value)} disabled={busy} autoFocus
                className="w-full rounded border border-slate-300 px-2 py-1 text-sm" placeholder="e.g. Smith" />
            </label>
          )}
          <ul className="space-y-1">
            {files.map((x) => (
              <li key={`${x.file.name}|${x.file.size}`} className="flex flex-wrap items-center gap-2 rounded border border-slate-200 bg-white px-2 py-1 text-xs">
                <span className="min-w-0 flex-1 truncate" title={x.file.name}>{x.file.name}</span>
                <span className="text-slate-500">{(x.file.size / 1048576).toFixed(1)} MB</span>
                <select value={x.callType} disabled={busy} aria-label="Call type"
                  onChange={(e) => setFiles((cur) => cur.map((y) => (y === x ? { ...y, callType: e.target.value } : y)))}
                  className={`rounded border px-1 py-0.5 ${x.callType ? "border-slate-300" : "border-amber-400 bg-amber-50"}`}>
                  <option value="">Call type…</option>
                  {CALL_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                {!busy && (
                  <button type="button" onClick={() => setFiles((cur) => cur.filter((y) => y !== x))}
                    className="text-slate-400 hover:text-red-700">Remove</button>
                )}
              </li>
            ))}
          </ul>
          <div className="text-center">
            <button type="button" onClick={upload} disabled={busy || !!missing} title={missing ?? undefined}
              className="rounded bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50">
              {progress ?? (dealId ? `Add ${files.length === 1 ? "recording" : `${files.length} recordings`}` : "Create the sale")}
            </button>
            {missing && !busy && <p className="mt-1 text-xs text-slate-500">{missing}</p>}
          </div>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-700">{error}</p>}
    </div>
  );
}
