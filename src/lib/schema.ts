// Shape of the manual data captured by the portal.
// These are the POST IT fields the scraper does NOT auto-populate.

export const ADVISERS = ["Tan", "Hayder", "Gurdaht", "Atikur", "Jack"] as const;
export type Adviser = (typeof ADVISERS)[number];

// Per-adviser fields that go into rows 6-10 (daily) / 13-17 (weekly).
export const ADVISER_FIELDS = [
  { key: "UCF",        label: "UCF",         col: "C" },
  { key: "CF",         label: "CF",          col: "D" },
  { key: "ORPHANS",    label: "ORPHANS L&G", col: "E" },
  { key: "TQ_Comp",    label: "TQ Comp",     col: "F" },
  { key: "Fact_Find",  label: "Fact Find",   col: "K" },
  { key: "Quotes",     label: "Quotes",      col: "M" },
  { key: "Closes",     label: "Closes",      col: "O" },
  { key: "Declines",   label: "Declines",    col: "Q" },
  { key: "Postpones",  label: "Postpones",   col: "R" },
  { key: "Acc",        label: "Acc",         col: "S" },
  { key: "Ref",        label: "Ref",         col: "T" },
] as const;
export type AdviserFieldKey = (typeof ADVISER_FIELDS)[number]["key"];

// Ric / Customer Service fields (row 22 + row 24).
export const RIC_FIELDS = [
  { key: "TQ_Card_Life",      label: "TQ Card (Life)",  cell: "C22" },
  { key: "TQ_DD_Life",        label: "TQ DD (Life)",    cell: "E22" },
  { key: "Conf_Checks",       label: "Conf Checks",     cell: "G22" },
  { key: "Passed",            label: "Passed",          cell: "J22" },
  { key: "Resold",            label: "Resold",          cell: "K22" },
  { key: "Go_Live_Call",      label: "Go Live – Call",      cell: "B24" },
  { key: "Go_Live_CYD",       label: "Go Live – CYD",       cell: "C24" },
  { key: "Go_Live_Trust_Out", label: "Go Live – Trust Out", cell: "D24" },
  { key: "Go_Live_Trust_In",  label: "Go Live – Trust In",  cell: "E24" },
] as const;
export type RicFieldKey = (typeof RIC_FIELDS)[number]["key"];

export interface ManualData {
  // daily[adviser][field] = count
  daily: Record<Adviser, Record<AdviserFieldKey, number>>;
  ric: Record<RicFieldKey, number>;
  ricComments: string;            // N22 cell, free text
  updatedAt: string;              // ISO
  updatedBy: string;              // username
}

export function emptyManualData(): ManualData {
  const daily = Object.fromEntries(
    ADVISERS.map((a) => [
      a,
      Object.fromEntries(ADVISER_FIELDS.map((f) => [f.key, 0])),
    ]),
  ) as ManualData["daily"];
  const ric = Object.fromEntries(RIC_FIELDS.map((f) => [f.key, 0])) as ManualData["ric"];
  return {
    daily,
    ric,
    ricComments: "",
    updatedAt: new Date(0).toISOString(),
    updatedBy: "",
  };
}

export const KV_KEY = "post-it:manual:v1";
