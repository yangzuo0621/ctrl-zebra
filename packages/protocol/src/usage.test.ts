import { describe, expect, it } from "vitest";

import { hasTokenUsage, maxTokenCount, tokenUsageSchema } from "./index.js";

describe("Provider token Usage DTO", () => {
  it("accepts complete and partial actual counts but keeps missing Usage distinguishable", () => {
    const complete = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };
    const partial = { totalTokens: 14 };

    expect(tokenUsageSchema.parse(complete)).toEqual(complete);
    expect(tokenUsageSchema.parse(partial)).toEqual(partial);
    expect(hasTokenUsage(tokenUsageSchema.parse(partial))).toBe(true);
    expect(hasTokenUsage(tokenUsageSchema.parse({}))).toBe(false);
  });

  it.each([
    { inputTokens: -1 },
    { outputTokens: 1.5 },
    { totalTokens: Number.POSITIVE_INFINITY },
    { inputTokens: maxTokenCount + 1 },
    { totalTokens: 1, unexpected: true },
  ])("rejects invalid or overprivileged Usage %#", (usage) => {
    expect(tokenUsageSchema.safeParse(usage).success).toBe(false);
  });
});
