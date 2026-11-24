/** The issued versions of the Fact Find sheet, newest last. A form keeps the version it was started on. */
import type { Sheet } from "./types";
import { SHEET_2026_11_20 } from "./sheet-2026-11-20";

export const SHEETS: readonly Sheet[] = [SHEET_2026_11_20];
export const CURRENT_SHEET: Sheet = SHEETS[SHEETS.length - 1];

export function sheetFor(version: string): Sheet {
  return SHEETS.find((s) => s.version === version) ?? CURRENT_SHEET;
}
