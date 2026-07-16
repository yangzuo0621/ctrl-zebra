import { z } from "zod";

export const protocolVersion = 1 as const;

const requestIdSchema = z.string().min(1).max(128);
const messageTypeSchema = z.string().regex(/^[^/]+\/[^/]+$/);
const submittedContentSchema = z
  .string()
  .min(1)
  .max(1_000_000)
  .refine((content) => content.trim().length > 0);

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

export const submitMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/submit"),
  content: submittedContentSchema,
});

export const cancelMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/cancel"),
});

export const textDeltaMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/text-delta"),
  text: z.string().min(1).max(1_000_000),
});

export const runStatusSchema = z.enum([
  "preparing",
  "streaming",
  "completed",
  "cancelled",
  "failed",
]);

export const runStatusMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/run-status"),
  status: runStatusSchema,
});

export const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  pingMessageSchema,
  submitMessageSchema,
  cancelMessageSchema,
]);
export const extensionToWebviewMessageSchema = z.discriminatedUnion("type", [
  pongMessageSchema,
  textDeltaMessageSchema,
  runStatusMessageSchema,
]);

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type CancelMessage = z.infer<typeof cancelMessageSchema>;
export type TextDeltaMessage = z.infer<typeof textDeltaMessageSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStatusMessage = z.infer<typeof runStatusMessageSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;
export type ExtensionToWebviewMessage = z.infer<typeof extensionToWebviewMessageSchema>;
