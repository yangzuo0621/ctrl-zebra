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

export function hasTokenUsage(value: TokenUsage): boolean {
  return (
    value.inputTokens !== undefined ||
    value.outputTokens !== undefined ||
    value.totalTokens !== undefined
  );
}
