import { z } from "zod";

import {
  approvalRequestIdSchema,
  approvalRequestSchema,
  approvalStatusSchema,
} from "./approval.js";
import { toolCallSchema, toolErrorResultSchema, toolSuccessResultSchema } from "./tool.js";

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

export const showApprovalDiffMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/show-approval-diff"),
  approvalId: approvalRequestIdSchema,
});

export const approvalDecisionIntentSchema = z.enum(["approved", "denied"]);

export const approvalDecisionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/approval-decision"),
  approvalId: approvalRequestIdSchema,
  decision: approvalDecisionIntentSchema,
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

const toolStateEnvelopeShape = {
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/tool-state"),
  call: toolCallSchema,
};

export const pendingToolStateMessageSchema = z.strictObject({
  ...toolStateEnvelopeShape,
  status: z.literal("pending"),
});

export const runningToolStateMessageSchema = z.strictObject({
  ...toolStateEnvelopeShape,
  status: z.literal("running"),
});

export const successToolStateMessageSchema = z.strictObject({
  ...toolStateEnvelopeShape,
  status: z.literal("success"),
  result: toolSuccessResultSchema,
});

export const errorToolStateMessageSchema = z.strictObject({
  ...toolStateEnvelopeShape,
  status: z.literal("error"),
  result: toolErrorResultSchema,
});

export const toolStateMessageSchema = z.discriminatedUnion("status", [
  pendingToolStateMessageSchema,
  runningToolStateMessageSchema,
  successToolStateMessageSchema,
  errorToolStateMessageSchema,
]);

export const approvalStateMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/approval-state"),
  approval: approvalRequestSchema,
  status: approvalStatusSchema,
});

export const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  pingMessageSchema,
  submitMessageSchema,
  cancelMessageSchema,
  showApprovalDiffMessageSchema,
  approvalDecisionMessageSchema,
]);
export const extensionToWebviewMessageSchema = z.union([
  pongMessageSchema,
  textDeltaMessageSchema,
  runStatusMessageSchema,
  toolStateMessageSchema,
  approvalStateMessageSchema,
]);

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type CancelMessage = z.infer<typeof cancelMessageSchema>;
export type ShowApprovalDiffMessage = z.infer<typeof showApprovalDiffMessageSchema>;
export type ApprovalDecisionIntent = z.infer<typeof approvalDecisionIntentSchema>;
export type ApprovalDecisionMessage = z.infer<typeof approvalDecisionMessageSchema>;
export type TextDeltaMessage = z.infer<typeof textDeltaMessageSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStatusMessage = z.infer<typeof runStatusMessageSchema>;
export type ToolStateMessage = z.infer<typeof toolStateMessageSchema>;
export type ApprovalStateMessage = z.infer<typeof approvalStateMessageSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;
export type ExtensionToWebviewMessage = z.infer<typeof extensionToWebviewMessageSchema>;
