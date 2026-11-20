/**
 * The draft suitability report wording (Guy, 20 Nov 2026): helpers shared by
 * the case page, the email to the seller and the check itself.
 *
 * The draft is written from the calls in the seller's voice, for the seller
 * to check, change and use in ConcertHub. Only the seller and Pauline see it.
 * Where the calls didn't establish something, the text says "[To confirm: ...]"
 * and the gap is either part of a point already on the callback list or, if
 * only the report needs it, added to the end of that list.
 */
import { LETTER_SECTIONS, type LetterResult, type LetterSection } from "./schemas";
import { TOPIC_LABEL, type Triage } from "./triage";

export const LETTER_HEADING: Record<LetterSection, string> = {
  circumstances: "Your circumstances",
  needs: "What you need the cover for",
  budget: "Your budget",
  recommendation: "What I have recommended",
  reasons: "Why I have recommended it",
  not_recommended: "What I have not recommended, and why",
  existing_cover: "Your existing cover",
};

/** Marks in the text where the calls didn't give what the report needs. */
export const GAP_MARK = /\[To confirm:[^\]]*\]/g;

/** The draft, if it was written alongside this call check (gap numbers refer to its callback list). */
export function currentLetter(letter: LetterResult | null | undefined, gate1RunId: number | null | undefined): LetterResult | null {
  return letter && gate1RunId && letter.from_run === gate1RunId ? letter : null;
}

/**
 * The callback list with the points only the draft needs added at the end,
 * so the seller has one list to go through with the client.
 */
export function withLetterGaps(t: Triage, letter: LetterResult | null): Triage {
  const extra = (letter?.letter.gaps ?? []).filter((g) => g.callback_point == null);
  if (extra.length === 0) return t;
  return {
    ...t,
    outcome: t.outcome === "clear" ? "callback" : t.outcome,
    callback: [
      ...t.callback,
      {
        topic: "letter",
        label: TOPIC_LABEL.letter,
        items: extra.map((g) => ({ ask: g.ask, details: [g.missing], evidence: [], adviceCheck: false })),
      },
    ],
  };
}

/** The sections in report order, whatever order they came back in. */
export function orderedSections(letter: LetterResult) {
  return [...letter.letter.sections].sort((a, b) => LETTER_SECTIONS.indexOf(a.key) - LETTER_SECTIONS.indexOf(b.key));
}

/**
 * The callback list as the letter writer is given it, numbered the way the
 * seller sees it, so a gap can say which point it belongs to.
 */
export function callbackPointsText(t: Triage): string {
  const out: string[] = [];
  let n = 0;
  for (const g of t.callback) {
    for (const item of g.items) {
      n++;
      out.push(`${n}. ${item.ask}${item.details.length ? ` (${item.details.join("; ")})` : ""}`);
    }
  }
  return out.join("\n");
}

/** The draft as plain text, for the email and for copying into ConcertHub. */
export function letterText(letter: LetterResult): string {
  const out: string[] = [];
  for (const s of orderedSections(letter)) {
    out.push(LETTER_HEADING[s.key].toUpperCase(), s.text.trim(), "");
  }
  if (letter.letter.seller_notes.length > 0) {
    out.push("BEFORE YOU USE IT, CHECK");
    for (const n of letter.letter.seller_notes) out.push(`- ${n}`);
  }
  return out.join("\n").trim();
}
