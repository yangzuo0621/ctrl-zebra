import {
  type ConversationSummarizer,
  type ConversationSummary,
  type ConversationSummaryRange,
  parseConversationSummary,
} from "./conversation-summarizer.js";
import {
  InvalidModelHistoryError,
  InvalidModelMessageTokenCountError,
  type ModelMessageTokenCounter,
  pruneModelHistory,
} from "./history-pruner.js";
import type { ModelMessage } from "./model-gateway.js";
import { maxModelContextWindowTokens } from "./token-budget.js";

export const maxContextOverflowRecoveryAttempts = 2;
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
  readonly summaryRange: ConversationSummaryRange;
}

export interface ContextOverflowRecoveryDependencies<Result> {
  readonly tokenCounter: ModelMessageTokenCounter;
  readonly summarizer: ConversationSummarizer;
  readonly retry: ContextRecoveryRetry<Result>;
}

export interface RecoveredContext<Result> {
  readonly value: Result;
  readonly messages: readonly ModelMessage[];
  readonly estimatedTokens: number;
  readonly attempts: number;
  readonly summary?: ConversationSummary;
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
      attempts: 1,
    };
  }

  const summarySource = selectSummarySource(
    request.messages,
    request.summaryRange,
    dependencies.tokenCounter,
  );
  const summary = parseConversationSummary(
    await dependencies.summarizer.summarize(
      {
        messages: summarySource,
        coveredMessageRange: request.summaryRange,
      },
      signal,
    ),
  );
  signal.throwIfAborted();
  if (!rangesEqual(summary.coveredMessageRange, request.summaryRange)) {
    throw new InvalidContextRecoverySummaryError("mismatch");
  }

  const summarizedMessages = replaceSummaryRange(request.messages, request.summaryRange, summary);
  const summarized = pruneModelHistory(
    summarizedMessages,
    request.maxHistoryTokens,
    dependencies.tokenCounter,
  );
  if (summarized.estimatedTokens >= pruned.estimatedTokens) {
    throw new ContextOverflowRecoveryExhaustedError(1, "no-reduction");
  }

  signal.throwIfAborted();
  const secondRetry = await dependencies.retry.retry(summarized.messages, signal);
  signal.throwIfAborted();
  if (secondRetry.outcome === "success") {
    return {
      value: secondRetry.value,
      messages: summarized.messages,
      estimatedTokens: summarized.estimatedTokens,
      attempts: maxContextOverflowRecoveryAttempts,
      summary,
    };
  }

  throw new ContextOverflowRecoveryExhaustedError(
    maxContextOverflowRecoveryAttempts,
    "retry-limit",
  );
}

function selectSummarySource(
  messages: readonly ModelMessage[],
  range: ConversationSummaryRange,
  tokenCounter: ModelMessageTokenCounter,
): readonly ModelMessage[] {
  const latestUserIndex = findLatestUserIndex(messages);
  if (
    !Number.isSafeInteger(range.startMessageIndex) ||
    !Number.isSafeInteger(range.endMessageIndexExclusive) ||
    range.startMessageIndex < 0 ||
    range.endMessageIndexExclusive <= range.startMessageIndex ||
    range.endMessageIndexExclusive > messages.length ||
    latestUserIndex === undefined ||
    range.endMessageIndexExclusive > latestUserIndex
  ) {
    throw new InvalidContextRecoverySummaryError("range");
  }

  const source = messages.slice(range.startMessageIndex, range.endMessageIndexExclusive);
  if (source.some(({ role }) => role === "system")) {
    throw new InvalidContextRecoverySummaryError("range");
  }

  try {
    pruneModelHistory(source, maxModelContextWindowTokens, tokenCounter);
  } catch (error) {
    if (error instanceof InvalidModelHistoryError) {
      throw new InvalidContextRecoverySummaryError("range");
    }
    throw error;
  }

  return source;
}

function replaceSummaryRange(
  messages: readonly ModelMessage[],
  range: ConversationSummaryRange,
  summary: ConversationSummary,
): readonly ModelMessage[] {
  const summaryMessage: ModelMessage = {
    role: "user",
    content: `${conversationSummaryMessagePrefix}\n${summary.content}`,
  };
  return [
    ...messages.slice(0, range.startMessageIndex),
    summaryMessage,
    ...messages.slice(range.endMessageIndexExclusive),
  ];
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

function findLatestUserIndex(messages: readonly ModelMessage[]): number | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.role === "user") {
      return index;
    }
  }
  return undefined;
}

function rangesEqual(left: ConversationSummaryRange, right: ConversationSummaryRange): boolean {
  return (
    left.startMessageIndex === right.startMessageIndex &&
    left.endMessageIndexExclusive === right.endMessageIndexExclusive
  );
}
