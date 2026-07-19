export const maxModelContextWindowTokens = 2_000_000;

const budgetWeightScale = 100;

const budgetCategories = [
  { property: "systemTokens", weight: 10 },
  { property: "historyTokens", weight: 50 },
  { property: "filesTokens", weight: 25 },
  { property: "toolsTokens", weight: 15 },
] as const;

const remainderOrder = ["systemTokens", "toolsTokens", "historyTokens", "filesTokens"] as const;

export interface TokenBudget {
  readonly contextWindowTokens: number;
  readonly systemTokens: number;
  readonly historyTokens: number;
  readonly filesTokens: number;
  readonly toolsTokens: number;
}

export interface TokenBudgetAllocator {
  allocate(contextWindowTokens: number): TokenBudget;
}

export class InvalidContextWindowError extends Error {
  constructor() {
    super(
      `Model context window must be a positive safe integer no greater than ${maxModelContextWindowTokens}.`,
    );
    this.name = "InvalidContextWindowError";
  }
}

export function allocateTokenBudget(contextWindowTokens: number): TokenBudget {
  if (
    !Number.isSafeInteger(contextWindowTokens) ||
    contextWindowTokens <= 0 ||
    contextWindowTokens > maxModelContextWindowTokens
  ) {
    throw new InvalidContextWindowError();
  }

  const allocated = {
    systemTokens: 0,
    historyTokens: 0,
    filesTokens: 0,
    toolsTokens: 0,
  };

  for (const { property, weight } of budgetCategories) {
    allocated[property] = Math.floor((contextWindowTokens * weight) / budgetWeightScale);
  }

  const allocatedTokens = Object.values(allocated).reduce((total, tokens) => total + tokens, 0);
  const remainder = contextWindowTokens - allocatedTokens;

  for (let index = 0; index < remainder; index += 1) {
    const property = remainderOrder[index];
    if (property === undefined) {
      throw new InvalidContextWindowError();
    }
    allocated[property] += 1;
  }

  return {
    contextWindowTokens,
    ...allocated,
  };
}

export const defaultTokenBudgetAllocator: TokenBudgetAllocator = {
  allocate: allocateTokenBudget,
};
