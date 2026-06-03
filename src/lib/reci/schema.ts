/**
 * RECI domain schema — TypeScript side.
 * Keep in sync with db/migrations/0001_reci_init.sql + 0002_cancellations.sql.
 */

export const DEAL_STATUSES = [
  "not_yet_submitted",
  "in_processing",
  "on_risk_nyp",
  "paid",
  "cancelled",
  "clawback",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const STATUS_LABELS: Record<DealStatus, string> = {
  not_yet_submitted: "Not Yet Submitted",
  in_processing:     "In Processing",
  on_risk_nyp:       "On Risk NYP",
  paid:              "Paid",
  cancelled:         "Cancelled",
  clawback:          "Clawback",
};

// Commission column mapping — which spreadsheet "COMMS £" column the deal's
// commission goes into, given its current status. Clawback maps to the same
// "cxl" bucket as Cancelled for now so the Business Tracker totals stay
// consistent with Pauline's existing report; we can split it out later.
export const STATUS_TO_COMMS_COLUMN: Record<DealStatus, "paid"|"on_risk_nyp"|"in_processing"|"nys"|"cxl"> = {
  paid:              "paid",
  on_risk_nyp:       "on_risk_nyp",
  in_processing:     "in_processing",
  not_yet_submitted: "nys",
  cancelled:         "cxl",
  clawback:          "cxl",
};

// --- NYS pre-submit check ---------------------------------------------------
// Pauline marks an NYS deal as 'checked' if she's reviewed it and isn't happy
// (e.g. the call needs revisiting). The seller gets an email with her notes.
// Cleared automatically when the deal moves to In Processing or On Risk NYP.
export const NYS_CHECK_STATUSES = ["checked"] as const;
export type NysCheckStatus = (typeof NYS_CHECK_STATUSES)[number];

export const NYS_CHECK_STATUS_LABELS: Record<NysCheckStatus, string> = {
  checked: "Checked",
};

// --- In-processing sub-stage ------------------------------------------------
// Only meaningful when status = 'in_processing'. Lets the team track which
// step of processing a deal is at (e.g. waiting for GPR, awaiting RFI, etc.).
export const IN_PROCESSING_STAGES = ["checked", "gpr", "misc", "ns", "rfi", "sot"] as const;
export type InProcessingStage = (typeof IN_PROCESSING_STAGES)[number];

export const IN_PROCESSING_STAGE_LABELS: Record<InProcessingStage, string> = {
  checked: "Checked",
  gpr:     "GPR",
  misc:    "Misc",
  ns:      "NS",
  rfi:     "RFI",
  sot:     "SOT",
};

// --- Cancellation reasons ---------------------------------------------------
export const CANCELLATION_REASONS = ["npw", "postponed", "declined", "other"] as const;
export type CancellationReason = (typeof CANCELLATION_REASONS)[number];

export const CANCELLATION_REASON_LABELS: Record<CancellationReason, string> = {
  npw:       "NPW (client not proceeding)",
  postponed: "Postponed",
  declined:  "Declined",
  other:     "Other",
};

export const CANCELLATION_REASON_SHORT: Record<CancellationReason, string> = {
  npw:       "NPW",
  postponed: "Postponed",
  declined:  "Declined",
  other:     "Other",
};

export interface Adviser {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
  active: boolean;
  email?: string | null;
}

export interface Deal {
  id: number;
  adviser_id: number;
  year: number;
  week: number;
  position: number;
  client: string;
  postcode: string | null;
  no_of_deals: number;
  provider: string | null;
  premium: number | null;
  confirmed_date: string | null;
  poz_listened: string | null;
  miscellaneous: string | null;
  submitted: string | null;
  acc_ref: string | null;
  status: DealStatus;
  in_processing_stage: InProcessingStage | null;
  commission: number;
  notes: string | null;
  gl_sp: string | null;
  gl_txt: string | null;
  trust_done: string | null;
  trust_sent: string | null;
  cancellation_reason: CancellationReason | null;
  cancellation_notes: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  nys_check_status: NysCheckStatus | null;
  nys_check_notes: string | null;
  nys_checked_at: string | null;
  nys_checked_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface DealHistory {
  id: number;
  deal_id: number;
  changed_at: string;
  changed_by: string;
  old_status: DealStatus | null;
  new_status: DealStatus | null;
  old_commission: number | null;
  new_commission: number | null;
  note: string | null;
}
