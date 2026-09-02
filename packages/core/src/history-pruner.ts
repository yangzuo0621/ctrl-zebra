import { toolCallSchema, toolResultSchema } from "@ctrl-zebra/protocol";
import type { ModelMessage, ModelToolCallMessage } from "./model-gateway.js";
import { hasExactKeys, isPlainRecord } from "./record-validation.js";
import { maxModelContextWindowTokens } from "./token-budget.js";

const maxHistoryMessageCharacters = 1_000_000;
const maxHistoryMessages = 10_000;

export interface ModelMessageTokenCounter {
  count(message: ModelMessage): number;
}

export interface PrunedModelHistory {
  readonly messages: readonly ModelMessage[];
  readonly estimatedTokens: number;
  readonly pruned: boolean;
  readonly overBudget: boolean;
}

interface ToolPair {
  readonly callIndex: number;
  readonly resultIndex: number;
}

interface HistoryUnit {
  readonly indexes: readonly number[];
  readonly tokens: number;
  readonly protected: boolean;
  retained: boolean;
}

export class InvalidModelHistoryError extends Error {
  constructor() {
    super("Model history contains an invalid Tool Call/Result sequence.");
    this.name = "InvalidModelHistoryError";
  }
}

export class InvalidHistoryBudgetError extends Error {
  constructor() {
    super(
      `History budget must be a nonnegative safe integer no greater than ${maxModelContextWindowTokens}.`,
    );
    this.name = "InvalidHistoryBudgetError";
  }
}

export class InvalidModelMessageTokenCountError extends Error {
  constructor() {
    super(
      `Model message token count must be a nonnegative safe integer no greater than ${maxModelContextWindowTokens}.`,
    );
    this.name = "InvalidModelMessageTokenCountError";
  }
}

export function pruneModelHistory(
  messages: readonly ModelMessage[],
  maxTokens: number,
  tokenCounter: ModelMessageTokenCounter,
): PrunedModelHistory {
  if (
    !Number.isSafeInteger(maxTokens) ||
    maxTokens < 0 ||
    maxTokens > maxModelContextWindowTokens
  ) {
    throw new InvalidHistoryBudgetError();
  }

  const toolPairs = pairToolMessages(messages);
  const messageTokens = messages.map((message) => {
    const tokens = tokenCounter.count(message);
    if (!Number.isSafeInteger(tokens) || tokens < 0 || tokens > maxModelContextWindowTokens) {
      throw new InvalidModelMessageTokenCountError();
    }
    return tokens;
  });
  const latestUserIndex = findLatestUserIndex(messages);
  const units = createHistoryUnits(messages, messageTokens, toolPairs, latestUserIndex);
  let estimatedTokens = sumUnitTokens(units);
  let pruned = false;

  for (const unit of units) {
    if (estimatedTokens <= maxTokens) {
      break;
    }
    if (unit.protected) {
      continue;
    }

    unit.retained = false;
    estimatedTokens -= unit.tokens;
    pruned = true;
  }

  if (!pruned) {
    return {
      messages,
      estimatedTokens,
      pruned: false,
      overBudget: estimatedTokens > maxTokens,
    };
  }

  const retainedIndexes = new Set(
    units.filter(({ retained }) => retained).flatMap(({ indexes }) => indexes),
  );
  return {
    messages: messages.filter((_message, index) => retainedIndexes.has(index)),
    estimatedTokens,
    pruned: true,
    overBudget: estimatedTokens > maxTokens,
  };
}

/** Validates untrusted persisted history before it enters pruning or a Provider request. */
export function validateModelHistory(history: unknown): readonly ModelMessage[] {
  if (!Array.isArray(history) || history.length > maxHistoryMessages) {
    throw new InvalidModelHistoryError();
  }

  const validated: ModelMessage[] = [];
  for (let index = 0; index < history.length; index += 1) {
    if (!Object.hasOwn(history, index)) {
      throw new InvalidModelHistoryError();
    }
    validated.push(validateModelHistoryMessage(history[index]));
  }
  return validated;
}

/** Estimates a complete message sequence with the same bounded-count rules as pruning. */
export function estimateModelMessages(
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

function validateModelHistoryMessage(message: unknown): ModelMessage {
  if (!isPlainRecord(message)) {
    throw new InvalidModelHistoryError();
  }

  if (hasExactKeys(message, ["content", "role"])) {
    if (
      (message.role !== "user" && message.role !== "assistant") ||
      typeof message.content !== "string" ||
      message.content.length < 1 ||
      message.content.length > maxHistoryMessageCharacters
    ) {
      throw new InvalidModelHistoryError();
    }
    return { role: message.role, content: message.content };
  }

  if (hasExactKeys(message, ["role", "toolCall"])) {
    if (message.role !== "assistant") {
      throw new InvalidModelHistoryError();
    }
    const toolCall = toolCallSchema.safeParse(message.toolCall);
    if (!toolCall.success) {
      throw new InvalidModelHistoryError();
    }
    return { role: "assistant", toolCall: toolCall.data };
  }

  if (hasExactKeys(message, ["result", "role"])) {
    if (message.role !== "tool") {
      throw new InvalidModelHistoryError();
    }
    const result = toolResultSchema.safeParse(message.result);
    if (!result.success) {
      throw new InvalidModelHistoryError();
    }
    return { role: "tool", result: result.data };
  }

  throw new InvalidModelHistoryError();
}

function pairToolMessages(messages: readonly ModelMessage[]): readonly ToolPair[] {
  const pendingCalls = new Map<
    string,
    { readonly index: number; readonly message: ModelToolCallMessage }
  >();
  const completedCallIds = new Set<string>();
  const pairs: ToolPair[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index];
    if (message === undefined) {
      continue;
    }

    if (isToolCallMessage(message)) {
      const callId = message.toolCall.id;
      if (pendingCalls.has(callId) || completedCallIds.has(callId)) {
        throw new InvalidModelHistoryError();
      }
      pendingCalls.set(callId, { index, message });
      continue;
    }

    if (message.role !== "tool") {
      continue;
    }

    const call = pendingCalls.get(message.result.callId);
    if (call === undefined || call.message.toolCall.name !== message.result.name) {
      throw new InvalidModelHistoryError();
    }

    pendingCalls.delete(message.result.callId);
    completedCallIds.add(message.result.callId);
    pairs.push({ callIndex: call.index, resultIndex: index });
  }

  if (pendingCalls.size > 0) {
    throw new InvalidModelHistoryError();
  }

  return pairs;
}

function createHistoryUnits(
  messages: readonly ModelMessage[],
  messageTokens: readonly number[],
  toolPairs: readonly ToolPair[],
  latestUserIndex: number | undefined,
): HistoryUnit[] {
  const pairByCallIndex = new Map(toolPairs.map((pair) => [pair.callIndex, pair]));
  const resultIndexes = new Set(toolPairs.map(({ resultIndex }) => resultIndex));
  const units: HistoryUnit[] = [];

  for (let index = 0; index < messages.length; index += 1) {
    if (resultIndexes.has(index)) {
      continue;
    }

    const pair = pairByCallIndex.get(index);
    const indexes = pair === undefined ? [index] : [pair.callIndex, pair.resultIndex];
    const tokens = indexes.reduce((total, messageIndex) => {
      const count = messageTokens[messageIndex];
      if (count === undefined || !Number.isSafeInteger(total + count)) {
        throw new InvalidModelMessageTokenCountError();
      }
      return total + count;
    }, 0);
    const isProtected = indexes.some((messageIndex) => {
      const message = messages[messageIndex];
      return message?.role === "system" || messageIndex === latestUserIndex;
    });

    units.push({ indexes, tokens, protected: isProtected, retained: true });
  }

  return units;
}

function sumUnitTokens(units: readonly HistoryUnit[]): number {
  return units.reduce((total, unit) => {
    if (!Number.isSafeInteger(total + unit.tokens)) {
      throw new InvalidModelMessageTokenCountError();
    }
    return total + unit.tokens;
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

function isToolCallMessage(message: ModelMessage): message is ModelToolCallMessage {
  return "toolCall" in message;
}
