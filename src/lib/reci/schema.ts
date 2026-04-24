/**
 * RECI domain schema — TypeScript side.
 */

export const DEAL_STATUSES = [
  "not_yet_submitted",
  "in_processing",
  "on_risk_nyp",
  "paid",
  "cancelled",
] as const;
export type DealStatus = (typeof DEAL_STATUSES)[number];

export const STATUS_LABELS: Record<DealStatus, string> = {
  not_yet_submitted: "Not Yet Submitted",
  in_processing:     "In Processing",
  on_risk_nyp:       "On Risk NYP",
  paid:              "Paid",
  cancelled:         "Cancelled",
};

export const STATUS_TO_COMMS_COLUMN: Record<DealStatus, "paid"|"on_risk_nyp"|"in_processing"|"nys"|"cxl"> = {
  paid:              "paid",
  on_risk_nyp:       "on_risk_nyp",
  in_processing:     "in_processing",
  not_yet_submitted: "nys",
  cancelled:         "cxl",
};

export interface Adviser {
  id: number;
  slug: string;
  name: string;
  sort_order: number;
  active: boolean;
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
  commission: number;
  notes: string | null;
  gl_sp: string | null;
  gl_txt: string | null;
  trust_done: string | null;
  trust_sent: string | null;
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
