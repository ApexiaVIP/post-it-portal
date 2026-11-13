/**
 * Rough cost of a check, from the token counts saved on each run.
 *
 * Prices are US dollars per million tokens at the published list price, plus
 * the 10% AWS adds for keeping a request in one region (London). AWS bills in
 * GBP at its own exchange rate, and a part cut off by the time limit is not
 * counted, so this is an estimate to keep an eye on spend, not the bill. The
 * bill itself is in the TopQuoteUK management account under AWS Marketplace.
 */
const PRICES: Record<string, { input: number; output: number; cacheWrite: number; cacheWrite1h: number; cacheRead: number }> = {
  "anthropic.claude-opus-4-6-v1": { input: 5, output: 25, cacheWrite: 6.25, cacheWrite1h: 10, cacheRead: 0.5 },
  "anthropic.claude-opus-5-5": { input: 4, output: 20, cacheWrite: 5, cacheWrite1h: 8, cacheRead: 0.2 },
  "anthropic.claude-sonnet-5": { input: 2, output: 10, cacheWrite: 2.5, cacheWrite1h: 4, cacheRead: 0.2 },
};
const IN_REGION = 1.1;

interface PartUsage {
  input?: number; output?: number; cache_read?: number; cache_write?: number; cache_write_1h?: number; model?: string;
}

/** Estimated dollars for one run, or null when nothing on it can be priced. */
export function runCostUsd(usage: unknown): number | null {
  if (!usage || typeof usage !== "object") return null;
  let total = 0;
  let priced = false;
  for (const part of Object.values(usage as Record<string, PartUsage | null>)) {
    const p = part?.model ? PRICES[part.model] : undefined;
    if (!part || !p) continue;
    priced = true;
    const hour = part.cache_write_1h ?? 0;
    total += ((part.input ?? 0) * p.input + (part.output ?? 0) * p.output
      + ((part.cache_write ?? 0) - hour) * p.cacheWrite + hour * p.cacheWrite1h
      + (part.cache_read ?? 0) * p.cacheRead) / 1_000_000;
  }
  return priced ? total * IN_REGION : null;
}

export function formatUsd(n: number): string {
  return `$${n.toFixed(2)}`;
}
