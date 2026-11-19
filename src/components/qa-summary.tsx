"use client";

/**
 * Call QA summary (Poz and Guy, 19 Nov 2026): the front page of a case's
 * report. One line per real issue, rated red / amber / green, with what went
 * wrong, where in the call and the suggested action. Built by triage() from
 * the checker's existing results.
 */
import { Fragment } from "react";
import type { EvidenceItem } from "@/lib/qa/schemas";
import type { Rag, Triage, TriageLine } from "@/lib/qa/triage";

/** Evidence with a link to the moment in the call it came from. */
export function EvidenceLinks({ ev, onJump }: { ev: EvidenceItem[]; onJump: (e: EvidenceItem) => void }) {
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

const RAG_STYLE: Record<Rag, { bar: string; chip: string; banner: string; label: string }> = {
  red: { bar: "border-l-red-600", chip: "bg-red-600 text-white", banner: "border-red-600 bg-red-50", label: "Red" },
  amber: { bar: "border-l-amber-500", chip: "bg-amber-400 text-amber-950", banner: "border-amber-500 bg-amber-50", label: "Amber" },
  green: { bar: "border-l-emerald-600", chip: "bg-emerald-600 text-white", banner: "border-emerald-600 bg-emerald-50", label: "Green" },
  script: { bar: "border-l-indigo-500", chip: "bg-indigo-100 text-indigo-800", banner: "border-indigo-500 bg-indigo-50", label: "Script gap" },
};

function RagChip({ rag }: { rag: Rag }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${RAG_STYLE[rag].chip}`}>{RAG_STYLE[rag].label}</span>;
}

export function Summary({ t, onJump, onFull }: { t: Triage; onJump: (e: EvidenceItem) => void; onFull: () => void }) {
  const v = RAG_STYLE[t.verdict];
  const group = (rag: Rag, heading: string, note: string) => {
    const lines = t.lines.filter((l) => l.rag === rag);
    if (lines.length === 0) return null;
    return (
      <section className="mt-6">
        <h3 className="flex items-center gap-2 text-lg font-bold"><RagChip rag={rag} /> {heading} <span className="text-sm font-normal text-slate-500">({lines.length})</span></h3>
        <p className="text-xs text-slate-600">{note}</p>
        {lines.map((l, i) => (
          <Fragment key={i}>
            {(i === 0 || lines[i - 1].area !== l.area) && <p className="mt-3 text-xs font-bold uppercase tracking-wide text-slate-500">{l.area}</p>}
            {rag === "red" ? <TriageCard line={l} onJump={onJump} /> : <CompactCard line={l} onJump={onJump} />}
          </Fragment>
        ))}
      </section>
    );
  };
  const green = t.lines.filter((l) => l.rag === "green");
  return (
    <div className="mt-4">
      <div className={`rounded-lg border-2 p-4 ${v.banner}`}>
        <p className="flex items-center gap-2 text-xl font-bold">Overall <RagChip rag={t.verdict} /></p>
        <p className="mt-1 text-sm">
          <strong>{t.counts.red}</strong> to put right · <strong>{t.counts.amber}</strong> to go through with the seller
          {t.counts.script > 0 && <> · <strong>{t.counts.script}</strong> script gap{t.counts.script === 1 ? "" : "s"} for Guy</>}
          {" "}· <strong>{t.counts.green}</strong> met
        </p>
        <p className="mt-2 text-xs text-slate-600">
          One line per issue: script wording missed under a standard is listed on that standard&apos;s line. Red follows
          Openwork&apos;s rule that failing an asterisked standard fails the section; a client priority not addressed, a
          serious consistency finding and a suitability report that doesn&apos;t match the calls are red too. The actions are
          suggestions: you decide. Click a time to open the call at that moment.
        </p>
      </div>
      {group("red", "Put right", "Openwork mandatory standards not met, and problems with the advice itself.")}
      {group("amber", "Go through with the seller", "Missing or incomplete wording, partial failures and areas to improve.")}
      {group("script", "Script gaps", "Points the script doesn't cover, or where its wording falls short. Not counted against the seller.")}
      {green.length > 0 && (
        <details className="mt-6 text-sm">
          <summary className="cursor-pointer text-lg font-bold"><RagChip rag="green" /> Met <span className="text-sm font-normal text-slate-500">({green.length})</span></summary>
          <ul className="mt-2 space-y-1">
            {green.map((l, i) => <li key={i}><span className="font-mono text-xs text-slate-500">{l.ref}</span> {l.title}</li>)}
          </ul>
        </details>
      )}
      <p className="no-print mt-6 text-sm">
        <button type="button" onClick={onFull} className="text-teal-800 underline">Open the full report</button>
        <span className="text-slate-500"> for every check, the client facts, the recommendation and the reviewer sign-off.</span>
      </p>
    </div>
  );
}

function shorten(s: string, max = 220): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 10);
  return `${s.slice(0, cut > 0 ? cut : max)}…`;
}

/** Amber and script-gap lines: a short paragraph each, the full text one click away. */
function CompactCard({ line, onJump }: { line: TriageLine; onJump: (e: EvidenceItem) => void }) {
  const more = line.why.length > 220 || line.points.some((p) => p.detail);
  return (
    <div className={`mt-2 break-inside-avoid rounded border border-l-4 border-slate-200 bg-white px-3 py-2 text-sm ${RAG_STYLE[line.rag].bar}`}>
      <p className="font-semibold">
        {line.ref && <span className="mr-1 font-mono text-xs text-slate-500">{line.ref}</span>}
        {line.title}
      </p>
      {line.why && <p className="mt-0.5 text-slate-700">{shorten(line.why)}</p>}
      {line.points.length > 0 && (
        <p className="mt-0.5 text-xs text-slate-600">
          <span className="font-semibold">Script wording: </span>
          {line.points.map((p) => `${p.label} (${p.result})`).join("; ")}
        </p>
      )}
      {line.evidence.length > 0 && <div className="mt-0.5"><EvidenceLinks ev={line.evidence.slice(0, 1)} onJump={onJump} /></div>}
      <p className="mt-1 text-xs"><span className="font-semibold">Action: </span>{line.action}</p>
      {more && (
        <details className="no-print mt-1 text-xs">
          <summary className="cursor-pointer text-teal-800">Full detail</summary>
          <div className="mt-1 border-t border-slate-100 pt-1">
            {line.why && <p>{line.why}</p>}
            {line.points.length > 0 && (
              <ul className="mt-1 list-disc space-y-1 pl-5">
                {line.points.map((p, i) => (
                  <li key={i}>
                    <span className="font-medium">{p.label}</span> <span className="text-slate-500">({p.result})</span>{p.detail ? `: ${p.detail}` : ""}
                    {p.evidence.length > 0 && <EvidenceLinks ev={p.evidence.slice(0, 1)} onJump={onJump} />}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
      )}
    </div>
  );
}

function TriageCard({ line, onJump }: { line: TriageLine; onJump: (e: EvidenceItem) => void }) {
  return (
    <div className={`mt-2 break-inside-avoid rounded border border-l-4 border-slate-200 bg-white p-3 text-sm ${RAG_STYLE[line.rag].bar}`}>
      <p className="font-semibold">
        {line.ref && <span className="mr-1 font-mono text-xs text-slate-500">{line.ref}</span>}
        {line.title}
      </p>
      {line.why && <p className="mt-1"><span className="font-semibold">What went wrong: </span>{line.why}</p>}
      {line.points.length > 0 && (
        <ul className="mt-1 list-disc space-y-1 pl-5">
          {line.points.map((p, i) => (
            <li key={i}>
              <span className="font-medium">{p.label}</span> <span className="text-slate-500">({p.result})</span>{p.detail ? `: ${p.detail}` : ""}
              {p.evidence.length > 0 && <EvidenceLinks ev={p.evidence.slice(0, 1)} onJump={onJump} />}
            </li>
          ))}
        </ul>
      )}
      {line.evidence.length > 0 && (
        <div className="mt-1">
          <p className="text-xs font-semibold">Where in the call</p>
          <EvidenceLinks ev={line.evidence.slice(0, 2)} onJump={onJump} />
        </div>
      )}
      {line.action && <p className="mt-2 rounded bg-slate-50 px-2 py-1"><span className="font-semibold">Action: </span>{line.action}</p>}
    </div>
  );
}
