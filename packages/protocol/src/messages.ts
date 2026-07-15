import { z } from "zod";

export const protocolVersion = 1 as const;

const requestIdSchema = z.string().min(1).max(128);
const messageTypeSchema = z.string().regex(/^[^/]+\/[^/]+$/);

export const protocolEnvelopeSchema = z.strictObject({
  protocolVersion: z.literal(protocolVersion),
  type: messageTypeSchema,
  requestId: requestIdSchema,
});

export const pingMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/ping"),
});

export const pongMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/pong"),
});

export const webviewToExtensionMessageSchema = pingMessageSchema;
export const extensionToWebviewMessageSchema = pongMessageSchema;

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;
export type ExtensionToWebviewMessage = z.infer<typeof extensionToWebviewMessageSchema>;
