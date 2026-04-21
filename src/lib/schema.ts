// Shape of the manual data captured by the portal.
// Data is stored per-date so admins can back-fill past days.

export const ADVISERS = ["Tan", "Hayder", "Gurdaht", "Atikur", "Jack"] as const;
export type Adviser = (typeof ADVISERS)[number];

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
  daily: Record<Adviser, Record<AdviserFieldKey, number>>;
  ric: Record<RicFieldKey, number>;
  ricComments: string;
  updatedAt: string;
  updatedBy: string;
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

// ---- date helpers ----

/** KV key for a specific London date (ISO "YYYY-MM-DD"). */
export function kvKeyForDate(isoDate: string): string {
  return `post-it:manual:v2:${isoDate}`;
}

/** Today in Europe/London as "YYYY-MM-DD". */
export function londonDateIso(d: Date = new Date()): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  });
  return fmt.format(d);
}

/** Monday of the week containing the given London date. */
export function londonMondayOf(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay();               // 0=Sun ... 6=Sat
  const daysFromMonday = (dow + 6) % 7;     // 0 if Monday
  dt.setUTCDate(dt.getUTCDate() - daysFromMonday);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
}

/** All dates from Monday-of-week through the given date inclusive. */
export function datesInWeekUpTo(isoDate: string): string[] {
  const monday = londonMondayOf(isoDate);
  const out: string[] = [];
  let cur = monday;
  while (cur <= isoDate) {
    out.push(cur);
    const [y, m, d] = cur.split("-").map(Number);
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() + 1);
    cur = `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}-${String(dt.getUTCDate()).padStart(2, "0")}`;
  }
  return out;
}
