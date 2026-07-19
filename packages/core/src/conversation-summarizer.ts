import type { ModelMessage } from "./model-gateway.js";

export const conversationSummaryKind = "conversation-summary" as const;
export const conversationSummaryVersion = 1 as const;
export const maxConversationSummaryCharacters = 32_768;

export interface ConversationSummaryRange {
  readonly startMessageIndex: number;
  readonly endMessageIndexExclusive: number;
}

export interface ConversationSummary {
  readonly kind: typeof conversationSummaryKind;
  readonly version: typeof conversationSummaryVersion;
  readonly coveredMessageRange: ConversationSummaryRange;
  readonly content: string;
}

export interface SummarizeConversationRequest {
  readonly messages: readonly ModelMessage[];
  readonly coveredMessageRange: ConversationSummaryRange;
}

export interface ConversationSummarizer {
  summarize(
    request: SummarizeConversationRequest,
    signal: AbortSignal,
  ): Promise<ConversationSummary>;
}

export class InvalidConversationSummaryError extends Error {
  constructor() {
    super("Conversation summary is invalid.");
    this.name = "InvalidConversationSummaryError";
  }
}

export function parseConversationSummary(value: unknown): ConversationSummary {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["kind", "version", "coveredMessageRange", "content"]) ||
    value.kind !== conversationSummaryKind ||
    value.version !== conversationSummaryVersion ||
    typeof value.content !== "string" ||
    value.content.length === 0 ||
    !isSummaryContentLengthValid(value.content)
  ) {
    throw new InvalidConversationSummaryError();
  }

  const coveredMessageRange = parseConversationSummaryRange(value.coveredMessageRange);
  return {
    kind: conversationSummaryKind,
    version: conversationSummaryVersion,
    coveredMessageRange,
    content: value.content,
  };
}

function parseConversationSummaryRange(value: unknown): ConversationSummaryRange {
  if (
    !isRecord(value) ||
    !hasExactKeys(value, ["startMessageIndex", "endMessageIndexExclusive"]) ||
    !isNonnegativeSafeInteger(value.startMessageIndex) ||
    !isNonnegativeSafeInteger(value.endMessageIndexExclusive) ||
    value.endMessageIndexExclusive <= value.startMessageIndex
  ) {
    throw new InvalidConversationSummaryError();
  }

  return {
    startMessageIndex: value.startMessageIndex,
    endMessageIndexExclusive: value.endMessageIndexExclusive,
  };
}

function isSummaryContentLengthValid(value: string): boolean {
  let characters = 0;

  for (let index = 0; index < value.length; index += 1) {
    const first = value.charCodeAt(index);
    if (first >= 0xd800 && first <= 0xdbff) {
      const second = value.charCodeAt(index + 1);
      if (!(second >= 0xdc00 && second <= 0xdfff)) {
        return false;
      }
      index += 1;
    } else if (first >= 0xdc00 && first <= 0xdfff) {
      return false;
    }

    characters += 1;
    if (characters > maxConversationSummaryCharacters) {
      return false;
    }
  }

  return true;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys(value: Readonly<Record<string, unknown>>, keys: readonly string[]): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isNonnegativeSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
