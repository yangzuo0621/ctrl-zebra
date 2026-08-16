import { defaultRunTokenBudget } from "@ctrl-zebra/core";
import { maxTokenCount } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  RunBudgetConfigurationError,
  readRunBudgetConfiguration,
  runBudgetSettingNames,
} from "./run-budget-configuration.js";

describe("Run token budget configuration", () => {
  it("applies bounded defaults and returns an immutable policy", () => {
    const policy = readRunBudgetConfiguration({ get: () => undefined });

    expect(policy).toEqual(defaultRunTokenBudget);
    expect(Object.isFrozen(policy)).toBe(true);
  });

  it("accepts user-configured limits and warning thresholds", () => {
    const values: Record<string, unknown> = {
      [runBudgetSettingNames.maxTokens]: maxTokenCount,
      [runBudgetSettingNames.warningTokens]: maxTokenCount - 1,
    };

    expect(readRunBudgetConfiguration({ get: (setting) => values[setting] })).toEqual(values);
  });

  it.each([
    [runBudgetSettingNames.maxTokens, 0],
    [runBudgetSettingNames.maxTokens, maxTokenCount + 1],
    [runBudgetSettingNames.maxTokens, 1.5],
    [runBudgetSettingNames.warningTokens, 0],
    [runBudgetSettingNames.warningTokens, "80k"],
  ])("rejects invalid %s setting", (setting, value) => {
    expect(() =>
      readRunBudgetConfiguration({
        get: (name) => (name === setting ? value : undefined),
      }),
    ).toThrow(RunBudgetConfigurationError);
  });

  it("rejects a warning threshold above the Run limit", () => {
    expect(() =>
      readRunBudgetConfiguration({
        get: (setting) => (setting === runBudgetSettingNames.maxTokens ? 10 : 11),
      }),
    ).toThrow(RunBudgetConfigurationError);
  });
});
