/**
 * Call transcription for Call QA via Deepgram Nova-3, EU endpoint by
 * default so audio is processed and stored inside the EU. Same settings
 * the Call Insights pipeline runs on UK phone calls: UK English, speaker
 * separation, per-utterance timestamps.
 */
import type { Utterance } from "./shared";

const DEFAULT_URL = "https://api.eu.deepgram.com/v1/listen";

// Words the general model would otherwise mangle on these calls.
const KEYTERMS = [
  "TopQuote", "Openwork", "Concert", "ConcertHub", "ICOBS", "FSCS",
  "Legal & General", "MetLife", "Vitality", "Zurich", "Aviva", "Royal London",
  "LV", "The Exeter", "critical illness", "income protection", "terminal illness",
  "waiver of premium", "indexation", "decreasing term", "level term",
  "family income benefit", "key features", "cooling off", "discretionary trust",
];

export interface TranscriptResult {
  utterances: Utterance[];
  durationSeconds: number | null;
  channels: number;
}

export async function transcribeAudio(audio: Buffer, mimeType: string): Promise<TranscriptResult> {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error("DEEPGRAM_API_KEY is not configured");

  const params = new URLSearchParams({
    model: "nova-3",
    language: process.env.QA_DEEPGRAM_LANGUAGE || "en-GB",
    smart_format: "true",
    punctuate: "true",
    diarize: "true",
    utterances: "true",
    // Stereo recordings (one party per channel) separate perfectly by
    // channel; mono falls back to diarization within the one channel.
    multichannel: "true",
  });
  for (const t of KEYTERMS) params.append("keyterm", t);
  for (const r of (process.env.QA_DEEPGRAM_REDACT ?? "pci").split(",").map((x) => x.trim()).filter(Boolean)) {
    params.append("redact", r);
  }

  const url = `${process.env.QA_DEEPGRAM_URL || DEFAULT_URL}?${params}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Token ${key}`,
      "Content-Type": mimeType || "application/octet-stream",
    },
    body: new Uint8Array(audio),
  });
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 300);
    throw new Error(`Deepgram ${res.status}: ${detail}`);
  }
  const payload = await res.json() as {
    metadata?: { duration?: number; channels?: number };
    results?: {
      channels?: unknown[];
      utterances?: { channel?: number; speaker?: number; start: number; end: number; transcript: string }[];
    };
  };

  const channels = payload.results?.channels?.length ?? payload.metadata?.channels ?? 1;
  const raw = payload.results?.utterances ?? [];
  const utterances: Utterance[] = raw
    .filter((u) => (u.transcript ?? "").trim().length > 0)
    .map((u) => ({
      s: channels > 1 ? `S${u.channel ?? 0}` : `S${u.speaker ?? 0}`,
      start: Math.round(u.start * 100) / 100,
      end: Math.round(u.end * 100) / 100,
      text: u.transcript.trim(),
    }))
    .sort((a, b) => a.start - b.start);

  return { utterances, durationSeconds: payload.metadata?.duration ?? null, channels };
}

/**
 * Best guess at which speaker is the adviser: on a scripted sales call
 * the adviser does most of the talking. Correctable from the case page.
 */
export function guessAdviserSpeaker(utterances: Utterance[]): string | null {
  const words = new Map<string, number>();
  for (const u of utterances) {
    words.set(u.s, (words.get(u.s) ?? 0) + u.text.split(/\s+/).length);
  }
  let best: string | null = null;
  let bestN = -1;
  for (const [s, n] of Array.from(words.entries())) {
    if (n > bestN) { best = s; bestN = n; }
  }
  return best;
}
