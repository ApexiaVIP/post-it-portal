/**
 * Call QA processing stays in the UK (Poz + Jimmy, 14 Oct 2026).
 *
 * Every step that touches a recording or a transcript runs in Amazon's
 * London data centre (eu-west-2) under TopQuote's own AWS account:
 *
 *   audio held briefly   S3 bucket in London, deleted once transcribed
 *   transcription        Amazon Transcribe, London (bank/card details blanked)
 *   AI checks            Claude Opus 5.5 on Amazon Bedrock, in-region London
 *
 * The region, endpoints and model routing are fixed here rather than read
 * from settings, so a typo in an environment variable can't send data
 * anywhere else. Until the London account is configured, Call QA refuses
 * uploads and checks outright: nothing is sent or held.
 */
import { S3Client } from "@aws-sdk/client-s3";
import { TranscribeClient } from "@aws-sdk/client-transcribe";
import AnthropicBedrock from "@anthropic-ai/bedrock-sdk";

export const UK_REGION = "eu-west-2";

/**
 * Claude Opus 5.5, called by its base model ID in London. AWS runs it
 * in-region there (since 30 Sep 2026): the request is processed in London
 * and never leaves it. A "global." / "eu." / "us." prefix would route the
 * request to other regions, so those are refused.
 */
const DEFAULT_MODEL = "anthropic.claude-opus-5-5";
const CROSS_REGION_PREFIX = /^(global|eu|us|apac|jp|au|ca|us-gov)\./i;

export interface UkConfig {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  model: string;
  vocabulary: string | null;
}

export type UkStatus = { ready: true; config: UkConfig } | { ready: false; reason: string };

export function ukStatus(): UkStatus {
  const accessKeyId = process.env.QA_AWS_ACCESS_KEY_ID?.trim();
  const secretAccessKey = process.env.QA_AWS_SECRET_ACCESS_KEY?.trim();
  const bucket = process.env.QA_S3_BUCKET?.trim();
  if (!accessKeyId || !secretAccessKey || !bucket) {
    return { ready: false, reason: "The UK (London) processing account is not set up yet." };
  }
  const model = process.env.QA_MODEL?.trim() || DEFAULT_MODEL;
  if (CROSS_REGION_PREFIX.test(model) || !model.startsWith("anthropic.")) {
    return { ready: false, reason: `QA_MODEL "${model}" would route outside London. Use the base model ID, e.g. ${DEFAULT_MODEL}.` };
  }
  return {
    ready: true,
    config: {
      accessKeyId, secretAccessKey, bucket, model,
      vocabulary: process.env.QA_TRANSCRIBE_VOCABULARY?.trim() || null,
    },
  };
}

/** The config, or an error saying plainly why processing is switched off. */
export function requireUk(): UkConfig {
  const s = ukStatus();
  if (!s.ready) throw new Error(s.reason);
  return s.config;
}

/** Model label recorded against each run. */
export function ukModel(): string {
  const s = ukStatus();
  return s.ready ? s.config.model : DEFAULT_MODEL;
}

const credentials = (c: UkConfig) => ({ accessKeyId: c.accessKeyId, secretAccessKey: c.secretAccessKey });

export function ukS3(c: UkConfig): S3Client {
  return new S3Client({ region: UK_REGION, endpoint: `https://s3.${UK_REGION}.amazonaws.com`, credentials: credentials(c) });
}

export function ukTranscribe(c: UkConfig): TranscribeClient {
  return new TranscribeClient({ region: UK_REGION, endpoint: `https://transcribe.${UK_REGION}.amazonaws.com`, credentials: credentials(c) });
}

export function ukClaude(c: UkConfig): AnthropicBedrock {
  return new AnthropicBedrock({
    awsRegion: UK_REGION,
    baseURL: `https://bedrock-runtime.${UK_REGION}.amazonaws.com`,
    awsAccessKey: c.accessKeyId,
    awsSecretKey: c.secretAccessKey,
  });
}
