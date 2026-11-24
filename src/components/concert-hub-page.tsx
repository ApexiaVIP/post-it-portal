"use client";

/**
 * The Concert Hub page of an advice check (24 Nov 2026): the choices the
 * seller has to justify, laid out in the order of Concert Hub's screens, and
 * three short notes to paste. Anything the sheet doesn't back up says so
 * instead of suggesting a choice.
 */
import {
  HUB_DROPDOWNS, HUB_NEEDS, HUB_NEED_LABEL, HUB_NOTES, HUB_NOTE_LABEL, PROVIDER_REASON_LABEL, REPLACE_LOSS_LABEL, REPLACE_REASON_LABEL,
  addressedBy, deferredFor, hubClients, unmet, type HubDropdown, type HubPage,
} from "@/lib/advice/concert-hub";

type Copy = (key: string, text: string) => void;

function Missing() {
  return <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-900">Not on your sheet</span>;
}

function Screen({ tab, where, children }: { tab: string; where?: string; children: React.ReactNode }) {
  return (
    <div className="break-inside-avoid rounded-lg border border-slate-300 bg-white">
      <p className="rounded-t-lg border-b border-slate-200 bg-slate-100 px-3 py-1.5 text-sm">
        <span className="font-bold">{tab}</span>{where && <span className="text-slate-600"> {where}</span>}
      </p>
      <div className="px-3 py-2 text-sm">{children}</div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-4 border-t border-slate-100 py-1.5 first:border-0 sm:grid-cols-[minmax(0,16rem)_1fr]">
      <p className="text-slate-600">{label}</p>
      <div>{children}</div>
    </div>
  );
}

/** A drop-down: the option to pick, or the reason to match while we don't have its list. */
function Pick({ d, pick, why }: { d: HubDropdown; pick: string; why: string }) {
  if (!why.trim() && !pick) return <Missing />;
  if (pick) return <><span className="font-semibold">{pick}</span>{why && <div className="text-xs text-slate-600">{why}</div>}</>;
  return <><span className="text-slate-500">{HUB_DROPDOWNS[d].complete ? "No option matches: " : "Pick the closest to: "}</span>{why}</>;
}

const YN = { YES: "Yes", NO: "No" } as const;

export function ConcertHubPage({ hub, copied, copy }: { hub: HubPage; copied: string | null; copy: Copy }) {
  const clients = hubClients(hub);
  const left = unmet(hub);
  const CopyButton = ({ k, text }: { k: string; text: string }) => (
    <button type="button" onClick={() => copy(k, text)} className="no-print text-xs text-teal-800 underline">{copied === k ? "Copied" : "Copy"}</button>
  );

  return (
    <div className="space-y-3">
      <Screen tab="Protection">
        <div className="overflow-x-auto">
          <table className="w-full text-left">
            <thead className="text-xs text-slate-500">
              <tr><th className="py-1 pr-3 font-medium" />{clients.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr>
            </thead>
            <tbody>
              {HUB_NEEDS.map((need) => (
                <tr key={need} className="border-t border-slate-100 align-top">
                  <td className="py-1.5 pr-3 text-slate-600">{HUB_NEED_LABEL[need]}</td>
                  {clients.map((c) => {
                    const n = hub.needs.find((x) => x.client === c && x.need === need);
                    return (
                      <td key={c} className="py-1.5 pr-3">
                        {!n || n.outcome === "NOT_ON_SHEET" ? <Missing /> : (
                          <>
                            <span className="font-semibold">
                              {n.outcome === "COVERED" ? "Already covered" : n.outcome === "NOT_IDENTIFIED" ? "Not identified" : "Identified"}
                            </span>
                            {n.outcome !== "NOT_MET" && n.why && <div className="text-xs text-slate-600">{n.why}</div>}
                          </>
                        )}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {hub.needs.some((n) => n.outcome === "COVERED") && <p className="mt-1 text-xs text-slate-600">Already covered: Concert Hub asks for the evidence.</p>}
        {hub.deferred.map((d) => (
          <Row key={d.client} label={`Deferred Period, ${d.client}`}>
            {d.period.trim() ? <span className="font-semibold">{d.period}</span>
              : deferredFor(hub, d.client) === "sheet" || !d.why.trim() ? <Missing /> : <span className="text-slate-500">Match it to their sick pay: </span>}
            {d.why && <span className="text-slate-600"> {d.why}</span>}
          </Row>
        ))}
      </Screen>

      {hub.policies.map((p, i) => {
        const needs = addressedBy(hub, p);
        return (
          <Screen key={`q${i}`} tab="Quotes" where={`open the benefit: ${p.policy}, ${p.client}, ${p.product}`}>
            <Row label="To be Held In Trust?">{p.trust.trim() ? <span className="font-semibold">{p.trust}</span> : <Missing />}</Row>
            <Row label="Any Additional Benefits Agreed with Client?">{!p.extras.trim() ? <Missing /> : <span className="font-semibold">{/^none\b/i.test(p.extras.trim()) ? "No" : `Yes: ${p.extras}`}</span>}</Row>
            <Row label="Needs Addressed By Benefit">
              {needs.length ? <ul className="font-semibold">{needs.map((n, j) => <li key={j}>{clients.length > 1 ? `${n.client}: ` : ""}{HUB_NEED_LABEL[n.need]}</li>)}</ul> : <Missing />}
            </Row>
            <Row label="Reasons Why: Benefit Amount"><Pick d="benefit_amount" pick={p.amount_pick} why={p.amount_why} /></Row>
            <Row label="Reasons Why: Product Term"><Pick d="product_term" pick={p.term_pick} why={p.term_why} /></Row>
          </Screen>
        );
      })}

      {hub.policies.length > 0 && (
        <Screen tab="Recommendation">
          {hub.policies.map((p, i) => (
            <Row key={i} label={`Reasons Why, Provider: ${p.policy}, ${p.client}${p.provider ? ` (${p.provider})` : ""}`}>
              {p.provider_reasons.length ? <span className="font-semibold">Yes to: {p.provider_reasons.map((r) => PROVIDER_REASON_LABEL[r]).join(", ")}</span> : <Missing />}
              {p.provider_why && <div className="text-xs text-slate-600">{p.provider_why}</div>}
            </Row>
          ))}
          <Row label="Replace Any Existing Protection Policies?"><span className="font-semibold">{hub.replacements.length ? "Yes" : "No"}</span></Row>
        </Screen>
      )}

      {hub.replacements.map((r, i) => (
        <Screen key={`r${i}`} tab="Recommendation" where={`replacing: ${r.policy}`}>
          <Row label="Does Plan Remain Suitable to Meet Identified Need?">{r.still_suitable === "NOT_ON_SHEET" ? <Missing /> : <span className="font-semibold">{YN[r.still_suitable]}</span>}</Row>
          <Row label="Why Suitable to Replace?">
            {r.reasons.length ? <span className="font-semibold">Yes to: {r.reasons.map((x) => REPLACE_REASON_LABEL[x]).join(", ")}</span> : r.still_suitable === "YES" ? "None" : <Missing />}
          </Row>
          <Row label="Any Features That Can Be Used to Facilitate Change?">{r.facilitate === "NOT_ON_SHEET" ? <Missing /> : <span className="font-semibold">{YN[r.facilitate]}</span>}</Row>
          <Row label="Consequences of Replacing This Plan?">
            {r.losses.length ? <span className="font-semibold">Yes to: {r.losses.map((x) => REPLACE_LOSS_LABEL[x]).join(", ")}</span> : <Missing />}
          </Row>
          <Row label="Why Do the Benefits Outweigh the Disadvantages?">
            {r.outweigh.trim() ? <>{r.outweigh.trim()} <CopyButton k={`o-${i}`} text={r.outweigh.trim()} /></> : <Missing />}
          </Row>
        </Screen>
      ))}

      <Screen tab="Needs Validation" where="Reason Not Addressed">
        {left.length === 0 ? <p>Every need you identified is met.</p> : left.map((n, i) => (
          <Row key={i} label={`${clients.length > 1 ? `${n.client}: ` : ""}${HUB_NEED_LABEL[n.need]}`}><Pick d="reason_not_addressed" pick={n.pick} why={n.why} /></Row>
        ))}
      </Screen>

      {HUB_NOTES.some((k) => hub.notes[k]) && (
        <Screen tab="Notes" where="one for each Note Type">
          {HUB_NOTES.filter((k) => hub.notes[k]).map((k) => (
            <div key={k} className="border-t border-slate-100 py-1.5 first:border-0">
              <p className="flex items-baseline justify-between gap-2"><span className="font-bold">{HUB_NOTE_LABEL[k]}</span><CopyButton k={`n-${k}`} text={hub.notes[k]} /></p>
              <p className="mt-1 whitespace-pre-line">{hub.notes[k]}</p>
            </div>
          ))}
        </Screen>
      )}
    </div>
  );
}
