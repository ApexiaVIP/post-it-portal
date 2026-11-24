"use client";

/**
 * Call QA summary (Poz and Guy, 19 and 20 Nov 2026): the front page of a
 * case's report, built around the one decision Pauline makes on a sale. It
 * says what happens next, shows the callback list the seller will get (the
 * points to put right with the client before the sale is submitted) and the
 * draft suitability report written from the call, and keeps coaching points,
 * script gaps and passes out of the way. Built by triage() from the checker's
 * existing results. Since 24 Nov 2026 the callback list is only the red lines
 * (lib/qa/red-lines.ts), with everything else folded away.
 */
import { useState, type ReactNode } from "react";
import type { EvidenceItem, LetterResult } from "@/lib/qa/schemas";
import type { Rag, Triage, TriageLine } from "@/lib/qa/triage";
import { GAP_MARK, LETTER_HEADING, letterText, orderedSections } from "@/lib/qa/letter";
import { plainReason } from "@/lib/qa/shared";

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

function TimeLinks({ ev, onJump }: { ev: EvidenceItem[]; onJump: (e: EvidenceItem) => void }) {
  if (ev.length === 0) return null;
  return (
    <span className="ml-1 whitespace-nowrap">
      {ev.slice(0, 3).map((e, i) => (
        <button key={i} type="button" onClick={() => onJump(e)} title={e.quote}
          className="no-print-link mr-1 font-mono text-xs text-teal-800 hover:underline">
          C{e.call} {e.time}
        </button>
      ))}
    </span>
  );
}

const RAG_STYLE: Record<Rag, { chip: string; banner: string; label: string }> = {
  red: { chip: "bg-red-600 text-white", banner: "border-red-600", label: "Red" },
  amber: { chip: "bg-amber-400 text-amber-950", banner: "border-amber-500", label: "Amber" },
  green: { chip: "bg-emerald-600 text-white", banner: "border-emerald-600", label: "Green" },
  script: { chip: "bg-indigo-100 text-indigo-800", banner: "border-indigo-500", label: "Script gap" },
};

function RagChip({ rag }: { rag: Rag }) {
  return <span className={`inline-block rounded px-1.5 py-0.5 text-[11px] font-bold uppercase ${RAG_STYLE[rag].chip}`}>{RAG_STYLE[rag].label}</span>;
}

export interface SummaryCase {
  seller: string | null;
  dealStatus: string | null;
  dealChecked: boolean;
  callbackSentAt: string | null;
  callbackSentBy: string | null;
}

export interface SummaryLetter {
  /** The latest draft run on the case, whatever its state. */
  run: { status: "running" | "done" | "failed"; error: string | null } | null;
  /** The draft written alongside the call check shown, if there is one. */
  current: LetterResult | null;
  /** The call check has finished, so a draft can be written. */
  canDraft: boolean;
  /** Starts a draft; resolves to an error message, or null when started. */
  onDraft: () => Promise<string | null>;
}

export interface SummaryRedLines {
  /** The latest red lines run on the case, whatever its state. */
  run: { status: "running" | "done" | "failed"; error: string | null } | null;
  canPick: boolean;
  /** Starts picking them out; resolves to an error message, or null when started. */
  onPick: () => Promise<string | null>;
}

export function Summary({ t, onJump, onFull, kase, onSend, letter, redLines }: {
  t: Triage;
  onJump: (e: EvidenceItem) => void;
  onFull: () => void;
  kase: SummaryCase;
  /** Sends the list and the draft; resolves to an error message, or null when sent. */
  onSend: () => Promise<string | null>;
  letter: SummaryLetter;
  redLines: SummaryRedLines;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const seller = kase.seller ?? "the seller";
  const nys = kase.dealStatus === "not_yet_submitted";
  const submitted = !!kase.dealStatus && !nys;
  const items = t.callback.reduce((n, g) => n + g.items.length, 0);
  const decide = t.lines.filter((l) => l.route === "decide");
  const coach = t.lines.filter((l) => l.route === "coach");
  const scripts = t.lines.filter((l) => l.route === "script");
  const met = t.lines.filter((l) => l.route === "met");
  const hasLetter = !!letter.current;
  const canSend = items > 0 || hasLetter;
  const what = items > 0 && hasLetter ? "the callback list and the draft report"
    : items > 0 ? "the callback list" : "the draft report";

  const headline =
    t.outcome === "decide" ? "This needs your decision first."
    : t.outcome === "clear" ? "Nothing to put right with the client."
    : `${seller} should call the client back${submitted ? "" : " before this is submitted"}.`;
  const sub =
    t.outcome === "callback_review" ? "Then check the advice still fits before it goes any further: some of the points are about the recommendation itself."
    : t.outcome === "callback" ? (t.red ? "" : "The points are all things the client should have heard on the call. None of them question the recommendation.")
    : t.outcome === "clear" ? `${hasLetter ? `The draft suitability report below is ready for ${seller}. ` : ""}The ${coach.length} learning point${coach.length === 1 ? "" : "s"} are for ${seller}'s next calls.`
    : "";
  const timing = !kase.dealStatus ? null
    : nys ? "The sale is Not Yet Submitted, so all of this can be put right before it goes to the insurer."
    : "The sale has already been submitted, so the callback should happen within the 30-day cancellation period.";

  async function pick() {
    setPicking(true); setError(null);
    const err = await redLines.onPick();
    setPicking(false);
    if (err) setError(err);
  }
  async function send() {
    if (!confirm(`Email ${seller} ${what}, copying you${nys && items > 0 ? ", and mark the sale Checked on the RECI" : ""}?`)) return;
    setBusy(true); setError(null);
    const err = await onSend();
    setBusy(false);
    if (err) setError(err);
  }

  return (
    <div className="mt-4">
      <div className={`rounded-lg border-2 bg-white p-4 ${RAG_STYLE[t.verdict].banner}`}>
        <p className="flex flex-wrap items-center gap-2 text-xs text-slate-600">
          <RagChip rag={t.verdict} />
          <span>{t.red ? `${items} red line${items === 1 ? "" : "s"}` : `${items} point${items === 1 ? "" : "s"} for the callback · ${coach.length} for next time`}{scripts.length > 0 ? ` · ${scripts.length} script gap${scripts.length === 1 ? "" : "s"}` : ""} · {met.length} met</span>
        </p>
        <h2 className="mt-2 text-xl font-bold">{headline}</h2>
        {t.red?.summary && <p className="mt-1 text-sm font-medium">{t.red.summary}</p>}
        {sub && !(t.red && t.outcome === "clear") && <p className="mt-1 text-sm">{sub}</p>}
        {timing && <p className="mt-1 text-sm text-slate-600">{timing}</p>}
        {canSend && (
          <div className="no-print mt-3 flex flex-wrap items-center gap-3">
            <button type="button" onClick={send} disabled={busy}
              className="rounded bg-teal-700 px-4 py-2 text-sm font-semibold text-white hover:bg-teal-800 disabled:opacity-40">
              {busy ? "Sending…" : kase.callbackSentAt ? `Send to ${seller} again` : `Send ${what} to ${seller}`}
            </button>
            <span className="text-xs text-slate-600">
              {kase.callbackSentAt
                ? <>Sent {new Date(kase.callbackSentAt).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })} by {kase.callbackSentBy}.{kase.dealChecked ? " The sale is marked Checked on the RECI." : ""}</>
                : <>Emails {seller} {what} below with the learning points for next time, copying you and no one else{nys && items > 0 ? ". It also marks the sale Checked on the RECI so it isn't submitted until you're happy" : ""}.{letter.run?.status === "running" ? " The draft report is still being written: wait a few minutes if you want it in the same email." : ""}</>}
            </span>
          </div>
        )}
        {!t.red && redLines.canPick && (
          <div className="no-print mt-3 rounded border border-slate-200 bg-slate-50 p-2 text-sm">
            {redLines.run?.status === "running" ? "Picking out the red lines. This takes about a minute and the page updates itself." : (
              <>
                <button type="button" onClick={pick} disabled={picking} className="font-semibold text-teal-800 underline disabled:opacity-40">
                  {picking ? "Starting…" : redLines.run?.status === "failed" ? "Try picking out the red lines again" : "Pick out the red lines"}
                </button>{" "}
                <span className="text-slate-600">to cut this down to what decides whether the sale passes. The check isn&apos;t run again.
                  {letter.current ? " Any point numbers in the draft report are replaced by the points in full." : ""}</span>
              </>
            )}
          </div>
        )}
        {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
      </div>

      {decide.length > 0 && (
        <section className="mt-6">
          <h3 className="text-lg font-bold">For your decision</h3>
          {decide.map((l, i) => (
            <div key={i} className="mt-2 rounded border border-l-4 border-slate-200 border-l-red-600 bg-white p-3 text-sm">
              <p className="font-semibold">{l.title}</p>
              {l.why && <p className="mt-1 text-slate-700">{l.why}</p>}
              <p className="mt-1"><span className="font-semibold">To decide: </span>{l.action}</p>
              <TimeLinks ev={l.evidence} onJump={onJump} />
            </div>
          ))}
        </section>
      )}

      {t.callback.length > 0 && (
        <section className="mt-6">
          <h3 className="text-lg font-bold">{t.red ? "The red lines" : "The callback list"}</h3>
          <p className="text-xs text-slate-600">What {seller} will be asked to cover with the client, {t.red ? "most serious first" : "in the order a callback would run"}. Click a time to hear it in the call.</p>
          <ol className="mt-2 space-y-3">
            {(() => {
              let n = 0;
              return t.callback.map((g) => (
                <li key={g.topic} className="list-none">
                  <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{g.label}</p>
                  <div className="mt-1 space-y-2">
                    {g.items.map((item, i) => {
                      n++;
                      return (
                        <div key={i} className="break-inside-avoid rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                          <p>
                            <span className="mr-1 font-bold">{n}.</span>{item.ask}
                            {item.adviceCheck && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">check the advice after</span>}
                            <TimeLinks ev={item.evidence} onJump={onJump} />
                          </p>
                          {item.why && <p className="text-xs text-slate-500">{item.why}</p>}
                          {item.details.length > 0 && (
                            <ul className="mt-1 list-disc space-y-0.5 pl-6 text-slate-700">
                              {item.details.map((d, j) => <li key={j}>{d}</li>)}
                            </ul>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </li>
              ));
            })()}
          </ol>
        </section>
      )}

      <LetterPanel seller={seller} letter={letter} onJump={onJump} />

      {t.red && t.red.coaching.length > 0 && (
        <section className="mt-6">
          <h3 className="text-lg font-bold">For {seller}&apos;s next call</h3>
          <ul className="mt-1 list-disc space-y-0.5 pl-6 text-sm">{t.red.coaching.map((c, i) => <li key={i}>{c}</li>)}</ul>
        </section>
      )}
      <Fold title="Smaller points" count={t.smaller?.length ?? 0} note="Not red lines, so they don't go to the seller. Nothing here decides whether the sale passes.">
        {(t.smaller ?? []).map((l, i) => <LineRow key={i} line={l} onJump={onJump} />)}
      </Fold>
      <Fold title={t.red ? "Learning points" : "For next time"} count={coach.length} note={t.red ? "Everything else noted on the call. These don't go to the seller: the three above do." : `Learning points for ${seller}. No need to contact the client about these. They go with the callback list.`}>
        {coach.map((l, i) => <LineRow key={i} line={l} onJump={onJump} />)}
      </Fold>
      <Fold title="Script gaps, for Guy" count={scripts.length} note="Points the script doesn't cover, or where its wording falls short. Not counted against the seller.">
        {scripts.map((l, i) => <LineRow key={i} line={l} onJump={onJump} />)}
      </Fold>
      <Fold title="Met" count={met.length} note="Openwork standards the call met.">
        <ul className="space-y-1">
          {met.map((l, i) => <li key={i}><span className="font-mono text-xs text-slate-500">{l.ref}</span> {l.title}</li>)}
        </ul>
      </Fold>

      <p className="no-print mt-6 text-sm">
        <button type="button" onClick={onFull} className="text-teal-800 underline">Open the full report</button>
        <span className="text-slate-500"> for every check, the client facts, the recommendation and the reviewer sign-off.</span>
      </p>
    </div>
  );
}

/** The draft suitability report, section by section, with what still needs confirming marked. */
function LetterPanel({ seller, letter, onJump }: { seller: string; letter: SummaryLetter; onJump: (e: EvidenceItem) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const run = letter.run;
  const cur = letter.current;
  const running = run?.status === "running";

  async function draft() {
    setBusy(true); setError(null);
    const err = await letter.onDraft();
    setBusy(false);
    if (err) setError(err);
  }
  async function copy(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      setError("Couldn't copy: select the text and copy it instead.");
    }
  }

  return (
    <section className="mt-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-lg font-bold">Draft suitability report</h3>
        {cur && (
          <button type="button" onClick={() => copy("all", letterText(cur))} className="no-print text-xs text-teal-800 underline">
            {copied === "all" ? "Copied" : "Copy it all"}
          </button>
        )}
      </div>
      <p className="text-xs text-slate-600">
        Written from the call in {seller}&apos;s voice, for {seller} to check, change and use in Concert. It goes to {seller} and you only.
        Anything marked <Marked text="[To confirm: ...]" /> wasn&apos;t covered on the call and is on the callback list.
      </p>

      {running && (
        <p className="mt-2 rounded border border-slate-200 bg-white p-3 text-sm text-slate-600">
          Writing the draft from the call. This takes two or three minutes and the page updates itself.
        </p>
      )}

      {!running && !cur && (
        <div className="no-print mt-2 rounded border border-slate-200 bg-white p-3 text-sm">
          <p className={run?.status === "failed" ? "text-red-700" : "text-slate-600"}>
            {run?.status === "failed" ? `The last draft didn't finish: ${plainReason(run.error)}`
              : run?.status === "done" ? "The draft on file was written before the latest call check, so it may not match it."
              : "No draft yet. From now on a sale gets one automatically a few minutes after its call check."}
          </p>
          {letter.canDraft ? (
            <button type="button" onClick={draft} disabled={busy}
              className="mt-2 rounded bg-teal-700 px-3 py-1.5 font-medium text-white hover:bg-teal-800 disabled:opacity-40">
              {busy ? "Starting…" : run ? "Draft it again" : "Draft it now"}
            </button>
          ) : (
            <p className="mt-1 text-xs text-slate-500">The draft is written once the call check has finished.</p>
          )}
        </div>
      )}

      {cur && (
        <div className="mt-2 space-y-2">
          {orderedSections(cur).map((sec) => {
            const gaps = cur.letter.gaps.filter((g) => g.section === sec.key);
            return (
              <div key={sec.key} className="break-inside-avoid rounded border border-slate-200 bg-white px-3 py-2 text-sm">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <p className="font-bold">{LETTER_HEADING[sec.key]}</p>
                  <span className="no-print flex items-center gap-1">
                    <TimeLinks ev={sec.evidence} onJump={onJump} />
                    <button type="button" onClick={() => copy(sec.key, sec.text.trim())} className="text-xs text-teal-800 underline">
                      {copied === sec.key ? "Copied" : "Copy"}
                    </button>
                  </span>
                </div>
                <div className="mt-1 space-y-2 text-slate-800">
                  {sec.text.trim().split(/\n{2,}/).map((para, i) => (
                    <p key={i} className="whitespace-pre-line">{withMarks(para)}</p>
                  ))}
                </div>
                {gaps.length > 0 && (
                  <ul className="mt-2 space-y-0.5 text-xs text-amber-900">
                    {gaps.map((g, i) => (
                      <li key={i}>To confirm: {g.missing} {g.callback_point ? `(callback point ${g.callback_point})` : "(added to the callback list)"}</li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
          {cur.letter.seller_notes.length > 0 && (
            <div className="break-inside-avoid rounded border border-amber-300 bg-amber-50 px-3 py-2 text-sm">
              <p className="font-bold">Before {seller} uses it, check</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-6">
                {cur.letter.seller_notes.map((n, i) => <li key={i}>{n}</li>)}
              </ul>
            </div>
          )}
          {letter.canDraft && (
            <p className="no-print text-xs text-slate-500">
              <button type="button" onClick={draft} disabled={busy} className="text-teal-800 underline disabled:opacity-40">
                {busy ? "Starting…" : "Draft it again"}
              </button>{" "}
              if the wording needs another go.
            </p>
          )}
        </div>
      )}
      {error && <p className="mt-1 text-sm text-red-700">{error}</p>}
    </section>
  );
}

function Marked({ text }: { text: string }) {
  return <mark className="rounded bg-amber-100 px-0.5 text-amber-900">{text}</mark>;
}

/** The text with each "[To confirm: ...]" highlighted. */
function withMarks(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const re = new RegExp(GAP_MARK.source, "g");
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(<Marked key={m.index} text={m[0]} />);
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

function Fold({ title, count, note, children }: { title: string; count: number; note: string; children: ReactNode }) {
  if (count === 0) return null;
  return (
    <details className="mt-4 rounded border border-slate-200 bg-white px-3 py-2 text-sm">
      <summary className="cursor-pointer font-bold">{title} <span className="font-normal text-slate-500">({count})</span></summary>
      <p className="mt-1 text-xs text-slate-600">{note}</p>
      <div className="mt-2 space-y-2">{children}</div>
    </details>
  );
}

function shorten(s: string, max = 220): string {
  if (s.length <= max) return s;
  const cut = s.lastIndexOf(" ", max - 10);
  return `${s.slice(0, cut > 0 ? cut : max)}…`;
}

function LineRow({ line, onJump }: { line: TriageLine; onJump: (e: EvidenceItem) => void }) {
  return (
    <div className="border-t border-slate-100 pt-2">
      <p className="font-medium">
        {line.ref && <span className="mr-1 font-mono text-xs text-slate-500">{line.ref}</span>}
        {line.title}
        <TimeLinks ev={line.evidence} onJump={onJump} />
      </p>
      {line.why && <p className="text-slate-600">{shorten(line.why)}</p>}
      {line.points.length > 0 && (
        <p className="text-xs text-slate-500">Script wording: {line.points.map((p) => `${p.label} (${p.result})`).join("; ")}</p>
      )}
    </div>
  );
}
