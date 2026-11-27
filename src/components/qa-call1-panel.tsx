"use client";

/**
 * The call 1 check on a two-call sale (Gate 6, Guy 26 Nov 2026): the fact
 * find call checked on its own, before the advice call, against the online
 * Fact Find, the SAF and the observation form, with the points to cover on
 * call 2 first.
 */
import { useState } from "react";
import { plainReason } from "@/lib/qa/shared";
import { formatUsd } from "@/lib/qa/cost";
import { EvidenceLinks } from "@/components/qa-summary";
import type { Call1RunResult, EvidenceItem } from "@/lib/qa/schemas";

interface Call1Run {
  status: "running" | "done" | "failed";
  result: unknown;
  error: string | null;
  started_by: string | null;
  started_at: string;
  cost_usd: number | null;
}

const ACTION: Record<string, string> = {
  ASK_CLIENT: "Ask the client", TELL_CLIENT: "Tell the client", FIX_SHEET: "Fix the Fact Find", SPEAK_TO_GUY: "Speak to Guy",
};
const SHEET: Record<string, string> = {
  NOT_ON_CALL: "On the Fact Find, not on the call", CONTRADICTED: "The call says otherwise", NOT_ON_SHEET: "Said on the call, not on the Fact Find",
};
const DISCLOSURE: Record<string, string> = {
  DELIVERED_IN_FULL: "Delivered", PARTIAL: "Partly", MISSING: "Missing", REVIEW_REQUIRED: "To review",
};
const RECAP: Record<string, string> = { DONE: "Done", PARTIAL: "Partly", NOT_DONE: "Not done", REVIEW_REQUIRED: "To review" };

export function Call1Panel({ caseId, run, disabledReason, onJump, onStarted }: {
  caseId: number; run: Call1Run | null; disabledReason: string | null;
  onJump: (e: EvidenceItem) => void; onStarted: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const running = run?.status === "running";
  const r = run?.status === "done" ? (run.result as Call1RunResult | null) : null;
  const c = r?.call1;

  async function start() {
    setError(null);
    const res = await fetch(`/api/qa/cases/${caseId}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gate: 6 }),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) setError(j.error || `HTTP ${res.status}`);
    onStarted();
  }

  return (
    <section className="mt-6 rounded-lg border-2 border-sky-700 bg-white p-4 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-bold">Call 1 check: before the advice call</h2>
        <button type="button" onClick={start} disabled={running || !!disabledReason} title={disabledReason ?? undefined}
          className="no-print rounded bg-sky-700 px-3 py-1.5 font-medium text-white hover:bg-sky-800 disabled:opacity-40">
          {running ? "Running…" : run ? "Run again" : "Run check"}
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-600">
        The fact find call on its own, against the online Fact Find, the SAF and Openwork&apos;s observation form, so anything
        missed can be put right on the advice call. It runs by itself once the fact find call is transcribed and the
        seller&apos;s advice check is linked (or after an hour without one), and emails Poz the points.
      </p>
      {disabledReason && !run && <p className="mt-1 text-xs text-slate-500">{disabledReason}</p>}
      {run && (
        <p className="mt-1 text-xs text-slate-500">
          {running ? "Running since " : run.status === "done" ? "Last run " : "Last run failed, "}
          {new Date(run.started_at).toLocaleString("en-GB")} by {run.started_by}
          {run.cost_usd != null && !running && ` · estimated cost ${formatUsd(run.cost_usd)}`}
        </p>
      )}
      {run?.status === "failed" && run.error && <p className="mt-1 text-xs text-red-700" title={run.error}>{plainReason(run.error)}</p>}
      {error && <p className="mt-1 text-xs text-red-700">{error}</p>}

      {c && (
        <div className="mt-3 space-y-4">
          <p className="rounded bg-sky-50 p-2 font-medium">{c.summary}</p>

          <div>
            <h3 className="font-bold">Points for call 2</h3>
            {c.for_call_2.length === 0 ? <p className="mt-1 text-slate-600">Nothing to put right on call 2.</p> : (
              <ol className="mt-1 space-y-2">
                {c.for_call_2.map((p, i) => (
                  <li key={i} className="rounded border border-slate-200 p-2">
                    <p><span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-xs font-semibold text-white">{i + 1}. {ACTION[p.action] ?? p.action}</span>{p.point}</p>
                    <p className="mt-1 text-xs text-slate-500">{p.why}{p.mandatory ? " (mandatory)" : ""}</p>
                    {p.evidence.length > 0 && <div className="mt-1"><EvidenceLinks ev={p.evidence} onJump={onJump} /></div>}
                  </li>
                ))}
              </ol>
            )}
          </div>

          <div>
            <h3 className="font-bold">Online Fact Find against the call</h3>
            {r?.fact_find === null ? (
              <p className="mt-1 text-slate-600">No online Fact Find was linked to this sale when it ran. Link the seller&apos;s advice check below and it runs again by itself with it.</p>
            ) : c.sheet_vs_call.length === 0 ? <p className="mt-1 text-slate-600">No differences found.</p> : (
              <ul className="mt-1 space-y-2">
                {c.sheet_vs_call.map((d, i) => (
                  <li key={i} className="rounded border border-amber-300 bg-amber-50 p-2">
                    <p className="font-medium">{d.item} <span className="ml-1 text-xs font-normal text-amber-900">{SHEET[d.result] ?? d.result}</span></p>
                    {d.sheet_says && <p className="text-xs"><span className="font-semibold">Fact Find:</span> {d.sheet_says}</p>}
                    {d.call_says && <p className="text-xs"><span className="font-semibold">Call:</span> {d.call_says}</p>}
                    {d.evidence.length > 0 && <div className="mt-1"><EvidenceLinks ev={d.evidence} onJump={onJump} /></div>}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <h3 className="font-bold">Opening and disclosures</h3>
              <ul className="mt-1 space-y-1">
                {c.disclosures.map((d, i) => (
                  <li key={i} className="text-xs">
                    <span className={`mr-1 font-semibold ${d.result === "DELIVERED_IN_FULL" ? "text-green-800" : d.result === "REVIEW_REQUIRED" ? "text-amber-800" : "text-red-800"}`}>
                      {DISCLOSURE[d.result] ?? d.result}
                    </span>
                    {d.name}{d.script_gap ? " (script gap)" : ""}{d.differences ? `: ${d.differences}` : ""}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h3 className="font-bold">Recap of priorities and concerns</h3>
              <p className="mt-1 text-xs"><span className="mr-1 font-semibold">{RECAP[c.recap.result] ?? c.recap.result}.</span>{c.recap.finding}</p>
              {c.recap.evidence.length > 0 && <div className="mt-1"><EvidenceLinks ev={c.recap.evidence} onJump={onJump} /></div>}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
