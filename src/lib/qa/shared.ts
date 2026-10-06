/**
 * Call QA types and helpers safe to use in the browser.
 */
export type CaseType = "one_call" | "two_call";
export type CallType = "fact_find" | "advice" | "one_call" | "other";
export type CallStatus = "uploading" | "transcribing" | "ready" | "failed";

export const CALL_TYPE_LABELS: Record<CallType, string> = {
  fact_find: "Fact Find call",
  advice: "Advice call",
  one_call: "One call (fact find + advice)",
  other: "Other call",
};

export interface Utterance {
  /** Speaker label from the transcription, e.g. "S0". */
  s: string;
  start: number;
  end: number;
  text: string;
}

export interface QaCase {
  id: number;
  client_name: string;
  adviser_id: number | null;
  adviser_name: string | null;
  case_type: CaseType;
  notes: string | null;
  created_by: string;
  created_at: string;
  deal_id: number | null;
  deal_label: string | null;
  outcome: CaseOutcome | null;
  outcome_notes: string | null;
  outcome_by: string | null;
  outcome_at: string | null;
}

export type CaseOutcome = "approved" | "approved_with_actions" | "returned";
export const OUTCOME_LABELS: Record<CaseOutcome, string> = {
  approved: "Approved",
  approved_with_actions: "Approved with actions",
  returned: "Returned to adviser",
};

export interface QaCall {
  id: number;
  case_id: number;
  call_number: number;
  call_type: CallType;
  call_date: string | null;
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  status: CallStatus;
  error: string | null;
  duration_seconds: number | null;
  adviser_speaker: string | null;
  utterances: Utterance[] | null;
}

export interface QaRun {
  id: number;
  case_id: number;
  gate: 1 | 2;
  status: "running" | "done" | "failed";
  model: string | null;
  result: unknown;
  error: string | null;
  started_by: string | null;
  started_at: string;
  finished_at: string | null;
}

export function fmtTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(sec).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}
