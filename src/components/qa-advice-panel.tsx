"use client";

/**
 * The seller's advice check on a Call QA case page (23 Nov 2026): link the
 * check the seller ran before presenting advice to this sale, and see its
 * statements tested against the calls (Gate 4). Points the calls don't back
 * up go on the callback list.
 */
import { useState } from "react";
import Link from "next/link";
import { READINESS_STYLE, type CheckSummary } from "@/lib/advice/shared";
import { STATEMENT_LABEL, STATEMENT_STYLE, currentStatements, type CheckStatement } from "@/lib/qa/notes-check";
import { plainReason } from "@/lib/qa/shared";
import type { EvidenceItem } from "@/lib/qa/schemas";

export interface AdviceBrief {
  id: number;
  client_label: string;
  adviser_name: string | null;
  created_by: string;
  created_at: string;
  finished_at: string | null;
  status: string;
  linked_by: string | null;
  linked_at: string | null;
  summary: CheckSummary | null;
  name_match?: boolean;
}
export interface CaseAdvice {
  linked: AdviceBrief | null;
  tested: { id: number; finished_at: string | null; statements: CheckStatement[] } | null;
  candidates: AdviceBrief[];
}
interface RunLite { id: number; status: string; result: unknown; error: string | null; started_at: string }

function when(d: string): string {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function Chip({ b }: { b: AdviceBrief }) {
  if (b.summary) return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${READINESS_STYLE[b.summary.readiness]}`}>{b.summary.label}</span>;
  const t = b.status === "running" ? "Checking" : b.status === "failed" ? "Didn't finish" : b.status === "draft" ? "Not run" : "Done";
  return <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{t}</span>;
}

export function AdvicePanel({ caseId, advice, gate1, gate3, gate4, seller, onJump, onChanged }: {
  caseId: number;
  advice: CaseAdvice | undefined;
  gate1: RunLite | null;
  gate3: RunLite | null;
  gate4: RunLite | null;
  seller: string;
  onJump: (e: EvidenceItem) => void;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!advice) return null;

  async function link(checkId: number | null) {
    if (checkId === null && !confirm("Unlink the seller's advice check from this sale?")) return;
    setBusy(true); setError(null);
    const r = await fetch(`/api/qa/cases/${caseId}/advice-check`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ check_id: checkId }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setError(j.error || `HTTP ${r.status}`);
    onChanged();
  }
  async function test() {
    setBusy(true); setError(null);
    const r = await fetch(`/api/qa/cases/${caseId}/runs`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ gate: 4 }),
    });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setError(j.error || `HTTP ${r.status}`);
    onChanged();
  }

  const k = advice.linked;
  const tested = advice.tested;
  const res = currentStatements(gate4, tested?.id);
  const running4 = gate4?.status === "running";
  const failed4 = gate4?.status === "failed" ? gate4 : null;
  const byN = new Map((tested?.statements ?? []).map((s) => [s.n, s]));
  const problems = res ? res.statements.statements.filter((s) => s.result !== "SUPPORTED") : [];
  const supported = res ? res.statements.statements.length - problems.length : 0;
  const letterBefore = !!(k?.linked_at && gate3 && new Date(gate3.started_at) < new Date(k.linked_at));

  return (
    <section className="no-print mt-6">
      <h2 className="text-lg font-bold">{seller}&apos;s advice check</h2>
      <p className="text-xs text-slate-600">
        The check {seller} ran on their Fact Find sheet before presenting the advice. Linked to this sale, its notes are tested against the calls,
        and the draft suitability report is written from the calls and the sheet together.
      </p>

      {k ? (
        <div className="mt-2 rounded-lg border border-slate-300 bg-white p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="flex flex-wrap items-center gap-2">
              <Link href={`/advice-check/${k.id}`} className="font-semibold text-teal-800 hover:underline">{k.client_label}</Link>
              <Chip b={k} />
              <span className="text-xs text-slate-500">run {when(k.created_at)} by {k.adviser_name ?? k.created_by}{k.linked_by ? ` · linked by ${k.linked_by}` : ""}</span>
            </p>
            <button type="button" onClick={() => link(null)} disabled={busy} className="text-xs text-red-700 underline disabled:opacity-40">Unlink</button>
          </div>

          {!tested ? (
            <p className="mt-2 text-slate-600">The check hasn&apos;t finished yet, so there&apos;s nothing to test against the calls.</p>
          ) : tested.statements.length === 0 ? (
            <p className="mt-2 text-slate-600">This check has no notes to test: it was run before the advice call, or something was missing. It will once {seller} runs it again after the call with nothing missing.</p>
          ) : (
            <div className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="font-semibold">Their notes against the calls</p>
                <button type="button" onClick={test} disabled={busy || running4 || gate1?.status !== "done"}
                  title={gate1?.status !== "done" ? "Runs once the calls have been checked." : undefined}
                  className="rounded bg-teal-700 px-3 py-1 text-xs font-medium text-white hover:bg-teal-800 disabled:opacity-40">
                  {running4 ? "Testing…" : res ? "Test again" : "Test against the calls"}
                </button>
              </div>
              {running4 && <p className="mt-1 text-slate-600">Testing each statement against the recording. A few minutes; the page updates itself.</p>}
              {!running4 && failed4 && !res && <p className="mt-1 text-red-700">The last test didn&apos;t finish: {plainReason(failed4.error)}</p>}
              {!running4 && !res && !failed4 && (
                <p className="mt-1 text-slate-600">{gate1?.status === "done" ? "Not tested yet." : "Tested automatically once the calls have been checked."}</p>
              )}
              {res && (
                <>
                  <p className="mt-1 text-slate-700">
                    {supported} of {res.statements.statements.length} on the call. {res.statements.summary}
                    {problems.some((p) => p.result !== "REVIEW_REQUIRED") ? " The ones the call doesn't back up are on the callback list." : ""}
                  </p>
                  {problems.length > 0 && (
                    <ul className="mt-2 space-y-1">
                      {problems.map((s) => (
                        <li key={s.n} className="rounded border border-slate-200 px-2 py-1">
                          <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATEMENT_STYLE[s.result]}`}>{STATEMENT_LABEL[s.result]}</span>
                          <span className="font-bold">{s.n}.</span> {byN.get(s.n)?.text ?? ""}
                          {s.call_says && <div className="text-xs text-slate-700">On the call: {s.call_says}</div>}
                          {s.evidence.length > 0 && (
                            <div className="text-xs">
                              {s.evidence.map((e, i) => (
                                <button key={i} type="button" onClick={() => onJump(e)} className="mr-2 text-teal-800 underline">call {e.call} {e.time}</button>
                              ))}
                            </div>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                  {res.statements.missing_from_notes.length > 0 && (
                    <div className="mt-2">
                      <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Said on the call, not in their notes</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-6">
                        {res.statements.missing_from_notes.map((m, i) => (
                          <li key={i}>{m.item}{" "}
                            {m.evidence.map((e, j) => (
                              <button key={j} type="button" onClick={() => onJump(e)} className="mr-1 text-xs text-teal-800 underline">call {e.call} {e.time}</button>
                            ))}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
          {letterBefore && (
            <p className="mt-3 rounded bg-amber-50 px-2 py-1 text-xs text-amber-900">
              The draft suitability report was written before this check was linked. Draft it again (in the summary below) to use {seller}&apos;s sheet.
            </p>
          )}
        </div>
      ) : (
        <div className="mt-2 rounded-lg border border-slate-300 bg-white p-3 text-sm">
          {advice.candidates.length === 0 ? (
            <p className="text-slate-600">No unlinked advice checks from {seller} in the last 60 days.</p>
          ) : (
            <>
              <p className="text-slate-600">Which of {seller}&apos;s checks is this sale?</p>
              <ul className="mt-2 space-y-1">
                {advice.candidates.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-200 px-2 py-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <Link href={`/advice-check/${c.id}`} className="font-medium text-teal-800 hover:underline">{c.client_label}</Link>
                      <Chip b={c} />
                      <span className="text-xs text-slate-500">{when(c.created_at)} · {c.adviser_name ?? c.created_by}</span>
                      {c.name_match && <span className="rounded bg-teal-50 px-1.5 py-0.5 text-[11px] font-semibold text-teal-800">name matches</span>}
                    </span>
                    <button type="button" onClick={() => link(c.id)} disabled={busy}
                      className="rounded border border-teal-700 px-2 py-0.5 text-xs font-medium text-teal-800 hover:bg-teal-50 disabled:opacity-40">
                      This one
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </section>
  );
}
