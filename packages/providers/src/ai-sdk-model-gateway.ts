import {
  type FinishReason,
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelGatewayErrorCode,
  type ModelMessage,
  type ModelRequest,
  type TokenUsage,
  toolCallSchema,
} from "@ctrl-zebra/core";
import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  type LanguageModel,
  LoadAPIKeyError,
  NoSuchModelError,
  streamText,
  TypeValidationError,
} from "ai";

export const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

export function createAISDKModelGateway(model: LanguageModel): ModelGateway {
  return {
    async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
      signal.throwIfAborted();

      try {
        const result = streamText({
          abortSignal: signal,
          maxRetries: 0,
          messages: toSdkMessages(request.messages),
          model,
        });

        for await (const value of result.stream) {
          signal.throwIfAborted();

          for (const event of mapStreamPart(value, signal)) {
            signal.throwIfAborted();
            yield event;
          }
        }

        signal.throwIfAborted();
      } catch (error) {
        if (signal.aborted) {
          throw signal.reason;
        }

        if (error instanceof ModelGatewayError) {
          throw error;
        }

        throw new ModelGatewayError(classifyProviderError(error));
      }
    },
  };
}

function toSdkMessages(messages: readonly ModelMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }));
}

function mapStreamPart(value: unknown, signal: AbortSignal): readonly ModelEvent[] {
  const part = readRecord(value);
  const type = readString(part, "type");

  switch (type) {
    case "text-delta":
      return [{ type: "text.delta", text: readString(part, "text") }];
    case "tool-call":
      return [
        {
          type: "tool.call",
          call: parseToolCall({
            id: readString(part, "toolCallId"),
            name: readString(part, "toolName"),
            input: part.input,
          }),
        },
      ];
    case "finish": {
      const usage = readUsage(part.totalUsage);
      const reason = readFinishReason(part.finishReason);
      return [
        { type: "usage", usage },
        { type: "finish", reason },
      ];
    }
    case "abort":
      signal.throwIfAborted();
      throw new ModelGatewayError("unknown");
    case "error":
      throw new ModelGatewayError(classifyProviderError(part.error));
    case "file":
    case "finish-step":
    case "raw":
    case "reasoning-delta":
    case "reasoning-end":
    case "reasoning-start":
    case "source":
    case "start":
    case "start-step":
    case "text-end":
    case "text-start":
    case "tool-approval-request":
    case "tool-error":
    case "tool-input-delta":
    case "tool-input-end":
    case "tool-input-start":
    case "tool-output-denied":
    case "tool-result":
      return [];
    default:
      throw new ModelGatewayError("malformed-response");
  }
}

function parseToolCall(value: unknown) {
  const result = toolCallSchema.safeParse(value);

  if (!result.success) {
    throw new ModelGatewayError("malformed-response");
  }

  return result.data;
}

function readUsage(value: unknown): TokenUsage {
  const usage = readRecord(value);

  return {
    inputTokens: readOptionalTokenCount(usage.inputTokens),
    outputTokens: readOptionalTokenCount(usage.outputTokens),
    totalTokens: readOptionalTokenCount(usage.totalTokens),
  };
}

function readFinishReason(value: unknown): FinishReason {
  switch (value) {
    case "stop":
    case "tool-calls":
    case "length":
    case "content-filter":
    case "other":
      return value;
    case "error":
      return "other";
    default:
      throw new ModelGatewayError("malformed-response");
  }
}

function readOptionalTokenCount(value: unknown): number | undefined {
  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new ModelGatewayError("malformed-response");
  }

  return value;
}

function readRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new ModelGatewayError("malformed-response");
  }

  return Object.fromEntries(Object.entries(value));
}

function readString(record: Readonly<Record<string, unknown>>, key: string): string {
  const value = record[key];

  if (typeof value !== "string") {
    throw new ModelGatewayError("malformed-response");
  }

  return value;
}

function classifyProviderError(error: unknown): ModelGatewayErrorCode {
  if (LoadAPIKeyError.isInstance(error)) {
    return "authentication";
  }

  if (
    InvalidArgumentError.isInstance(error) ||
    InvalidPromptError.isInstance(error) ||
    NoSuchModelError.isInstance(error)
  ) {
    return "invalid-request";
  }

  if (
    EmptyResponseBodyError.isInstance(error) ||
    InvalidResponseDataError.isInstance(error) ||
    JSONParseError.isInstance(error) ||
    TypeValidationError.isInstance(error)
  ) {
    return "malformed-response";
  }

  if (APICallError.isInstance(error)) {
    return classifyApiCallError(error.statusCode, error.isRetryable);
  }

  return "unknown";
}

function classifyApiCallError(
  statusCode: number | undefined,
  isRetryable: boolean,
): ModelGatewayErrorCode {
  if (statusCode === 401 || statusCode === 403) {
    return "authentication";
  }

  if (statusCode === 429) {
    return "rate-limit";
  }

  if (isRetryable || (statusCode !== undefined && statusCode >= 500)) {
    return "unavailable";
  }

  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return "invalid-request";
  }

  return "unknown";
}
