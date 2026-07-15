export type ModelMessageRole = "system" | "user" | "assistant";

export interface ModelMessage {
  readonly role: ModelMessageRole;
  readonly content: string;
}

export interface ModelRequest {
  readonly messages: readonly ModelMessage[];
}

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
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
