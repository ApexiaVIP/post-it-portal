/** Reading answers out of a Fact Find form. Safe to use in the browser. */
import type { Data, Policy, PolicyTerms, Row, Who } from "./types";

export function blank(v: unknown): boolean {
  if (v === null || v === undefined || v === false) return true;
  if (typeof v === "string") return v.trim() === "";
  if (Array.isArray(v)) return v.length === 0;
  return false;
}

/** A money or number answer as a number, or null. */
export function money(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  const s = v.replace(/[£,\s]/g, "");
  return /^-?\d+(\.\d+)?$/.test(s) ? Number(s) : null;
}

export function pounds(n: number): string {
  return `${n < 0 ? "-" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: Number.isInteger(n) ? 0 : 2, maximumFractionDigits: 2 })}`;
}

const rowFilled = (r: unknown): r is Row => !!r && typeof r === "object" && Object.values(r as Row).some((v) => !blank(v));

/** The filled lines of a table (blank lines are ignored). */
export function rowsOf(d: Data, key: string): Row[] {
  const v = d[key];
  return Array.isArray(v) ? (v as unknown[]).filter(rowFilled) : [];
}
export function sumRows(d: Data, key: string, col: string): number | null {
  const ns = rowsOf(d, key).map((r) => money(r[col])).filter((n): n is number => n !== null);
  return ns.length ? ns.reduce((a, b) => a + b, 0) : null;
}

export function hasLife2(d: Data): boolean {
  return !blank(d["name.2"]) || ["Married/CP", "Cohabiting"].includes(String(d["marital.1"] ?? ""));
}
export function hasDependants(d: Data): boolean {
  return rowsOf(d, "children").length > 0 || rowsOf(d, "dependants").length > 0 || hasLife2(d);
}

export function policiesOf(d: Data): Policy[] {
  return Array.isArray(d.policies) ? (d.policies as Policy[]).filter((p) => p && typeof p === "object") : [];
}

export const WHO_LABEL: Record<Who, string> = {
  life1: "Life 1", life2: "Life 2", joint: "Both, one joint life plan", both: "Both, a single life plan each",
};
export function lifeName(d: Data, life: 1 | 2): string {
  const n = d[`name.${life}`];
  return typeof n === "string" && n.trim() ? n.trim() : `Life ${life}`;
}
/** The plans a policy card holds: who each covers and its terms. */
export function plansOf(d: Data, p: Policy): { who: string; joint: boolean; terms: PolicyTerms }[] {
  const t1 = p.l1 ?? {}; const t2 = p.l2 ?? {};
  switch (p.who) {
    case "life1": return [{ who: lifeName(d, 1), joint: false, terms: t1 }];
    case "life2": return [{ who: lifeName(d, 2), joint: false, terms: t1 }];
    case "joint": return [{ who: `${lifeName(d, 1)} and ${lifeName(d, 2)}`, joint: true, terms: t1 }];
    case "both": return [{ who: lifeName(d, 1), joint: false, terms: t1 }, { who: lifeName(d, 2), joint: false, terms: t2 }];
    default: return [{ who: "", joint: false, terms: t1 }];
  }
}
