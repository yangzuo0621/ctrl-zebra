import { z } from "zod";

/**
 * Token counts are Provider-reported values, not estimates.  Keep the shared
 * DTO bounded so a malformed Provider response cannot create an unbounded
 * persisted record or Webview projection.
 */
export const maxTokenCount = 2_000_000;

export const tokenCountSchema = z.int().min(0).max(maxTokenCount);

/** A Provider Usage report may omit fields that the Provider did not return. */
export const tokenUsageSchema = z.strictObject({
  inputTokens: tokenCountSchema.optional(),
  outputTokens: tokenCountSchema.optional(),
  totalTokens: tokenCountSchema.optional(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export type TokenUsageMergeResult =
  | { readonly ok: true; readonly usage: TokenUsage }
  | { readonly ok: false; readonly reason: "overflow" };

/**
 * Add a bounded Provider Usage report to an existing cumulative projection.
 * Overflow is an explicit invalid result; callers must not clamp it to the
 * maximum because that would fabricate a Provider-reported count.
 */
export function mergeTokenUsage(
  current: TokenUsage | undefined,
  next: TokenUsage,
): TokenUsageMergeResult {
  const inputTokens = mergeTokenCount(current?.inputTokens, next.inputTokens);
  const outputTokens = mergeTokenCount(current?.outputTokens, next.outputTokens);
  const totalTokens = mergeTokenCount(current?.totalTokens, next.totalTokens);
  if (!inputTokens.ok || !outputTokens.ok || !totalTokens.ok) {
    return { ok: false, reason: "overflow" };
  }

  return {
    ok: true,
    usage: {
      ...(inputTokens.value === undefined ? {} : { inputTokens: inputTokens.value }),
      ...(outputTokens.value === undefined ? {} : { outputTokens: outputTokens.value }),
      ...(totalTokens.value === undefined ? {} : { totalTokens: totalTokens.value }),
    },
  };
}

type TokenCountMergeResult =
  | { readonly ok: true; readonly value: number | undefined }
  | { readonly ok: false; readonly reason: "overflow" };

function mergeTokenCount(
  current: number | undefined,
  next: number | undefined,
): TokenCountMergeResult {
  if (next === undefined || current === undefined) {
    return { ok: true, value: current ?? next };
  }
  if (current > maxTokenCount - next) {
    return { ok: false, reason: "overflow" };
  }
  return { ok: true, value: current + next };
}

export function hasTokenUsage(value: TokenUsage): boolean {
  return (
    value.inputTokens !== undefined ||
    value.outputTokens !== undefined ||
    value.totalTokens !== undefined
  );
}
