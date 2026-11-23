/**
 * The seller's advice check against the calls (Gate 4, 23 Nov 2026):
 * helpers shared by the case page, the callback email and the advice check
 * page. Safe to use in the browser.
 *
 * Openwork's supervision team listens to the recording and checks the file
 * against it. A statement the advice check drafted from the sheet that the
 * calls don't show, or that they contradict, goes on the callback list: the
 * seller covers it with the client on the (recorded) callback, or takes it
 * out of their notes.
 */
import { TOPIC_LABEL, type Triage, type CallbackItem } from "./triage";
import type { StatementsRunResult } from "./schemas";

export interface CheckStatement {
  n: number;
  text: string;
  where: string;
  from_adviser: boolean;
}

export const STATEMENT_LABEL: Record<string, string> = {
  SUPPORTED: "On the call",
  NOT_ON_CALL: "Not on the call",
  CONTRADICTED: "The call says otherwise",
  REVIEW_REQUIRED: "Check by ear",
};
export const STATEMENT_STYLE: Record<string, string> = {
  SUPPORTED: "bg-emerald-100 text-emerald-800",
  NOT_ON_CALL: "bg-red-100 text-red-800",
  CONTRADICTED: "bg-red-100 text-red-800",
  REVIEW_REQUIRED: "bg-amber-100 text-amber-900",
};

/** The Gate 4 result, if it tested this advice check. */
export function currentStatements(
  run: { status: string; result: unknown } | null | undefined, checkId: number | null | undefined,
): StatementsRunResult | null {
  const r = run?.status === "done" ? (run.result as StatementsRunResult | null) : null;
  return r && checkId && r.from_check === checkId ? r : null;
}

/** Adds the statements the calls don't back up to the end of the callback list (before the report's own points). */
export function withStatementGaps(t: Triage, res: StatementsRunResult | null, statements: CheckStatement[]): Triage {
  if (!res) return t;
  const byN = new Map(statements.map((s) => [s.n, s]));
  const items: CallbackItem[] = res.statements.statements
    .filter((s) => s.result === "NOT_ON_CALL" || s.result === "CONTRADICTED")
    .map((s) => {
      const text = byN.get(s.n)?.text ?? `statement ${s.n}`;
      return {
        ask: s.result === "CONTRADICTED"
          ? `Your notes say "${text}", but the call shows something different. Check with the client which is right and correct your notes.`
          : `Your notes say "${text}", but the call doesn't show it. Cover it with the client on the callback, or take it out of your notes.`,
        details: s.call_says ? [s.call_says] : [],
        evidence: s.evidence,
        adviceCheck: false,
      };
    });
  if (items.length === 0) return t;
  return {
    ...t,
    outcome: t.outcome === "clear" ? "callback" : t.outcome,
    callback: [...t.callback, { topic: "notes", label: TOPIC_LABEL.notes, items }],
  };
}
