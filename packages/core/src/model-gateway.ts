import type { ToolCall, ToolName, ToolResult } from "@ctrl-zebra/protocol";

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

export interface ToolDeclaration {
  readonly name: ToolName;
  readonly description: string;
  readonly inputSchema: ToolInputSchema;
}

export interface ModelRequest {
  readonly instructions?: string;
  readonly messages: readonly ModelMessage[];
  readonly tools?: readonly ToolDeclaration[];
}

export interface TokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
}

export type FinishReason = "stop" | "tool-calls" | "length" | "content-filter" | "other";

export type ModelEvent =
  | { readonly type: "text.delta"; readonly text: string }
  | { readonly type: "tool.call"; readonly call: ToolCall }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "finish"; readonly reason: FinishReason };

export type ModelGatewayErrorCode =
  | "authentication"
  | "rate-limit"
  | "invalid-request"
  | "unavailable"
  | "malformed-response"
  | "unknown";

export class ModelGatewayError extends Error {
  constructor(readonly code: ModelGatewayErrorCode) {
    super(`Model provider failed with category: ${code}.`);
    this.name = "ModelGatewayError";
  }
}

export interface ModelGateway {
  stream(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
