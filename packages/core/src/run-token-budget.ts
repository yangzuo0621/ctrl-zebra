import {
  hasTokenUsage,
  maxTokenCount,
  mergeTokenUsage,
  type RunTokenBudgetConfiguration,
  type RunTokenBudgetSnapshot,
  runTokenBudgetConfigurationSchema,
  runTokenBudgetSnapshotSchema,
  type TokenUsage,
  tokenUsageSchema,
} from "@ctrl-zebra/protocol";

export const defaultRunTokenBudget: RunTokenBudgetConfiguration = Object.freeze({
  maxTokens: 100_000,
  warningTokens: 80_000,
});

export type RunTokenBudgetObservation =
  | { readonly outcome: "none" }
  | { readonly outcome: "warning"; readonly snapshot: RunTokenBudgetSnapshot }
  | { readonly outcome: "exceeded"; readonly snapshot: RunTokenBudgetSnapshot };

export class InvalidRunTokenBudgetError extends Error {
  constructor() {
    super("The Run token budget configuration is invalid.");
    this.name = "InvalidRunTokenBudgetError";
  }
}

export class InvalidRunTokenEstimateError extends Error {
  constructor() {
    super("The Run token estimate is invalid.");
    this.name = "InvalidRunTokenEstimateError";
  }
}

export class RunTokenBudgetExceededError extends Error {
  constructor(readonly budget: RunTokenBudgetSnapshot) {
    super("The Run token budget was reached.");
    this.name = "RunTokenBudgetExceededError";
  }
}

/**
 * Run-scoped enforcement around the accounting model. It preserves the cancellation-before-budget
 * priority and emits each warning/exceeded snapshot before stopping the caller.
 */
export class RunTokenBudgetGuard {
  readonly #budget: RunTokenBudget | undefined;
  readonly #emit: (snapshot: RunTokenBudgetSnapshot) => void;

  constructor(
    configuration: RunTokenBudgetConfiguration | undefined,
    emit: (snapshot: RunTokenBudgetSnapshot) => void,
  ) {
    this.#budget = configuration === undefined ? undefined : new RunTokenBudget(configuration);
    this.#emit = emit;
  }

  observeEstimate(tokens: number, signal: AbortSignal): void {
    if (this.#budget === undefined) {
      return;
    }
    signal.throwIfAborted();
    this.#handle(this.#budget.observeEstimate(tokens), signal);
  }

  observeUsage(usage: TokenUsage, signal: AbortSignal): void {
    if (this.#budget === undefined) {
      return;
    }
    signal.throwIfAborted();
    this.#handle(this.#budget.observeUsage(usage), signal);
  }

  #handle(observation: RunTokenBudgetObservation, signal: AbortSignal): void {
    if (observation.outcome === "none") {
      return;
    }
    this.#emit(observation.snapshot);
    signal.throwIfAborted();
    if (observation.outcome === "exceeded") {
      throw new RunTokenBudgetExceededError(observation.snapshot);
    }
  }
}

/**
 * Core-owned accounting for one Run. Estimates are conservative local signals; actual Provider
 * Usage is retained separately and never relabeled as an estimate or as a bill.
 */
export class RunTokenBudget {
  readonly #configuration: RunTokenBudgetConfiguration;
  #estimatedTokens = 0;
  #actualUsage: TokenUsage | undefined;
  #actualTokens: number | undefined;
  #actualOverflowed = false;
  #warningReported = false;

  constructor(configuration: RunTokenBudgetConfiguration) {
    const parsed = runTokenBudgetConfigurationSchema.safeParse(configuration);
    if (!parsed.success) {
      throw new InvalidRunTokenBudgetError();
    }
    this.#configuration = Object.freeze({ ...parsed.data });
  }

  get configuration(): RunTokenBudgetConfiguration {
    return this.#configuration;
  }

  get estimatedTokens(): number {
    return this.#estimatedTokens;
  }

  get actualTokens(): number | undefined {
    return this.#actualTokens;
  }

  /** Observe a bounded local estimate before a Provider request or before the next Tool step. */
  observeEstimate(tokens: number): RunTokenBudgetObservation {
    if (!Number.isSafeInteger(tokens) || tokens < 0) {
      throw new InvalidRunTokenEstimateError();
    }
    this.#estimatedTokens = saturatingAdd(this.#estimatedTokens, tokens);
    return this.#evaluate("estimate");
  }

  /** Observe one validated Provider Usage report. Empty reports do not change accounting. */
  observeUsage(usage: TokenUsage): RunTokenBudgetObservation {
    const parsed = tokenUsageSchema.safeParse(usage);
    if (!parsed.success) {
      throw new InvalidRunTokenEstimateError();
    }
    if (!hasTokenUsage(parsed.data)) {
      return { outcome: "none" };
    }

    const merged = mergeTokenUsage(this.#actualUsage, parsed.data);
    if (!merged.ok) {
      // A cumulative Provider count beyond the shared bound is certainly beyond any valid Run
      // budget. Do not fabricate the overflowing Provider value in the user-visible snapshot.
      this.#actualOverflowed = true;
      this.#actualTokens = undefined;
    } else {
      this.#actualUsage = merged.usage;
      const tokenCount = usageTokenCount(merged.usage);
      if (tokenCount === "overflow") {
        // Individual Usage fields are bounded, but their derived input+output total can still
        // overflow the shared bound. Preserve provenance without displaying a fabricated clamp.
        this.#actualOverflowed = true;
        this.#actualTokens = undefined;
      } else {
        this.#actualTokens = tokenCount;
      }
    }
    return this.#evaluate("actual");
  }

  /** Returns the last bounded projection for a warning/exceeded event, or undefined before one. */
  snapshot(state: "warning" | "exceeded", source: "estimate" | "actual"): RunTokenBudgetSnapshot {
    const effectiveTokens = this.#effectiveTokens();
    return runTokenBudgetSnapshotSchema.parse({
      state,
      source,
      maxTokens: this.#configuration.maxTokens,
      warningTokens: this.#configuration.warningTokens,
      estimatedTokens: this.#estimatedTokens,
      ...(this.#actualTokens === undefined ? {} : { actualTokens: this.#actualTokens }),
      effectiveTokens: Math.min(effectiveTokens, maxTokenCount),
    });
  }

  #evaluate(source: "estimate" | "actual"): RunTokenBudgetObservation {
    const effectiveTokens = this.#effectiveTokens();
    if (effectiveTokens >= this.#configuration.maxTokens) {
      return { outcome: "exceeded", snapshot: this.snapshot("exceeded", source) };
    }
    if (effectiveTokens >= this.#configuration.warningTokens && !this.#warningReported) {
      this.#warningReported = true;
      return { outcome: "warning", snapshot: this.snapshot("warning", source) };
    }
    return { outcome: "none" };
  }

  #effectiveTokens(): number {
    return this.#actualOverflowed
      ? maxTokenCount
      : Math.max(this.#estimatedTokens, this.#actualTokens ?? 0);
  }
}

function usageTokenCount(usage: TokenUsage): number | "overflow" | undefined {
  const inputTokens = usage.inputTokens;
  const outputTokens = usage.outputTokens;
  let fieldTotal: number | undefined;
  if (inputTokens !== undefined && outputTokens !== undefined) {
    if (inputTokens > maxTokenCount - outputTokens) {
      return "overflow";
    }
    fieldTotal = inputTokens + outputTokens;
  }
  const totals = [usage.totalTokens, fieldTotal, inputTokens, outputTokens].filter(
    (value): value is number => value !== undefined,
  );
  if (totals.length === 0) {
    return undefined;
  }
  return Math.max(...totals);
}

function saturatingAdd(left: number, right: number): number {
  return left > maxTokenCount - right ? maxTokenCount : left + right;
}
