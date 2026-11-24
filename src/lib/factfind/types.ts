/**
 * The Fact Find sheet as an online form (Jimmy, 24 Nov 2026): what a sheet is
 * made of. Each issued version of the sheet is one definition file, and the
 * form, the print and the text the advice check reads are all built from it.
 */
export type Input =
  | { kind: "text"; hint?: string }
  /** quote: the client's exact words. */
  | { kind: "long"; rows?: number; quote?: boolean; hint?: string }
  | { kind: "money"; per?: string }
  | { kind: "number"; unit?: string }
  | { kind: "yesno" }
  | { kind: "one"; options: string[] }
  | { kind: "many"; options: string[] };

export type Data = Record<string, unknown>;
export type Row = Record<string, unknown>;

export interface Field {
  key: string;
  label: string;
  input: Input;
  /** A key answer: flagged while it is blank. A function says when it applies. */
  must?: boolean | ((d: Data, life?: 1 | 2) => boolean);
}

export type Block =
  | { type: "note"; text: string }
  | { type: "heading"; text: string }
  | { type: "checks"; items: { key: string; label: string; must?: boolean }[] }
  /** Life 1 and Life 2 side by side. Stored as "<key>.1" and "<key>.2". */
  | { type: "lives"; rows: Field[] }
  | { type: "fields"; rows: Field[] }
  /** A table the seller adds lines to. */
  | { type: "rows"; key: string; title: string; columns: Field[]; add: string; must?: (d: Data) => string | null }
  /** A table with fixed lines. Stored as "<key>.<row>.<column>". */
  | { type: "grid"; key: string; title: string; rows: { key: string; label: string }[]; columns: Field[]; must?: (d: Data, row: string) => boolean; mustLabel?: string }
  | { type: "total"; key: string; label: string; of: (d: Data) => number | null; note?: string }
  | { type: "policies" };

export interface Section {
  key: string;
  title: string;
  blocks: Block[];
}

export interface Sheet {
  /** The sheet's issue date. */
  version: string;
  title: string;
  sections: Section[];
}

/** One recommended policy. "both" holds a separate plan for each life, with shared reasons. */
export type Who = "life1" | "life2" | "joint" | "both";
export interface PolicyTerms {
  type?: string[];
  basis?: string;
  term?: string;
  sum?: string;
  premium?: string;
  extras?: string;
  trust?: string;
}
export interface Policy {
  who?: Who;
  /** Terms for the life covered (or the joint plan); l2 only when who is "both". */
  l1?: PolicyTerms;
  l2?: PolicyTerms;
  why_need?: string;
  why_sum?: string;
  why_term?: string;
  additional?: string;
  premiums?: string;
  why_reviewable?: string;
  trust_note?: string;
  /** Concert Hub's "Reasons Why - Provider" (24 Nov 2026). Not on the paper sheet. */
  provider?: string;
  why_provider?: string[];
  why_provider_note?: string;
}
