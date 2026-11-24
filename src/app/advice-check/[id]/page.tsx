"use client";

/**
 * Advice check: one check (Guy, 22 Nov 2026; triaged 24 Nov). Can this advice
 * be given, and the red lines, come first; the rest of the gap check is folded
 * away. After the advice call come the justification and the Concert Hub
 * notes to copy, then every statement for the check against the recording. Once the sale's calls are in Call QA, the
 * statements are tested against them and the result shows at the end.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import {
  CLOSING_LINE, GAP_ITEMS, GAP_LABEL, GAP_STATUS_LABEL, JUSTIFICATION_HEADING, JUSTIFICATION_KEYS, NOTE_HEADING, NOTE_KEYS,
  READINESS_STYLE, RED_LINE_KIND_LABEL, SCENARIO_LABEL, VERDICT_LABEL, justificationText, notesText, summarise, unreadable,
  type AdviceCheckResult, type GapItem, type GapStatus,
} from "@/lib/advice/shared";
import { STATEMENT_LABEL, STATEMENT_STYLE } from "@/lib/qa/notes-check";
import { plainReason } from "@/lib/qa/shared";
import type { StatementsRunResult } from "@/lib/qa/schemas";

interface Check {
  id: number;
  adviser_name: string | null;
  created_by: string;
  client_label: string;
  case_type: "one_call" | "two_call";
  fact_find_date: string;
  recommendation: string;
  presented: boolean;
  notes_anyway: boolean;
  sheet_text: string | null;
  status: "draft" | "running" | "done" | "failed";
  result: AdviceCheckResult | null;
  error: string | null;
  previous_id: number | null;
  fact_find_id: number | null;
  qa_case_id: number | null;
  created_at: string;
  started_at: string | null;
  finished_at: string | null;
}
interface Detail {
  check: Check;
  pages: number;
  previous: { id: number; created_at: string; gaps: { item: GapItem; status: GapStatus }[] } | null;
  next_id: number | null;
  against_calls: { id: number; status: string; result: StatementsRunResult | null; error: string | null; finished_at: string | null } | null;
  me: { reviewer: boolean };
  cost_usd?: number | null;
  standards?: { doc: string; title: string; effective_from: string }[] | null;
}

const GAP_STYLE: Record<GapStatus, string> = {
  RECORDED: "bg-emerald-100 text-emerald-800",
  MISSING: "bg-red-100 text-red-800",
  CLIENT_DECLINED: "bg-amber-100 text-amber-900",
  ON_ADVICE_CALL: "bg-sky-100 text-sky-900",
  NOT_APPLICABLE: "bg-slate-100 text-slate-600",
};

function fmtDay(d: string): string {
  return new Date(d.length === 10 ? `${d}T12:00:00` : d).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
function fmtWhen(d: string): string {
  return new Date(d).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function useCopy(): [string | null, (key: string, text: string) => Promise<void>] {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = useCallback(async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      alert("Couldn't copy: select the text and copy it instead.");
    }
  }, []);
  return [copied, copy];
}

function Section({ n, title, note, children, action }: { n?: number; title: string; note?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-slate-300 pb-1">
        <h2 className="text-lg font-bold">{n !== undefined ? `Part ${n}: ` : ""}{title}</h2>
        {action}
      </div>
      {note && <p className="mt-1 text-xs text-slate-600">{note}</p>}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function AdviceCheckPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const id = Number(params.id);
  const [data, setData] = useState<Detail | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionErr, setActionErr] = useState<string | null>(null);
  const [copied, copy] = useCopy();

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/advice-check/${id}`, { cache: "no-store" });
      if (!r.ok) throw new Error(r.status === 404 ? "Check not found." : r.status === 403 ? "You don't have access to the advice check." : `HTTP ${r.status}`);
      setData(await r.json());
    } catch (e) {
      setErr(e instanceof Error ? e.message : "load failed");
    }
  }, [id]);
  useEffect(() => { void load(); }, [load]);
  const running = data?.check.status === "running" || data?.against_calls?.status === "running";
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => { void load(); }, 4000);
    return () => clearInterval(t);
  }, [running, load]);

  async function start() {
    setBusy(true); setActionErr(null);
    const r = await fetch(`/api/advice-check/${id}/run`, { method: "POST" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) setActionErr(j.error || `HTTP ${r.status}`);
    void load();
  }
  async function remove() {
    if (!confirm("Delete this check?")) return;
    const r = await fetch(`/api/advice-check/${id}`, { method: "DELETE" });
    if (r.ok) router.push("/advice-check");
    else setActionErr((await r.json().catch(() => ({}))).error || `HTTP ${r.status}`);
  }

  if (err) return <main className="p-8 text-red-700">{err}</main>;
  if (!data) return <main className="p-8 text-slate-500">Loading…</main>;
  const c = data.check;
  const r = c.status === "done" ? c.result : null;
  const sum = summarise(r);
  const before = r?.stage === "before_advice";
  const notRead = r ? unreadable(c.sheet_text) : [];

  return (
    <main className="mx-auto max-w-5xl px-4 py-6">
      <div className="flex flex-wrap items-start justify-between gap-3 border-b-2 border-slate-900 pb-3">
        <div>
          <div className="no-print text-sm text-slate-500"><Link href="/advice-check" className="hover:underline">Advice check</Link> / check {c.id}</div>
          <h1 className="text-2xl font-bold">{c.client_label}</h1>
          <p className="text-sm text-slate-600">
            {c.adviser_name ?? c.created_by} · fact find call {fmtDay(c.fact_find_date)} · {c.case_type === "one_call" ? "one call" : "two calls"}
            {" · "}{c.presented ? "already presented" : "not yet presented"}
            {c.finished_at && c.status === "done" ? ` · checked ${fmtWhen(c.finished_at)}` : ""}
          </p>
          {c.previous_id && <p className="text-xs text-slate-500">Repeats <Link href={`/advice-check/${c.previous_id}`} className="underline">the earlier check</Link>.</p>}
          {data.next_id && <p className="text-xs font-semibold text-amber-800">There is a newer check on this case: <Link href={`/advice-check/${data.next_id}`} className="underline">open it</Link>.</p>}
        </div>
        <div className="no-print flex flex-wrap gap-2 text-sm">
          {c.status === "done" && (
            <Link href={c.fact_find_id ? `/advice-check/form/${c.fact_find_id}` : `/advice-check/new?from=${c.id}`} className="rounded bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800">
              {c.fact_find_id ? "Back to the form" : "Run it again with the updated sheet"}
            </Link>
          )}
          {c.status === "done" && <button type="button" onClick={() => window.print()} className="rounded border border-slate-300 px-3 py-1.5 hover:bg-slate-50">Print</button>}
          {c.status !== "running" && <button type="button" onClick={remove} className="rounded border border-red-300 px-3 py-1.5 text-red-700 hover:bg-red-50">Delete</button>}
        </div>
      </div>

      {c.status === "running" && (
        <p className="mt-6 rounded border border-sky-200 bg-sky-50 p-4 text-sm text-sky-900">
          Checking{c.sheet_text ? "" : ": reading your sheet first, then"} against the framework and the documents Openwork assesses us on.
          This takes three to five minutes and the page updates itself. You can leave it and come back.
        </p>
      )}
      {(c.status === "failed" || c.status === "draft") && (
        <div className="mt-6 rounded border border-slate-200 bg-white p-4 text-sm">
          <p className={c.status === "failed" ? "text-red-700" : "text-slate-600"}>
            {c.status === "failed" ? `The check didn't finish: ${plainReason(c.error)}` : `This check hasn't been run yet${data.pages ? ` (${data.pages} page${data.pages === 1 ? "" : "s"} uploaded)` : ""}.`}
          </p>
          <button type="button" onClick={start} disabled={busy}
            className="mt-2 rounded bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800 disabled:opacity-40">
            {busy ? "Starting…" : c.status === "failed" ? "Try again" : "Run the check"}
          </button>
        </div>
      )}
      {actionErr && <p className="mt-2 text-sm text-red-700">{actionErr}</p>}

      {r && sum && (
        <>
          <Verdict r={r} />

          <div className={`mt-4 rounded-lg border-2 p-4 ${sum.readiness === "ready" ? "border-emerald-600 bg-emerald-50" : ["missing", "confirm", "no_recommendation", "unclear"].includes(sum.readiness) ? "border-amber-500 bg-amber-50" : "border-red-600 bg-red-50"}`}>
            <p className="flex items-center gap-2">
              <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${READINESS_STYLE[sum.readiness]}`}>{sum.label}</span>
            </p>
            <p className="mt-2 font-semibold">
              {sum.readiness === "doesnt_fit" ? "Change the recommendation or speak to Guy. Don't write notes for it as it stands."
                : sum.readiness === "speak_to_guy" ? "Speak to Guy before you present this."
                : sum.readiness === "no_recommendation" ? "No recommendation was found. Fill in the policy pages (7 to 9) or type it, then run the check again."
                : sum.readiness === "unclear" ? "The check couldn't tell whether your recommendation fits. Put right what it says above, then run it again."
                : sum.readiness === "red_lines" ? "Put these right, then run it again. Don't work around them with wording."
                : sum.readiness === "missing" ? (before ? "No red lines. Pick up the smaller gaps on the advice call if you can." : "No red lines, but the smaller gaps have to be closed before you submit.")
                : sum.readiness === "confirm" ? "You gave the check something that isn't on your sheet. Confirm it below, then run it again."
                : before ? "No red lines. Go ahead with the advice call."
                : "Nothing is missing. Use Part 2 as your rationale and paste Part 3 into Concert Hub under the matching fields. Enter every figure you gathered, mandatory or not."}
            </p>
            {r.red_lines.length > 0 && (
              <ol className="mt-3 space-y-2">
                {r.red_lines.map((x, i) => (
                  <li key={i} className="flex gap-2 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                    <span className="font-bold">{i + 1}.</span>
                    <span className="flex-1">{x.action}</span>
                    <span className="h-fit whitespace-nowrap rounded bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-700">{RED_LINE_KIND_LABEL[x.kind]}</span>
                  </li>
                ))}
              </ol>
            )}
            {before && (
              <p className="no-print mt-3 text-sm">
                After the advice call, <Link href={c.fact_find_id ? `/advice-check/form/${c.fact_find_id}#s-after` : `/advice-check/new?from=${c.id}&after=1`} className="font-semibold text-teal-800 underline">run it again for the justification and Concert Hub notes</Link>.
              </p>
            )}
          </div>

          {r.not_on_sheet.length > 0 && (
            <div className="mt-4 rounded border border-amber-300 bg-white p-3 text-sm">
              <p className="font-bold">You told the check this, but it isn&apos;t on your sheet</p>
              <p className="text-xs text-slate-600">Only if it was said on the recorded call: add it to the sheet and run the check again. If you can&apos;t confirm it, leave it out.</p>
              <ul className="mt-1 list-disc space-y-1 pl-6">{r.not_on_sheet.map((x, i) => <li key={i}><span className="font-medium">{x.statement}</span> {x.note}</li>)}</ul>
            </div>
          )}

          {notRead.length > 0 && (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <p className="font-bold">Couldn&apos;t be read clearly</p>
              <p className="text-xs text-slate-600">Check these against your sheet. If any is wrong, type it in and run the check again.</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6">{notRead.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}

          <Changes previous={data.previous} r={r} />

          <details className="mt-6 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
            <summary className="cursor-pointer font-bold">
              Everything else <span className="font-normal text-slate-500">(the full gap check{sum.smaller > 0 ? `, ${sum.smaller} smaller gap${sum.smaller === 1 ? "" : "s"}` : ""})</span>
            </summary>
            {r.questions.length > 0 && (
              <div className="mt-3">
                <p className="font-bold">Worth asking on the same call</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-6">{r.questions.map((q, i) => <li key={i}>{q}</li>)}</ul>
              </div>
            )}
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50 text-xs uppercase tracking-wide text-slate-500">
                  <tr><th className="px-3 py-2">Item</th><th className="px-3 py-2">Status</th><th className="px-3 py-2">What the sheet shows, or what to ask</th></tr>
                </thead>
                <tbody>
                  {[...r.gaps].sort((x, y) => GAP_ITEMS.indexOf(x.item) - GAP_ITEMS.indexOf(y.item)).map((g) => (
                    <tr key={g.item} className="break-inside-avoid border-b border-slate-100 align-top last:border-0">
                      <td className="px-3 py-2">{GAP_LABEL[g.item] ?? g.item}<div className="text-xs text-slate-500">{g.source}</div></td>
                      <td className="px-3 py-2"><span className={`whitespace-nowrap rounded px-1.5 py-0.5 text-[11px] font-semibold ${GAP_STYLE[g.status]}`}>{GAP_STATUS_LABEL[g.status]}</span></td>
                      <td className="px-3 py-2">{g.detail}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {r.documents_differ.length > 0 && (
              <div className="mt-3">
                <p className="font-bold">Where the documents differ</p>
                <ul className="mt-1 list-disc space-y-0.5 pl-6 text-slate-700">{r.documents_differ.map((x, i) => <li key={i}>{x}</li>)}</ul>
              </div>
            )}
          </details>

          {r.justification.length > 0 && (
            <Section n={2} title="Justification of the advice" note="The suitability rationale you can rely on, in your voice. Check every word against what was said on the call."
              action={<button type="button" onClick={() => copy("j-all", justificationText(r))} className="no-print text-xs text-teal-800 underline">{copied === "j-all" ? "Copied" : "Copy it all"}</button>}>
              <div className="space-y-2">
                {[...r.justification].sort((a, b) => JUSTIFICATION_KEYS.indexOf(a.key) - JUSTIFICATION_KEYS.indexOf(b.key)).map((j) => (
                  <div key={j.key} className="break-inside-avoid rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-bold">{JUSTIFICATION_HEADING[j.key]}</p>
                      <button type="button" onClick={() => copy(`j-${j.key}`, j.text.trim())} className="no-print text-xs text-teal-800 underline">{copied === `j-${j.key}` ? "Copied" : "Copy"}</button>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{j.text.trim()}</p>
                    {j.cites && <p className="mt-1 text-xs text-slate-500">({j.cites})</p>}
                  </div>
                ))}
              </div>
            </Section>
          )}

          {r.notes.length > 0 && (
            <Section n={3} title="Concert Hub notes" note="Paste each under the matching field. Enter every figure you gathered whether the field is mandatory or not."
              action={<button type="button" onClick={() => copy("n-all", notesText(r))} className="no-print text-xs text-teal-800 underline">{copied === "n-all" ? "Copied" : "Copy it all"}</button>}>
              <div className="space-y-2">
                {[...r.notes].sort((a, b) => NOTE_KEYS.indexOf(a.key) - NOTE_KEYS.indexOf(b.key)).map((n) => (
                  <div key={n.key} className="break-inside-avoid rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                    <div className="flex items-baseline justify-between gap-2">
                      <p className="font-bold">{NOTE_HEADING[n.key]}</p>
                      <button type="button" onClick={() => copy(`n-${n.key}`, n.text.trim())} className="no-print text-xs text-teal-800 underline">{copied === `n-${n.key}` ? "Copied" : "Copy"}</button>
                    </div>
                    <p className="mt-1 whitespace-pre-line">{n.text.trim()}</p>
                  </div>
                ))}
              </div>
              {r.dropdown_tips.length > 0 && (
                <ul className="mt-2 list-disc space-y-0.5 pl-6 text-xs text-slate-700">{r.dropdown_tips.map((t, i) => <li key={i}>{t}</li>)}</ul>
              )}
            </Section>
          )}

          {r.statements.length > 0 && (
            <Section n={4} title="Statements for the post-sale check" note="Every factual statement in Parts 2 and 3, and where it came from. Once the sale's calls are in, each one is tested against the recording. If you're not sure it was said on the call, take it out.">
              <ol className="space-y-1 text-sm">
                {r.statements.map((s) => (
                  <li key={s.n} className="break-inside-avoid">
                    <span className="mr-1 font-bold">{s.n}.</span>{s.text}{" "}
                    <span className="text-xs text-slate-500">({s.where})</span>
                    {s.from_adviser && <span className="ml-1 rounded bg-amber-100 px-1 text-[11px] font-semibold text-amber-900">from you, not the sheet</span>}
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {data.against_calls && <AgainstCalls run={data.against_calls} r={r} />}

          <p className="mt-8 border-t border-slate-200 pt-3 text-xs italic text-slate-600">{CLOSING_LINE}</p>
        </>
      )}

      {c.status !== "draft" && (
        <details className="mt-8 text-sm">
          <summary className="cursor-pointer font-semibold">What you gave the check</summary>
          {c.recommendation && (
            <>
              <p className="mt-2 font-semibold">Recommendation and reasons, as typed</p>
              <p className="whitespace-pre-line rounded border border-slate-200 bg-white p-2">{c.recommendation}</p>
            </>
          )}
          <p className="mt-3 font-semibold">The sheet, as the check read it</p>
          <pre className="whitespace-pre-wrap rounded border border-slate-200 bg-white p-2 text-xs">{c.sheet_text ?? "Not read yet."}</pre>
        </details>
      )}

      {data.me.reviewer && c.status !== "draft" && (
        <div className="no-print mt-6 text-xs text-slate-500">
          {c.qa_case_id ? <p>On <Link href={`/qa/${c.qa_case_id}`} className="underline">Call QA case {c.qa_case_id}</Link>.</p> : <p>Not linked to a Call QA sale yet: link it from the sale&apos;s case page.</p>}
          {data.cost_usd != null && <p>Estimated cost ${data.cost_usd.toFixed(2)} (list prices).</p>}
          {data.standards && data.standards.length > 0 && (
            <p>Checked against: {data.standards.map((s) => `${s.title}`).join("; ")}.</p>
          )}
        </div>
      )}
    </main>
  );
}

function Verdict({ r }: { r: AdviceCheckResult }) {
  const p = r.part0;
  const bad = p.fit.result === "DOES_NOT_FIT" || p.speak_to_guy || p.verdict === "SPEAK_TO_GUY" || p.verdict === "CANNOT_ADVISE";
  return (
    <Section n={0} title="Can this advice be given?">
      <div className={`rounded border-l-4 bg-white p-3 text-sm ${bad ? "border-red-600" : p.verdict === "CAN_ADVISE_IF" ? "border-amber-500" : "border-emerald-600"}`}>
        <p className="font-bold">{VERDICT_LABEL[p.verdict]}</p>
        {p.rows.length > 0 && <p className="text-xs text-slate-600">Scenario sheet: {p.rows.map((x) => SCENARIO_LABEL[x] ?? x).join("; ")}</p>}
        <p className="mt-1">{p.summary}</p>
        {p.speak_to_guy && <p className="mt-1 font-semibold text-red-800">Speak to Guy before you present{p.rows.includes("retired_couple") ? " term cover" : ""}.</p>}
        <p className="mt-2">
          <span className="font-semibold">Does it fit? </span>
          {p.fit.result === "FITS" ? "Yes." : p.fit.result === "DOES_NOT_FIT" ? <span className="font-semibold text-red-800">No.</span> : "Can't tell from what's here."}{" "}
          {p.fit.explanation}
        </p>
        {p.recommendation.length > 0 && (
          <div className="mt-3 overflow-x-auto">
            <p className="text-xs font-semibold text-slate-600">Your recommendation, as the check read it. If a figure is wrong, type it in and run the check again.</p>
            <table className="mt-1 w-full text-left text-xs">
              <thead className="text-slate-500"><tr>{["", "Who", "Product", "Sum assured", "Term", "Premium", "Other"].map((h) => <th key={h} className="py-1 pr-3 font-medium">{h}</th>)}</tr></thead>
              <tbody>
                {p.recommendation.map((x, i) => (
                  <tr key={i} className="border-t border-slate-100 align-top">
                    {[x.policy, x.lives, x.product, x.sum_assured, x.term, x.premium, x.other].map((v, j) => <td key={j} className="py-1 pr-3">{v}</td>)}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Section>
  );
}

function Changes({ previous, r }: { previous: Detail["previous"]; r: AdviceCheckResult }) {
  if (!previous) return null;
  const before = new Map(previous.gaps.map((g) => [g.item, g.status]));
  const changed = r.gaps.filter((g) => before.has(g.item) && before.get(g.item) !== g.status);
  return (
    <div className="mt-4 rounded border border-slate-200 bg-white p-3 text-sm">
      <p className="font-bold">Since the check of {fmtWhen(previous.created_at)}</p>
      {changed.length === 0 ? <p className="text-slate-600">No change in the gap check.</p> : (
        <ul className="mt-1 space-y-0.5">
          {changed.map((g) => (
            <li key={g.item}>{GAP_LABEL[g.item]}: {GAP_STATUS_LABEL[before.get(g.item)!]} → <span className="font-semibold">{GAP_STATUS_LABEL[g.status]}</span></li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AgainstCalls({ run, r }: { run: NonNullable<Detail["against_calls"]>; r: AdviceCheckResult }) {
  if (run.status === "running") {
    return <Section title="Your notes against the call"><p className="text-sm text-slate-600">Testing each statement against the recording. This takes a few minutes.</p></Section>;
  }
  if (run.status !== "done" || !run.result) {
    return <Section title="Your notes against the call"><p className="text-sm text-red-700">The test against the calls didn&apos;t finish: {plainReason(run.error)}</p></Section>;
  }
  const res = run.result.statements;
  const byN = new Map(r.statements.map((s) => [s.n, s]));
  const order = { CONTRADICTED: 0, NOT_ON_CALL: 1, REVIEW_REQUIRED: 2, SUPPORTED: 3 } as const;
  const list = [...res.statements].sort((a, b) => order[a.result] - order[b.result] || a.n - b.n);
  const bad = res.statements.filter((s) => s.result === "NOT_ON_CALL" || s.result === "CONTRADICTED").length;
  return (
    <Section title="Your notes against the call" note={`Tested against the recorded call${run.finished_at ? ` on ${fmtWhen(run.finished_at)}` : ""}, as Openwork's supervision team will.`}>
      <p className={`text-sm font-semibold ${bad ? "text-red-800" : "text-emerald-800"}`}>
        {bad ? `${bad} statement${bad === 1 ? "" : "s"} the call doesn't back up. Cover ${bad === 1 ? "it" : "them"} with the client on a callback, or take ${bad === 1 ? "it" : "them"} out of your notes.` : "Every statement is on the call."}
      </p>
      <p className="text-sm text-slate-700">{res.summary}</p>
      <ul className="mt-2 space-y-1 text-sm">
        {list.map((s) => (
          <li key={s.n} className="break-inside-avoid rounded border border-slate-200 bg-white px-3 py-1.5">
            <span className={`mr-2 rounded px-1.5 py-0.5 text-[11px] font-semibold ${STATEMENT_STYLE[s.result]}`}>{STATEMENT_LABEL[s.result]}</span>
            <span className="font-bold">{s.n}.</span> {byN.get(s.n)?.text ?? ""}
            {s.result !== "SUPPORTED" && s.call_says && <div className="mt-0.5 text-xs text-slate-700">On the call: {s.call_says}</div>}
            {s.evidence[0] && <div className="text-xs text-slate-500">Call {s.evidence[0].call} at {s.evidence[0].time}: &ldquo;{s.evidence[0].quote}&rdquo;</div>}
          </li>
        ))}
      </ul>
      {res.missing_from_notes.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-bold">Said on the call but not in your notes</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-6">
            {res.missing_from_notes.map((m, i) => <li key={i}>{m.item}{m.evidence[0] ? <span className="text-xs text-slate-500"> (call {m.evidence[0].call} at {m.evidence[0].time})</span> : null}</li>)}
          </ul>
        </div>
      )}
    </Section>
  );
}
