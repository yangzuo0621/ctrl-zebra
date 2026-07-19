import {
  type FinishReason,
  type JsonValue,
  type ModelEvent,
  type ModelGateway,
  ModelGatewayError,
  type ModelGatewayErrorCode,
  type ModelMessage,
  type ModelRequest,
  type TokenUsage,
  type ToolDeclaration,
  type ToolInputPropertySchema,
  type ToolInputSchema,
  type ToolResult,
  toolCallSchema,
} from "@ctrl-zebra/core";
import {
  APICallError,
  EmptyResponseBodyError,
  InvalidArgumentError,
  InvalidPromptError,
  InvalidResponseDataError,
  JSONParseError,
  type JSONSchema7,
  jsonSchema,
  type LanguageModel,
  LoadAPIKeyError,
  NoSuchModelError,
  streamText,
  type ToolResultPart,
  type ToolSet,
  TypeValidationError,
} from "ai";

export const noRedirectFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, redirect: "error" });

export function createAISDKModelGateway(model: LanguageModel): ModelGateway {
  return {
    async *stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
      signal.throwIfAborted();

      try {
        const tools = toSdkTools(request.tools);
        const result = streamText({
          abortSignal: signal,
          maxRetries: 0,
          messages: toSdkMessages(request.messages),
          model,
          ...(tools === undefined ? {} : { tools }),
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

function toSdkTools(declarations: readonly ToolDeclaration[] | undefined): ToolSet | undefined {
  if (declarations === undefined || declarations.length === 0) {
    return undefined;
  }

  return Object.fromEntries(
    declarations.map((declaration) => [
      declaration.name,
      {
        description: declaration.description,
        inputSchema: jsonSchema(toSdkInputSchema(declaration.inputSchema)),
      },
    ]),
  );
}

function toSdkInputSchema(schema: ToolInputSchema): JSONSchema7 {
  return {
    type: "object",
    properties: Object.fromEntries(
      Object.entries(schema.properties).map(([name, property]) => [
        name,
        toSdkInputProperty(property),
      ]),
    ),
    required: [...schema.required],
    additionalProperties: schema.additionalProperties,
  };
}

function toSdkInputProperty(property: ToolInputPropertySchema): JSONSchema7 {
  switch (property.type) {
    case "string":
      return {
        type: property.type,
        description: property.description,
        ...(property.minLength === undefined ? {} : { minLength: property.minLength }),
        ...(property.maxLength === undefined ? {} : { maxLength: property.maxLength }),
        ...(property.pattern === undefined ? {} : { pattern: property.pattern }),
      };
    case "integer":
      return {
        type: property.type,
        description: property.description,
        ...(property.minimum === undefined ? {} : { minimum: property.minimum }),
        ...(property.maximum === undefined ? {} : { maximum: property.maximum }),
      };
    case "object":
      return {
        type: property.type,
        description: property.description,
        properties: Object.fromEntries(
          Object.entries(property.properties).map(([name, nestedProperty]) => [
            name,
            toSdkInputProperty(nestedProperty),
          ]),
        ),
        required: [...property.required],
        additionalProperties: property.additionalProperties,
      };
    case "array":
      return {
        type: property.type,
        description: property.description,
        items: toSdkInputProperty(property.items),
        ...(property.minItems === undefined ? {} : { minItems: property.minItems }),
        ...(property.maxItems === undefined ? {} : { maxItems: property.maxItems }),
      };
  }
}

function toSdkMessages(messages: readonly ModelMessage[]) {
  return messages.map((message) => {
    if ("content" in message) {
      return { role: message.role, content: message.content };
    }

    if (message.role === "assistant") {
      return {
        role: "assistant" as const,
        content: [
          {
            type: "tool-call" as const,
            toolCallId: message.toolCall.id,
            toolName: message.toolCall.name,
            input: message.toolCall.input,
          },
        ],
      };
    }

    return {
      role: "tool" as const,
      content: [
        {
          type: "tool-result" as const,
          toolCallId: message.result.callId,
          toolName: message.result.name,
          output: toSdkToolResultOutput(message.result),
        },
      ],
    };
  });
}

function toSdkToolResultOutput(result: ToolResult): ToolResultPart["output"] {
  if (result.status === "success") {
    return {
      type: "json",
      value: {
        callId: result.callId,
        name: result.name,
        status: result.status,
        output: toSdkJsonValue(result.output),
        truncated: result.truncated,
      },
    };
  }

  return {
    type: "error-json",
    value: {
      callId: result.callId,
      name: result.name,
      status: result.status,
      error: {
        code: result.error.code,
        message: result.error.message,
      },
    },
  };
}

type SdkJsonValue = Extract<ToolResultPart["output"], { type: "json" }>["value"];

function toSdkJsonValue(value: JsonValue): SdkJsonValue {
  if (value === null || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(toSdkJsonValue);
  }

  return Object.fromEntries(
    Object.entries(value).map(([key, nestedValue]) => [key, toSdkJsonValue(nestedValue)]),
  );
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
