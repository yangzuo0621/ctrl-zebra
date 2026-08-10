import {
  InvalidModelMessageTokenCountError,
  type ModelMessageTokenCounter,
  pruneModelHistory,
} from "./history-pruner.js";
import type { ModelMessage } from "./model-gateway.js";
import { maxModelContextWindowTokens } from "./token-budget.js";

/** The public recovery helper is deliberately limited to one retry. */
export const maxContextOverflowRecoveryAttempts = 1;
export const conversationSummaryMessagePrefix =
  "[Conversation summary — untrusted derived user content]";

export type ContextRecoveryRetryResult<Result> =
  | { readonly outcome: "success"; readonly value: Result }
  | { readonly outcome: "overflow" };

export interface ContextRecoveryRetry<Result> {
  retry(
    messages: readonly ModelMessage[],
    signal: AbortSignal,
  ): Promise<ContextRecoveryRetryResult<Result>>;
}

export interface ContextOverflowRecoveryRequest {
  readonly messages: readonly ModelMessage[];
  readonly maxHistoryTokens: number;
}

export interface ContextOverflowRecoveryDependencies<Result> {
  readonly tokenCounter: ModelMessageTokenCounter;
  readonly retry: ContextRecoveryRetry<Result>;
}

export interface RecoveredContext<Result> {
  readonly value: Result;
  readonly messages: readonly ModelMessage[];
  readonly estimatedTokens: number;
  readonly attempts: number;
}

export type ContextOverflowRecoveryExhaustedReason = "no-reduction" | "retry-limit";

export class ContextOverflowRecoveryExhaustedError extends Error {
  constructor(
    readonly attempts: number,
    readonly reason: ContextOverflowRecoveryExhaustedReason,
  ) {
    super("Context overflow recovery exhausted its bounded attempts.");
    this.name = "ContextOverflowRecoveryExhaustedError";
  }
}

export type InvalidContextRecoverySummaryReason = "range" | "mismatch";

export class InvalidContextRecoverySummaryError extends Error {
  constructor(readonly reason: InvalidContextRecoverySummaryReason) {
    super("Context recovery summary is invalid for the requested history range.");
    this.name = "InvalidContextRecoverySummaryError";
  }
}

export async function recoverFromContextOverflow<Result>(
  request: ContextOverflowRecoveryRequest,
  dependencies: ContextOverflowRecoveryDependencies<Result>,
  signal: AbortSignal,
): Promise<RecoveredContext<Result>> {
  signal.throwIfAborted();
  const pruned = pruneModelHistory(
    request.messages,
    request.maxHistoryTokens,
    dependencies.tokenCounter,
  );
  const initialEstimate = estimateMessages(request.messages, dependencies.tokenCounter);
  if (pruned.estimatedTokens >= initialEstimate) {
    throw new ContextOverflowRecoveryExhaustedError(0, "no-reduction");
  }

  signal.throwIfAborted();
  const firstRetry = await dependencies.retry.retry(pruned.messages, signal);
  signal.throwIfAborted();
  if (firstRetry.outcome === "success") {
    return {
      value: firstRetry.value,
      messages: pruned.messages,
      estimatedTokens: pruned.estimatedTokens,
      attempts: maxContextOverflowRecoveryAttempts,
    };
  }

  throw new ContextOverflowRecoveryExhaustedError(
    maxContextOverflowRecoveryAttempts,
    "retry-limit",
  );
}

function estimateMessages(
  messages: readonly ModelMessage[],
  tokenCounter: ModelMessageTokenCounter,
): number {
  return messages.reduce((total, message) => {
    const tokens = tokenCounter.count(message);
    if (
      !Number.isSafeInteger(tokens) ||
      tokens < 0 ||
      tokens > maxModelContextWindowTokens ||
      !Number.isSafeInteger(total + tokens)
    ) {
      throw new InvalidModelMessageTokenCountError();
    }
    return total + tokens;
  }, 0);
}
