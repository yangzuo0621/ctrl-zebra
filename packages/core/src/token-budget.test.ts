import { describe, expect, it } from "vitest";

import {
  allocateTokenBudget,
  defaultTokenBudgetAllocator,
  InvalidContextWindowError,
  maxModelContextWindowTokens,
} from "./token-budget.js";

describe("Token Budget", () => {
  it("allocates the documented category weights", () => {
    expect(allocateTokenBudget(1_000)).toEqual({
      contextWindowTokens: 1_000,
      systemTokens: 100,
      historyTokens: 500,
      filesTokens: 250,
      toolsTokens: 150,
    });
  });

  it.each([
    [1, [1, 0, 0, 0]],
    [2, [1, 1, 0, 0]],
    [3, [1, 1, 0, 1]],
    [4, [1, 2, 1, 0]],
    [19, [2, 10, 4, 3]],
  ] as const)("assigns the remainder deterministically for a %i-token window", (window, expected) => {
    const budget = allocateTokenBudget(window);

    expect([
      budget.systemTokens,
      budget.historyTokens,
      budget.filesTokens,
      budget.toolsTokens,
    ]).toEqual(expected);
    expect(defaultTokenBudgetAllocator.allocate(window)).toEqual(budget);
  });

  it.each([
    1,
    2,
    3,
    4,
    99,
    101,
    16_385,
    maxModelContextWindowTokens,
  ])("keeps every allocation within the declared %i-token window", (window) => {
    const budget = allocateTokenBudget(window);
    const allocated =
      budget.systemTokens + budget.historyTokens + budget.filesTokens + budget.toolsTokens;

    expect(allocated).toBe(window);
    expect(Object.values(budget).every(Number.isSafeInteger)).toBe(true);
    expect(
      [budget.systemTokens, budget.historyTokens, budget.filesTokens, budget.toolsTokens].every(
        (tokens) => tokens >= 0,
      ),
    ).toBe(true);
  });

  it("accepts the maximum context window", () => {
    expect(allocateTokenBudget(maxModelContextWindowTokens)).toEqual({
      contextWindowTokens: 2_000_000,
      systemTokens: 200_000,
      historyTokens: 1_000_000,
      filesTokens: 500_000,
      toolsTokens: 300_000,
    });
  });

  it.each([
    0,
    -1,
    1.5,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    maxModelContextWindowTokens + 1,
    Number.MAX_SAFE_INTEGER + 1,
  ])("rejects an invalid context window: %s", (window) => {
    expect(() => allocateTokenBudget(window)).toThrow(InvalidContextWindowError);
  });
});
