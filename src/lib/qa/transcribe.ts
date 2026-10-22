/**
 * Call transcription for Call QA with Amazon Transcribe in London
 * (14 Oct 2026, replacing Deepgram so no audio leaves the UK).
 *
 * The recording is put in TopQuote's London S3 bucket, Transcribe writes
 * the transcript back to the same bucket with bank and card details
 * blanked out, and both files are deleted as soon as the transcript is
 * read into the portal. Transcription takes a few minutes, so it runs as
 * a job that the portal checks on (see calls.ts).
 */
import { PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import {
  StartTranscriptionJobCommand, GetTranscriptionJobCommand, DeleteTranscriptionJobCommand,
  type MediaFormat, type PiiEntityType, type Settings,
} from "@aws-sdk/client-transcribe";
import type { Utterance } from "./shared";
import { ukS3, ukTranscribe, type UkConfig } from "./uk";

/**
 * Blanked to [PII] in the transcript. Names, ages, dates, addresses and
 * phone numbers are kept: the checks need them (date of birth, ages of
 * children, the client confirming who they are).
 */
const REDACT: PiiEntityType[] = [
  "BANK_ACCOUNT_NUMBER", "BANK_ROUTING", "INTERNATIONAL_BANK_ACCOUNT_NUMBER", "SWIFT_CODE",
  "CREDIT_DEBIT_NUMBER", "CREDIT_DEBIT_CVV", "CREDIT_DEBIT_EXPIRY", "PIN", "PASSWORD",
];

const FORMAT_BY_EXT: Record<string, MediaFormat> = {
  wav: "wav", mp3: "mp3", mp4: "mp4", m4a: "m4a", ogg: "ogg", opus: "ogg", flac: "flac", webm: "webm", amr: "amr",
};
const FORMAT_BY_MIME: Record<string, MediaFormat> = {
  "audio/wav": "wav", "audio/x-wav": "wav", "audio/wave": "wav", "audio/vnd.wave": "wav",
  "audio/mpeg": "mp3", "audio/mp3": "mp3", "audio/mp4": "m4a", "audio/x-m4a": "m4a", "video/mp4": "mp4",
  "audio/ogg": "ogg", "audio/opus": "ogg", "audio/flac": "flac", "audio/x-flac": "flac",
  "audio/webm": "webm", "audio/amr": "amr",
};

export function mediaFormat(filename: string | null, mimeType: string | null): MediaFormat | null {
  const ext = (filename ?? "").toLowerCase().match(/\.([a-z0-9]+)$/)?.[1] ?? "";
  return FORMAT_BY_EXT[ext] ?? FORMAT_BY_MIME[(mimeType ?? "").toLowerCase()] ?? null;
}

/** Channel count from a WAV header (null if not a readable WAV). */
export function wavChannels(audio: Buffer): number | null {
  if (audio.length < 44 || audio.toString("latin1", 0, 4) !== "RIFF" || audio.toString("latin1", 8, 12) !== "WAVE") return null;
  // Walk the chunks to "fmt " rather than assuming it sits at byte 12.
  let off = 12;
  while (off + 8 <= audio.length) {
    const id = audio.toString("latin1", off, off + 4);
    const size = audio.readUInt32LE(off + 4);
    if (id === "fmt " && off + 10 <= audio.length) return audio.readUInt16LE(off + 10);
    off += 8 + size + (size % 2);
  }
  return null;
}

export interface StartedJob { job: string; audioKey: string }

/** Upload the recording to the London bucket and start transcribing it. */
export async function startTranscription(
  c: UkConfig, callId: number, audio: Buffer, filename: string | null, mimeType: string | null,
): Promise<StartedJob> {
  const format = mediaFormat(filename, mimeType);
  if (!format) throw new Error("This file type can't be transcribed. Please use a WAV, MP3, M4A, OGG, FLAC or WebM recording.");

  const job = `topquote-qa-${callId}-${Date.now()}`;
  const audioKey = `audio/${job}.${format}`;
  const s3 = ukS3(c);
  await s3.send(new PutObjectCommand({
    Bucket: c.bucket, Key: audioKey, Body: audio, ServerSideEncryption: "AES256",
    ContentType: mimeType || "application/octet-stream",
  }));

  // Stereo recordings (one party per channel) separate cleanly by
  // channel; otherwise tell the speakers apart by voice, allowing for a
  // couple on the line together as well as the adviser.
  const settings: Settings = wavChannels(audio) === 2
    ? { ChannelIdentification: true }
    : { ShowSpeakerLabels: true, MaxSpeakerLabels: 4 };
  if (c.vocabulary) settings.VocabularyName = c.vocabulary;

  try {
    await ukTranscribe(c).send(new StartTranscriptionJobCommand({
      TranscriptionJobName: job,
      LanguageCode: "en-GB",
      MediaFormat: format,
      Media: { MediaFileUri: `s3://${c.bucket}/${audioKey}` },
      OutputBucketName: c.bucket,
      OutputKey: "transcripts/",
      Settings: settings,
      ContentRedaction: { RedactionType: "PII", RedactionOutput: "redacted", PiiEntityTypes: REDACT },
    }));
  } catch (e) {
    await s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: audioKey })).catch(() => {});
    throw e;
  }
  return { job, audioKey };
}

export type JobCheck =
  | { state: "pending" }
  | { state: "failed"; reason: string }
  | { state: "done"; utterances: Utterance[]; durationSeconds: number | null; transcriptKey: string };

/** S3 key from the transcript URI Transcribe reports (path or virtual-host style). */
export function keyFromUri(uri: string, bucket: string): string {
  const u = new URL(uri);
  const path = decodeURIComponent(u.pathname.replace(/^\/+/, ""));
  if (u.hostname.startsWith(`${bucket}.`)) return path;
  return path.startsWith(`${bucket}/`) ? path.slice(bucket.length + 1) : path;
}

export async function checkTranscription(c: UkConfig, job: string): Promise<JobCheck> {
  let j;
  try {
    j = (await ukTranscribe(c).send(new GetTranscriptionJobCommand({ TranscriptionJobName: job }))).TranscriptionJob;
  } catch (e) {
    const name = (e as { name?: string }).name;
    if (name === "NotFoundException" || name === "BadRequestException") {
      return { state: "failed", reason: "The transcription job could not be found. Please upload the recording again." };
    }
    throw e;
  }
  const status = j?.TranscriptionJobStatus;
  if (status === "FAILED") return { state: "failed", reason: j?.FailureReason || "Transcription failed." };
  if (status !== "COMPLETED") return { state: "pending" };

  const uri = j?.Transcript?.RedactedTranscriptFileUri || j?.Transcript?.TranscriptFileUri;
  if (!uri) return { state: "failed", reason: "Transcription finished but no transcript was produced." };
  const transcriptKey = keyFromUri(uri, c.bucket);
  let text: string | undefined;
  try {
    const obj = await ukS3(c).send(new GetObjectCommand({ Bucket: c.bucket, Key: transcriptKey }));
    text = await obj.Body?.transformToString();
  } catch (e) {
    // The bucket clears anything older than a day, so a transcript nobody
    // collected in time is gone; the call can simply be transcribed again.
    if ((e as { name?: string }).name === "NoSuchKey") {
      return { state: "failed", reason: "The finished transcript was cleared before it was collected. Press Retry transcription." };
    }
    throw e;
  }
  if (!text) return { state: "failed", reason: "The transcript file was empty." };
  return { state: "done", transcriptKey, ...parseTranscribeOutput(JSON.parse(text)) };
}

/** Delete the audio, the transcript file and the job record from AWS. */
export async function cleanUpJob(c: UkConfig, keys: { job?: string | null; audioKey?: string | null; transcriptKey?: string | null }) {
  const s3 = ukS3(c);
  await Promise.all([
    keys.audioKey ? s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: keys.audioKey })).catch((e) => console.error("[qa] delete audio", e)) : null,
    keys.transcriptKey ? s3.send(new DeleteObjectCommand({ Bucket: c.bucket, Key: keys.transcriptKey })).catch((e) => console.error("[qa] delete transcript", e)) : null,
    keys.job ? ukTranscribe(c).send(new DeleteTranscriptionJobCommand({ TranscriptionJobName: keys.job })).catch(() => {}) : null,
  ]);
}

interface TItem {
  type?: string; start_time?: string; end_time?: string;
  speaker_label?: string; channel_label?: string;
  alternatives?: { content?: string }[];
}
interface TPayload {
  results?: {
    items?: TItem[];
    speaker_labels?: { segments?: { start_time?: string; end_time?: string; speaker_label?: string }[] };
    channel_labels?: { channels?: { channel_label?: string; items?: TItem[] }[] };
  };
}

/** spk_1 / ch_1 -> S1, matching the speaker labels the case page uses. */
const toSpeaker = (label: string) => `S${label.match(/(\d+)$/)?.[1] ?? "0"}`;
const r2 = (n: number) => Math.round(n * 100) / 100;

/** Turn Transcribe's word list into timestamped turns, one per speaker change or pause. */
export function parseTranscribeOutput(payload: TPayload): { utterances: Utterance[]; durationSeconds: number | null } {
  const res = payload.results ?? {};
  const words: { s: string; start: number; end: number; text: string }[] = [];

  const take = (items: TItem[], speakerAt: (it: TItem, start: number) => string) => {
    let last: (typeof words)[number] | null = null;
    for (const it of items) {
      const text = it.alternatives?.[0]?.content ?? "";
      if (!text) continue;
      if (it.type === "punctuation") { if (last) last.text += text; continue; }
      const start = Number(it.start_time);
      if (!Number.isFinite(start)) continue;
      const end = Number(it.end_time);
      last = { s: speakerAt(it, start), start, end: Number.isFinite(end) ? end : start, text };
      words.push(last);
    }
  };

  const channels = res.channel_labels?.channels ?? [];
  if (channels.length > 0) {
    for (const ch of channels) take(ch.items ?? [], (it) => it.channel_label ?? ch.channel_label ?? "ch_0");
    words.sort((a, b) => a.start - b.start);
  } else {
    const segs = (res.speaker_labels?.segments ?? []).map((s) => ({
      start: Number(s.start_time), end: Number(s.end_time), label: s.speaker_label ?? "spk_0",
    }));
    let i = 0;
    take(res.items ?? [], (it, start) => {
      if (it.speaker_label) return it.speaker_label;
      // Older output only carries speakers on the segments: walk them in step.
      while (i < segs.length - 1 && start > segs[i].end + 0.01) i++;
      return segs[i]?.label ?? "spk_0";
    });
  }

  const utterances: Utterance[] = [];
  for (const w of words) {
    const s = toSpeaker(w.s);
    const cur = utterances[utterances.length - 1];
    if (cur && cur.s === s && w.start - cur.end < 1.5) {
      cur.text += ` ${w.text}`;
      cur.end = r2(Math.max(cur.end, w.end));
    } else {
      utterances.push({ s, start: r2(w.start), end: r2(w.end), text: w.text });
    }
  }
  const durationSeconds = words.length ? r2(Math.max(...words.map((w) => w.end))) : null;
  return { utterances, durationSeconds };
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
