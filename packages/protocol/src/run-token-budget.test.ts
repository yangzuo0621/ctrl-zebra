import { describe, expect, it } from "vitest";

import { runTokenBudgetConfigurationSchema, runTokenBudgetSnapshotSchema } from "./index.js";

describe("Run token budget protocol", () => {
  it("accepts bounded policy and snapshot values", () => {
    expect(runTokenBudgetConfigurationSchema.parse({ maxTokens: 100, warningTokens: 80 })).toEqual({
      maxTokens: 100,
      warningTokens: 80,
    });
    expect(
      runTokenBudgetSnapshotSchema.parse({
        state: "warning",
        source: "actual",
        maxTokens: 100,
        warningTokens: 80,
        estimatedTokens: 20,
        actualTokens: 80,
        effectiveTokens: 80,
      }),
    ).toMatchObject({ state: "warning", source: "actual" });
    const overflow = runTokenBudgetSnapshotSchema.parse({
      state: "exceeded",
      source: "actual",
      maxTokens: 100,
      warningTokens: 80,
      estimatedTokens: 20,
      effectiveTokens: 2_000_000,
    });
    expect(overflow.effectiveTokens).toBe(2_000_000);
    expect("actualTokens" in overflow).toBe(false);
  });

  it.each([
    { maxTokens: 0, warningTokens: 0 },
    { maxTokens: 10, warningTokens: 11 },
    { maxTokens: 10, warningTokens: 1, extra: true },
  ])("rejects invalid policy %j", (configuration) => {
    expect(runTokenBudgetConfigurationSchema.safeParse(configuration).success).toBe(false);
  });

  it.each([
    {
      state: "warning",
      source: "estimate",
      maxTokens: 10,
      warningTokens: 5,
      estimatedTokens: 1,
      effectiveTokens: 1,
    },
    {
      state: "exceeded",
      source: "actual",
      maxTokens: 10,
      warningTokens: 5,
      estimatedTokens: 1,
      actualTokens: 11,
      effectiveTokens: 10,
    },
    {
      state: "warning",
      source: "estimate",
      maxTokens: 10,
      warningTokens: 5,
      estimatedTokens: 1,
      effectiveTokens: 1,
      unexpected: true,
    },
  ])("rejects invalid snapshot %j", (snapshot) => {
    expect(runTokenBudgetSnapshotSchema.safeParse(snapshot).success).toBe(false);
  });
});
