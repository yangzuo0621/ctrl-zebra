import type {
  JsonValue,
  TokenUsage as ProtocolTokenUsage,
  ToolCall,
  ToolName,
  ToolResult,
} from "@ctrl-zebra/protocol";

export type { ToolCall } from "@ctrl-zebra/protocol";

export type ModelMessageRole = "system" | "user" | "assistant";

export interface ModelTextMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
}

export interface ModelToolCallMessage {
  readonly role: "assistant";
  readonly toolCall: ToolCall;
}

export interface ModelToolResultMessage {
  readonly role: "tool";
  readonly result: ToolResult;
}

export type ModelMessage = ModelTextMessage | ModelToolCallMessage | ModelToolResultMessage;

export interface ToolInputStringSchema {
  readonly type: "string";
  readonly description: string;
  readonly minLength?: number;
  readonly maxLength?: number;
  readonly pattern?: string;
}

export interface ToolInputIntegerSchema {
  readonly type: "integer";
  readonly description: string;
  readonly minimum?: number;
  readonly maximum?: number;
}

export interface ToolInputObjectSchema {
  readonly type: "object";
  readonly description: string;
  readonly properties: Readonly<Record<string, ToolInputPropertySchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

export interface ToolInputArraySchema {
  readonly type: "array";
  readonly description: string;
  readonly items: ToolInputPropertySchema;
  readonly minItems?: number;
  readonly maxItems?: number;
}

export type ToolInputPropertySchema =
  | ToolInputStringSchema
  | ToolInputIntegerSchema
  | ToolInputObjectSchema
  | ToolInputArraySchema;

export interface ToolInputSchema {
  readonly type: "object";
  readonly properties: Readonly<Record<string, ToolInputPropertySchema>>;
  readonly required: readonly string[];
  readonly additionalProperties: false;
}

/** A boundary-validated Draft 2020-12 schema retained without SDK-specific types. */
export interface ExternalToolInputSchema {
  readonly kind: "external_json_schema_2020_12";
  readonly jsonSchema: Readonly<Record<string, JsonValue>>;
}

export type AgentToolInputSchema = ToolInputSchema | ExternalToolInputSchema;

export interface ToolDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: AgentToolInputSchema;
}

export interface ModelRequest {
  readonly instructions?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ToolDeclaration[];
}

export type TokenUsage = ProtocolTokenUsage;

export type FinishReason = "stop" | "tool-calls" | "length" | "content-filter" | "other";

export const maxReasoningBlockIdCharacters = 128;
export const maxReasoningDeltaCodePoints = 8_192;
export const maxReasoningDeltaUtf8Bytes = 32_768;

export type ModelReasoningEvent =
  | { readonly type: "reasoning.start"; readonly blockId: string }
  | { readonly type: "reasoning.delta"; readonly blockId: string; readonly text: string }
  | { readonly type: "reasoning.end"; readonly blockId: string };

export type ModelEvent =
  | { readonly type: "text.delta"; readonly text: string }
  | ModelReasoningEvent
  | { readonly type: "tool.call"; readonly call: ToolCall }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "finish"; readonly reason: FinishReason };

export type ModelGatewayErrorCode =
  | "authentication"
  | "permission-denied"
  | "model-not-found"
  | "rate-limit"
  | "context-overflow"
  | "invalid-request"
  | "unavailable"
  | "malformed-response"
  | "unknown";

export class ModelGatewayError extends Error {
  constructor(
    readonly code: ModelGatewayErrorCode,
    options: ModelGatewayErrorOptions = {},
  ) {
    super(`Model provider failed with category: ${code}.`);
    this.name = "ModelGatewayError";
    if (options.cause !== undefined) {
      Object.defineProperty(this, "cause", {
        configurable: true,
        enumerable: false,
        value: options.cause,
        writable: true,
      });
    }
  }
}

export interface ModelGatewayErrorOptions {
  readonly cause?: unknown;
}

export interface ModelGateway {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
