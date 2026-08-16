import { describe, expect, it } from "vitest";

import {
  defaultRunTokenBudget,
  InvalidRunTokenBudgetError,
  InvalidRunTokenEstimateError,
  RunTokenBudget,
} from "./index.js";

describe("RunTokenBudget", () => {
  it("rejects invalid limits and keeps the default policy immutable", () => {
    expect(() => new RunTokenBudget({ maxTokens: 0, warningTokens: 0 })).toThrow(
      InvalidRunTokenBudgetError,
    );
    expect(() => new RunTokenBudget({ maxTokens: 10, warningTokens: 11 })).toThrow(
      InvalidRunTokenBudgetError,
    );
    expect(Object.isFrozen(defaultRunTokenBudget)).toBe(true);
  });

  it("emits one warning and then a distinct exceeded snapshot at estimate boundaries", () => {
    const budget = new RunTokenBudget({ maxTokens: 10, warningTokens: 5 });

    expect(budget.observeEstimate(4)).toEqual({ outcome: "none" });
    expect(budget.observeEstimate(1)).toEqual({
      outcome: "warning",
      snapshot: {
        state: "warning",
        source: "estimate",
        maxTokens: 10,
        warningTokens: 5,
        estimatedTokens: 5,
        effectiveTokens: 5,
      },
    });
    expect(budget.observeEstimate(1)).toEqual({ outcome: "none" });
    expect(budget.observeEstimate(4)).toEqual({
      outcome: "exceeded",
      snapshot: {
        state: "exceeded",
        source: "estimate",
        maxTokens: 10,
        warningTokens: 5,
        estimatedTokens: 10,
        effectiveTokens: 10,
      },
    });
  });

  it("uses cumulative Provider Usage as actual while preserving estimate provenance", () => {
    const budget = new RunTokenBudget({ maxTokens: 20, warningTokens: 10 });

    expect(budget.observeEstimate(1)).toEqual({ outcome: "none" });
    expect(budget.observeUsage({ inputTokens: 6, outputTokens: 4, totalTokens: 10 })).toEqual({
      outcome: "warning",
      snapshot: {
        state: "warning",
        source: "actual",
        maxTokens: 20,
        warningTokens: 10,
        estimatedTokens: 1,
        actualTokens: 10,
        effectiveTokens: 10,
      },
    });
    expect(budget.observeUsage({ totalTokens: 10 })).toEqual({
      outcome: "exceeded",
      snapshot: {
        state: "exceeded",
        source: "actual",
        maxTokens: 20,
        warningTokens: 10,
        estimatedTokens: 1,
        actualTokens: 20,
        effectiveTokens: 20,
      },
    });
  });

  it("ignores empty Usage and rejects invalid estimates", () => {
    const budget = new RunTokenBudget({ maxTokens: 10, warningTokens: 5 });
    expect(budget.observeUsage({})).toEqual({ outcome: "none" });
    expect(budget.actualTokens).toBeUndefined();
    expect(() => budget.observeEstimate(-1)).toThrow(InvalidRunTokenEstimateError);
    expect(() => budget.observeEstimate(1.5)).toThrow(InvalidRunTokenEstimateError);
  });

  it("does not let a partial Usage report hide a larger known field total", () => {
    const budget = new RunTokenBudget({ maxTokens: 20, warningTokens: 10 });
    expect(budget.observeUsage({ inputTokens: 6, outputTokens: 4 })).toEqual({
      outcome: "warning",
      snapshot: expect.objectContaining({ actualTokens: 10 }),
    });
    expect(budget.observeUsage({ inputTokens: 6, outputTokens: 6 })).toEqual({
      outcome: "exceeded",
      snapshot: expect.objectContaining({ actualTokens: 22, effectiveTokens: 22 }),
    });
  });

  it("keeps an overflowing cumulative Usage bounded and exceeded", () => {
    const budget = new RunTokenBudget({ maxTokens: 20, warningTokens: 10 });
    expect(budget.observeUsage({ totalTokens: 2_000_000 }).outcome).toBe("exceeded");
    const observation = budget.observeUsage({ totalTokens: 2_000_000 });
    expect(observation).toMatchObject({
      outcome: "exceeded",
      snapshot: { source: "actual", effectiveTokens: 2_000_000 },
    });
    if (observation.outcome === "exceeded") {
      expect(observation.snapshot.actualTokens).toBeUndefined();
    }
  });
});
