import { defaultRunTokenBudget, InvalidRunTokenBudgetError } from "@ctrl-zebra/core";
import { maxTokenCount, type RunTokenBudgetConfiguration } from "@ctrl-zebra/protocol";

export const runBudgetSettingSection = "ctrlZebra.runBudget";
export const runBudgetSettingNames = {
  maxTokens: "maxTokens",
  warningTokens: "warningTokens",
} as const;

export interface RunBudgetConfigurationReader {
  get(setting: string): unknown;
}

export class RunBudgetConfigurationError extends InvalidRunTokenBudgetError {
  constructor() {
    super();
    this.name = "RunBudgetConfigurationError";
  }
}

export function readRunBudgetConfiguration(
  reader: RunBudgetConfigurationReader,
): RunTokenBudgetConfiguration {
  const maxTokens = reader.get(runBudgetSettingNames.maxTokens);
  const warningTokens = reader.get(runBudgetSettingNames.warningTokens);
  const configuration = {
    maxTokens: maxTokens === undefined ? defaultRunTokenBudget.maxTokens : maxTokens,
    warningTokens:
      warningTokens === undefined ? defaultRunTokenBudget.warningTokens : warningTokens,
  };

  if (
    !isValidTokenCount(configuration.maxTokens) ||
    !isValidTokenCount(configuration.warningTokens) ||
    configuration.warningTokens > configuration.maxTokens
  ) {
    throw new RunBudgetConfigurationError();
  }
  return Object.freeze({
    maxTokens: configuration.maxTokens,
    warningTokens: configuration.warningTokens,
  });
}

function isValidTokenCount(value: unknown): value is number {
  return (
    typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= maxTokenCount
  );
}
