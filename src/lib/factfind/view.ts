/**
 * A Fact Find form as plain answers: used for the print, for the text the
 * advice check reads, and for the list of key answers still blank.
 */
import type { Block, Data, Field, Policy, Sheet } from "./types";
import { WHO_LABEL, blank, hasLife2, lifeName, money, plansOf, policiesOf, pounds, rowsOf } from "./values";

/** An answer in words; "" when blank. */
export function answer(f: Field, v: unknown): string {
  if (blank(v)) return "";
  switch (f.input.kind) {
    case "money": {
      const n = money(v);
      const s = n === null ? String(v).trim() : pounds(n);
      return f.input.per ? `${s} a ${f.input.per}` : s;
    }
    case "number": return `${String(v).trim()}${f.input.unit ? ` ${f.input.unit}` : ""}`;
    case "many": return Array.isArray(v) ? v.join(", ") : String(v);
    case "long": return f.input.quote ? `"${String(v).trim().replace(/^["“]|["”]$/g, "")}"` : String(v).trim();
    default: return String(v).trim();
  }
}

export interface Missing { section: string; anchor: string; label: string }

const short = (s: string) => (s.length > 90 ? `${s.slice(0, s.lastIndexOf(" ", 86))}...` : s);
const applies = (f: Field, d: Data, life?: 1 | 2) => (typeof f.must === "function" ? f.must(d, life) : !!f.must);

function policyMissing(d: Data, p: Policy, i: number): string[] {
  const out: string[] = [];
  const need = (v: unknown, label: string) => { if (blank(v)) out.push(`Policy ${i + 1}: ${label}`); };
  need(p.who, "who it covers");
  for (const t of plansOf(d, p)) {
    const who = p.who === "both" ? ` (${t.who})` : "";
    need(t.terms.type, `type of cover${who}`);
    need(t.terms.term, `term${who}`);
    need(t.terms.sum, `sum assured${who}`);
    need(t.terms.premium, `premium${who}`);
    if (!t.joint) need(t.terms.trust, `trust${who}`);
    if (t.terms.type?.includes("IP")) need(t.terms.deferred, `deferred period${who}`);
  }
  need(p.why_need, "why the need");
  need(p.why_sum, "why this sum assured");
  need(p.why_term, "why this term");
  need(p.provider, "provider");
  need(p.why_provider, "why this provider");
  return out;
}

/** The key answers still blank, in sheet order. */
export function missing(sheet: Sheet, d: Data): Missing[] {
  const out: Missing[] = [];
  for (const s of sheet.sections) {
    const add = (anchor: string, label: string) => out.push({ section: s.key, anchor, label: short(label) });
    for (const b of s.blocks) {
      if (b.type === "checks") {
        for (const c of b.items) if (c.must && blank(d[c.key])) add(c.key, c.label.split(":")[0]);
      } else if (b.type === "lives") {
        for (const f of b.rows) for (const life of [1, 2] as const) {
          if (applies(f, d, life) && blank(d[`${f.key}.${life}`])) add(`${f.key}.${life}`, `${f.label.replace(/^\d\.\s*/, "")} (${lifeName(d, life)})`);
        }
      } else if (b.type === "fields") {
        for (const f of b.rows) if (applies(f, d) && blank(d[f.key])) add(f.key, f.label);
      } else if (b.type === "rows") {
        const m = b.must?.(d);
        if (m) add(b.key, m);
      } else if (b.type === "grid") {
        for (const r of b.rows) if (b.must?.(d, r.key)) add(`${b.key}.${r.key}`, `${short(r.label)}: ${b.mustLabel ?? "not filled in"}`);
      } else if (b.type === "policies") {
        const ps = policiesOf(d);
        if (ps.length === 0) add("policies", "Your recommendation: at least one policy");
        ps.forEach((p, i) => policyMissing(d, p, i).forEach((label) => add(`policy.${i}`, label)));
      }
    }
  }
  return out;
}

/** One block as label and answer lines. Life 2's column is left out where there is no Life 2. */
export function blockLines(b: Block, d: Data): { label: string; value: string }[] {
  const two = hasLife2(d);
  switch (b.type) {
    case "checks": return b.items.map((c) => ({ label: c.label, value: d[c.key] ? "ticked" : "not ticked" }));
    case "lives": return b.rows.flatMap((f) => {
      const one = answer(f, d[`${f.key}.1`]) || "(blank)";
      const other = answer(f, d[`${f.key}.2`]) || "(blank)";
      return [{ label: f.label, value: two ? `${lifeName(d, 1)}: ${one} | ${lifeName(d, 2)}: ${other}` : one }];
    });
    case "fields": return b.rows.map((f) => ({ label: f.label, value: answer(f, d[f.key]) || "(blank)" }));
    case "rows": {
      const rows = rowsOf(d, b.key);
      if (rows.length === 0) return [{ label: b.title, value: "(none entered)" }];
      return rows.map((r, i) => ({
        label: `${b.title}, ${i + 1}`,
        value: b.columns.map((c) => `${c.label}: ${answer(c, r[c.key]) || "(blank)"}`).join("; "),
      }));
    }
    case "grid": return b.rows.map((r) => ({
      label: r.label,
      value: b.columns.map((c) => `${c.label}: ${answer(c, d[`${b.key}.${r.key}.${c.key}`]) || "(blank)"}`).join("; "),
    }));
    case "total": { const n = b.of(d); return [{ label: `${b.label} (worked out)`, value: n === null ? "(blank)" : pounds(n) }]; }
    case "policies": return policiesOf(d).flatMap((p, i) => {
      const v = (x: unknown) => (blank(x) ? "(blank)" : String(x).trim());
      const m = (x: unknown) => { const n = money(x); return n === null ? v(x) : pounds(n); };
      return [
        { label: `Policy ${i + 1}, who it covers`, value: p.who ? WHO_LABEL[p.who] : "(blank)" },
        ...plansOf(d, p).map((t) => ({
          label: `Policy ${i + 1}${t.who ? `, ${t.who}` : ""}`,
          value: [
            `Type: ${t.terms.type?.length ? t.terms.type.join(" with ") : "(blank)"}`, `Basis: ${v(t.terms.basis)}`,
            `Term: ${blank(t.terms.term) ? "(blank)" : `${v(t.terms.term)} years`}`, `Sum assured: ${m(t.terms.sum)}`, `Premium: ${m(t.terms.premium)}${blank(t.terms.premium) ? "" : " a month"}`,
            `Extras: ${v(t.terms.extras)}`, ...(t.terms.type?.includes("IP") ? [`Deferred period: ${v(t.terms.deferred)}`] : []), t.joint ? "Joint life" : `Single life, in trust: ${v(t.terms.trust)}`,
          ].join("; "),
        })),
        { label: `Policy ${i + 1}, why the need and evidence of dependency`, value: v(p.why_need) },
        { label: `Policy ${i + 1}, why this sum assured`, value: v(p.why_sum) },
        { label: `Policy ${i + 1}, why this term`, value: v(p.why_term) },
        { label: `Policy ${i + 1}, additional benefits and why needed`, value: v(p.additional) },
        { label: `Policy ${i + 1}, premiums`, value: `${v(p.premiums)}${p.premiums === "Reviewable" ? `, because: ${v(p.why_reviewable)}` : ""}` },
        { label: `Policy ${i + 1}, trust`, value: v(p.trust_note) },
        { label: `Policy ${i + 1}, provider`, value: v(p.provider) },
        { label: `Policy ${i + 1}, why this provider`, value: [p.why_provider?.join(", "), p.why_provider_note?.trim()].filter(Boolean).join(". ") || "(blank)" },
      ];
    });
    default: return [];
  }
}

/** The whole form as text, for the advice check and Call QA. */
export function sheetText(sheet: Sheet, d: Data): string {
  const out: string[] = [];
  for (const s of sheet.sections) {
    const lines: string[] = [];
    for (const b of s.blocks) {
      if (b.type === "heading") lines.push(`[${b.text}]`);
      for (const l of blockLines(b, d)) lines.push(`${l.label}: ${l.value}`);
    }
    if (s.key === "family" && !hasLife2(d)) lines.unshift("Life 2: not completed");
    if (s.key === "policies" && policiesOf(d).length === 0) lines.push("(no policies entered)");
    out.push(`${s.title.toUpperCase()}\n${lines.join("\n")}`);
  }
  return out.join("\n\n");
}

/** A UK postcode or a full date of birth typed somewhere it shouldn't be. */
export function looksPersonal(d: Data): string | null {
  const text = JSON.stringify(d, (k, v) => (k === "b_concert_when" || k === "b_callback_when" ? undefined : v));
  if (/\b[A-Z]{1,2}\d[A-Z\d]?\s*\d[ABD-HJLNP-UW-Z]{2}\b/i.test(text)) return "a postcode";
  if (/\b\d{1,2}[/.-]\d{1,2}[/.-](19|20)\d{2}\b/.test(text)) return "a full date";
  return null;
}
