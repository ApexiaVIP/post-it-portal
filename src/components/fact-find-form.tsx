"use client";

/**
 * The Fact Find sheet on screen (Jimmy, 24 Nov 2026): draws whatever the
 * sheet's definition holds. Every answer is kept in one flat object, saved by
 * the page.
 */
import { memo, useCallback } from "react";
import type { Block, Data, Field, Policy, PolicyTerms, Row, Sheet, Who } from "@/lib/factfind/types";
import { WHO_LABEL, blank, hasLife2, lifeName, policiesOf, pounds } from "@/lib/factfind/values";

type Set = (key: string, value: unknown) => void;

const BASE = "w-full rounded border px-2 py-1.5 text-sm focus:border-teal-700 focus:outline-none focus:ring-1 focus:ring-teal-700";
const box = (due: boolean) => `${BASE} ${due ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white"}`;

function Choice({ options, value, many, due, label, onChange }: {
  options: string[]; value: unknown; many: boolean; due: boolean; label: string; onChange: (v: unknown) => void;
}) {
  const picked = many ? (Array.isArray(value) ? (value as string[]) : []) : [];
  return (
    <div role="group" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => {
        const on = many ? picked.includes(o) : value === o;
        return (
          <button key={o} type="button" aria-pressed={on}
            onClick={() => onChange(many ? (on ? picked.filter((x) => x !== o) : [...picked, o]) : on ? "" : o)}
            className={`rounded border px-2 py-1 text-xs font-medium ${on ? "border-teal-700 bg-teal-700 text-white" : due ? "border-amber-500 bg-amber-50 text-slate-800" : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50"}`}>
            {o}
          </button>
        );
      })}
    </div>
  );
}

const Control = memo(function Control({ id, field, value, due, onChange }: {
  id: string; field: Pick<Field, "label" | "input">; value: unknown; due: boolean; onChange: (id: string, v: unknown) => void;
}) {
  const i = field.input;
  const set = (v: unknown) => onChange(id, v);
  const str = value === null || value === undefined ? "" : String(value);
  if (i.kind === "yesno") return <Choice options={["Yes", "No"]} value={value} many={false} due={due} label={field.label} onChange={set} />;
  if (i.kind === "one") return <Choice options={i.options} value={value} many={false} due={due} label={field.label} onChange={set} />;
  if (i.kind === "many") return <Choice options={i.options} value={value} many due={due} label={field.label} onChange={set} />;
  if (i.kind === "long") {
    return <textarea aria-label={field.label} rows={i.rows ?? 2} value={str} onChange={(e) => set(e.target.value)} className={box(due)}
      placeholder={i.quote ? "The client's exact words" : i.hint} />;
  }
  if (i.kind === "money") {
    return (
      <div className="flex items-center gap-1">
        <span className="text-sm text-slate-500">£</span>
        <input aria-label={field.label} inputMode="decimal" value={str} onChange={(e) => set(e.target.value)} className={box(due)} />
        {i.per && <span className="whitespace-nowrap text-xs text-slate-500">a {i.per}</span>}
      </div>
    );
  }
  if (i.kind === "number") {
    return (
      <div className="flex items-center gap-1">
        <input aria-label={field.label} inputMode="decimal" value={str} onChange={(e) => set(e.target.value)} className={box(due)} />
        {i.unit && <span className="text-xs text-slate-500">{i.unit}</span>}
      </div>
    );
  }
  return <input aria-label={field.label} value={str} onChange={(e) => set(e.target.value)} className={box(due)} placeholder={i.hint} />;
});

const wide = (f: Field) => f.input.kind === "long" || f.label.length > 70;

function Lines({ b, data, set }: { b: Extract<Block, { type: "rows" }>; data: Data; set: Set }) {
  const rows = (Array.isArray(data[b.key]) ? data[b.key] : []) as Row[];
  const change = (n: number, col: string, v: unknown) => set(b.key, rows.map((r, i) => (i === n ? { ...r, [col]: v } : r)));
  const due = !!b.must?.(data);
  return (
    <div id={b.key} className={`scroll-mt-28 rounded border p-2 ${due ? "border-amber-500 bg-amber-50" : "border-slate-200"}`}>
      <p className="text-sm font-semibold">{b.title}</p>
      <div className="mt-2 space-y-2">
        {rows.map((r, n) => (
          <div key={n} className="rounded border border-slate-200 bg-white p-2">
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
              {b.columns.map((c) => (
                <div key={c.key}>
                  <p className="text-xs text-slate-600">{c.label}</p>
                  <Control id={c.key} field={c} value={r[c.key]} due={false} onChange={(col, v) => change(n, col, v)} />
                </div>
              ))}
            </div>
            <button type="button" onClick={() => set(b.key, rows.filter((_, i) => i !== n))} className="mt-1 text-xs text-red-700 underline">Remove</button>
          </div>
        ))}
      </div>
      <button type="button" onClick={() => set(b.key, [...rows, {}])} className="mt-2 rounded border border-teal-700 px-2 py-1 text-xs font-medium text-teal-800 hover:bg-teal-50">{b.add}</button>
    </div>
  );
}

const TYPES = ["Life", "WOL", "CIC", "FIB", "IP", "Accident"];
const BASIS = ["Indexed", "Decreasing", "Level"];

function Terms({ t, label, joint, flag, onChange }: { t: PolicyTerms; label: string; joint: boolean; flag: boolean; onChange: (t: PolicyTerms) => void }) {
  const put = (k: string, v: unknown) => onChange({ ...t, [k]: v });
  const due = (v: unknown) => flag && blank(v);
  const f = (lab: string, input: Field["input"]): Pick<Field, "label" | "input"> => ({ label: lab, input });
  const cell = "space-y-1";
  return (
    <div className="rounded border border-slate-200 p-2">
      {label && <p className="mb-2 text-sm font-semibold">{label}</p>}
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className={cell}><p className="text-xs text-slate-600">Type of cover</p><Control id="type" field={f("Type of cover", { kind: "many", options: TYPES })} value={t.type} due={due(t.type)} onChange={put} /></div>
        <div className={cell}><p className="text-xs text-slate-600">Basis</p><Control id="basis" field={f("Basis", { kind: "one", options: BASIS })} value={t.basis} due={false} onChange={put} /></div>
        <div className={cell}><p className="text-xs text-slate-600">Term</p><Control id="term" field={f("Term", { kind: "number", unit: "years" })} value={t.term} due={due(t.term)} onChange={put} /></div>
        <div className={cell}><p className="text-xs text-slate-600">Sum assured (or monthly benefit)</p><Control id="sum" field={f("Sum assured", { kind: "money" })} value={t.sum} due={due(t.sum)} onChange={put} /></div>
        <div className={cell}><p className="text-xs text-slate-600">Premium</p><Control id="premium" field={f("Premium", { kind: "money", per: "month" })} value={t.premium} due={due(t.premium)} onChange={put} /></div>
        <div className={cell}><p className="text-xs text-slate-600">Extras?</p><Control id="extras" field={f("Extras", { kind: "text", hint: "None, or which" })} value={t.extras} due={false} onChange={put} /></div>
        {!joint && (
          <div className={cell}><p className="text-xs text-slate-600">In trust? (single life plans)</p><Control id="trust" field={f("In trust", { kind: "one", options: ["Yes", "No, client declined", "To be covered on the advice call", "Doesn't apply"] })} value={t.trust} due={due(t.trust)} onChange={put} /></div>
        )}
      </div>
    </div>
  );
}

function Policies({ data, set, flag }: { data: Data; set: Set; flag: boolean }) {
  const ps = policiesOf(data);
  const put = (n: number, p: Policy) => set("policies", ps.map((x, i) => (i === n ? p : x)));
  return (
    <div id="policies" className="scroll-mt-28 space-y-4">
      {ps.map((p, n) => {
        const due = (v: unknown) => flag && blank(v);
        const why = (k: keyof Policy, label: string, key: boolean) => (
          <div>
            <p className="text-xs font-semibold text-slate-700">{label}</p>
            <Control id={k} field={{ label, input: { kind: "long", rows: 3 } }} value={p[k]} due={key && due(p[k])} onChange={(_, v) => put(n, { ...p, [k]: v })} />
          </div>
        );
        return (
          <div key={n} id={`policy.${n}`} className="scroll-mt-28 rounded-lg border-2 border-slate-300 bg-white p-3">
            <div className="flex items-center justify-between">
              <p className="font-bold">Policy {n + 1}</p>
              <button type="button" onClick={() => { if (confirm(`Remove policy ${n + 1}?`)) set("policies", ps.filter((_, i) => i !== n)); }} className="text-xs text-red-700 underline">Remove</button>
            </div>
            <p className="mt-2 text-xs font-semibold text-slate-700">Who does it cover?</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {(Object.keys(WHO_LABEL) as Who[]).filter((w) => w === "life1" || hasLife2(data)).map((w) => (
                <button key={w} type="button" aria-pressed={p.who === w} onClick={() => put(n, { ...p, who: w })}
                  className={`rounded border px-2 py-1 text-xs font-medium ${p.who === w ? "border-teal-700 bg-teal-700 text-white" : due(p.who) ? "border-amber-500 bg-amber-50" : "border-slate-300 bg-white hover:bg-slate-50"}`}>
                  {w === "life1" ? lifeName(data, 1) : w === "life2" ? lifeName(data, 2) : WHO_LABEL[w]}
                </button>
              ))}
            </div>
            <div className={`mt-3 grid grid-cols-1 gap-3 ${p.who === "both" ? "lg:grid-cols-2" : ""}`}>
              <Terms t={p.l1 ?? {}} label={p.who === "both" ? lifeName(data, 1) : ""} joint={p.who === "joint"} flag={flag} onChange={(t) => put(n, { ...p, l1: t })} />
              {p.who === "both" && <Terms t={p.l2 ?? {}} label={lifeName(data, 2)} joint={false} flag={flag} onChange={(t) => put(n, { ...p, l2: t })} />}
            </div>
            <div className="mt-3 space-y-3">
              {why("why_need", "Why the need & evidence of dependency (what the money is for, who relies on it and until when; evidence: health, income etc)", true)}
              {why("why_sum", "Why this sum assured (how calculated; 'step towards' if budget-limited)", true)}
              {why("why_term", "Why this term (retirement age / child independence / ONS life expectancy / max available within budget)", true)}
              {why("additional", "Additional benefits & why needed (indexation, WOP, TPD etc). Indexation: level term, FIB or IP only, not a decreasing plan matched to a repayment mortgage. Waiver of premium: check the provider's age limit. Children's CIC where chosen.", false)}
              <div className="flex flex-wrap items-center gap-3">
                <p className="text-xs font-semibold text-slate-700">Premiums</p>
                <Control id="premiums" field={{ label: "Premiums", input: { kind: "one", options: ["Guaranteed", "Reviewable"] } }} value={p.premiums} due={false} onChange={(_, v) => put(n, { ...p, premiums: v as string })} />
              </div>
              {p.premiums === "Reviewable" && why("why_reviewable", "If reviewable, why?", false)}
              {why("trust_note", "Trust: anything to note (joint life considered, who it would go to, why declined)", false)}
            </div>
          </div>
        );
      })}
      <button type="button" onClick={() => set("policies", [...ps, {}])} className="rounded border border-teal-700 px-3 py-1.5 text-sm font-semibold text-teal-800 hover:bg-teal-50">Add a policy</button>
    </div>
  );
}

function BlockView({ b, data, set, due }: { b: Block; data: Data; set: Set; due: ReadonlySet<string> }) {
  switch (b.type) {
    case "note": return <p className="text-xs text-slate-600">{b.text}</p>;
    case "heading": return <h3 className="pt-2 text-sm font-bold uppercase tracking-wide text-slate-600">{b.text}</h3>;
    case "checks": return (
      <div className="space-y-1">
        {b.items.map((c) => (
          <label key={c.key} id={c.key} className={`flex scroll-mt-28 items-start gap-2 rounded border px-2 py-1.5 text-sm ${due.has(c.key) ? "border-amber-500 bg-amber-50" : "border-transparent"}`}>
            <input type="checkbox" className="mt-1" checked={!!data[c.key]} onChange={(e) => set(c.key, e.target.checked)} />
            <span>{c.label}</span>
          </label>
        ))}
      </div>
    );
    case "lives": {
      const two = hasLife2(data);
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] table-fixed text-sm">
            <thead>
              <tr className="text-left text-xs text-slate-500">
                <th className="w-1/3 py-1 pr-3 font-medium" />
                <th className="py-1 pr-3 font-medium">Life 1{blank(data["name.1"]) ? "" : `: ${lifeName(data, 1)}`}</th>
                <th className="py-1 font-medium">Life 2 / partner{blank(data["name.2"]) ? "" : `: ${lifeName(data, 2)}`}</th>
              </tr>
            </thead>
            <tbody>
              {b.rows.map((f) => (
                <tr key={f.key} className="border-t border-slate-100 align-top">
                  <td className="py-2 pr-3">{f.label}</td>
                  {([1, 2] as const).map((life) => {
                    const k = `${f.key}.${life}`;
                    const off = life === 2 && !two && !["name", "age", "marital"].includes(f.key);
                    return (
                      <td key={life} id={k} className="scroll-mt-28 py-2 pr-3">
                        {off ? <span className="text-xs text-slate-400">No Life 2</span>
                          : <Control id={k} field={{ label: `${f.label}, life ${life}`, input: f.input }} value={data[k]} due={due.has(k)} onChange={set} />}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
    case "fields": return (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {b.rows.map((f) => (
          <div key={f.key} id={f.key} className={`scroll-mt-28 ${wide(f) ? "sm:col-span-2" : ""}`}>
            <p className="mb-1 text-sm">{f.label}</p>
            <Control id={f.key} field={f} value={data[f.key]} due={due.has(f.key)} onChange={set} />
          </div>
        ))}
      </div>
    );
    case "rows": return <Lines b={b} data={data} set={set} />;
    case "grid": return (
      <div>
        <p className="text-sm font-semibold">{b.title}</p>
        <div className="mt-2 space-y-2">
          {b.rows.map((r) => {
            const k = `${b.key}.${r.key}`;
            return (
              <div key={r.key} id={k} className={`scroll-mt-28 rounded border p-2 ${due.has(k) ? "border-amber-500 bg-amber-50" : "border-slate-200 bg-white"}`}>
                <p className="text-sm font-medium">{r.label}</p>
                <div className="mt-1 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
                  {b.columns.map((c) => (
                    <div key={c.key}>
                      <p className="text-xs text-slate-600">{c.label}</p>
                      <Control id={`${k}.${c.key}`} field={c} value={data[`${k}.${c.key}`]} due={false} onChange={set} />
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
    case "total": {
      const n = b.of(data);
      return (
        <p className="flex flex-wrap items-baseline justify-between gap-2 rounded bg-slate-100 px-3 py-1.5 text-sm">
          <span>{b.label}</span><span className={`font-bold ${n !== null && n < 0 ? "text-red-700" : ""}`}>{n === null ? "worked out as you fill it in" : pounds(n)}</span>
        </p>
      );
    }
    case "policies": return <Policies data={data} set={set} flag={Array.from(due).some((k) => k.startsWith("policy."))} />;
  }
}

export function FactFindForm({ sheet, data, due, onSet }: { sheet: Sheet; data: Data; due: ReadonlySet<string>; onSet: Set }) {
  const set = useCallback<Set>((k, v) => onSet(k, v), [onSet]);
  return (
    <div className="space-y-8">
      {sheet.sections.map((s, n) => (
        <section key={s.key} id={`s-${s.key}`} className="scroll-mt-28 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="border-b border-slate-200 pb-1 text-lg font-bold">{n + 1}. {s.title}</h2>
          <div className="mt-3 space-y-4">
            {s.blocks.map((b, i) => <BlockView key={i} b={b} data={data} set={set} due={due} />)}
          </div>
        </section>
      ))}
    </div>
  );
}
