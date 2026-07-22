import { z } from "zod";

import {
  approvalRequestIdSchema,
  approvalRequestSchema,
  approvalStatusSchema,
} from "./approval.js";
import { assistantMessageSchema, userMessageSchema } from "./chat-message.js";
import { checkpointIdSchema, checkpointSummarySchema } from "./checkpoint.js";
import { sessionIdSchema, sessionStatusSchema, sessionSummarySchema } from "./session.js";
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

export const listSessionsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/list-sessions"),
});

export const restoreSessionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/restore-session"),
  sessionId: sessionIdSchema,
});

export const listCheckpointsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/list-checkpoints"),
});

export const restoreCheckpointMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/restore-checkpoint"),
  checkpointId: checkpointIdSchema,
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

export const runErrorCodeSchema = z.enum([
  "authentication",
  "network",
  "rate-limit",
  "context",
  "tool",
  "internal",
]);

export const runErrorMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/run-error"),
  code: runErrorCodeSchema,
  message: z.string().min(1).max(256),
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

export const sessionListMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-list"),
  sessions: z.array(sessionSummarySchema).max(10_000),
});

export const restoredSessionSchema = z.strictObject({
  sessionId: sessionIdSchema,
  status: sessionStatusSchema,
  messages: z.array(z.union([userMessageSchema, assistantMessageSchema])).max(10_000),
  eventLogTailDamaged: z.boolean(),
});

export const sessionRestoredMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-restored"),
  session: restoredSessionSchema,
});

export const sessionErrorMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-error"),
  code: z.enum(["not-found", "corrupt", "unavailable"]),
  message: z.string().min(1).max(256),
});

export const checkpointListMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/checkpoint-list"),
  checkpoints: z.array(checkpointSummarySchema).max(10_000),
});

export const checkpointRestoredMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/checkpoint-restored"),
  checkpointId: checkpointIdSchema,
});

export const checkpointErrorMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/checkpoint-error"),
  code: z.enum(["not-found", "conflict", "unavailable"]),
  message: z.string().min(1).max(256),
});

export const webviewToExtensionMessageSchema = z.discriminatedUnion("type", [
  pingMessageSchema,
  submitMessageSchema,
  cancelMessageSchema,
  showApprovalDiffMessageSchema,
  approvalDecisionMessageSchema,
  listSessionsMessageSchema,
  restoreSessionMessageSchema,
  listCheckpointsMessageSchema,
  restoreCheckpointMessageSchema,
]);
export const extensionToWebviewMessageSchema = z.union([
  pongMessageSchema,
  textDeltaMessageSchema,
  runStatusMessageSchema,
  runErrorMessageSchema,
  toolStateMessageSchema,
  approvalStateMessageSchema,
  sessionListMessageSchema,
  sessionRestoredMessageSchema,
  sessionErrorMessageSchema,
  checkpointListMessageSchema,
  checkpointRestoredMessageSchema,
  checkpointErrorMessageSchema,
]);

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type CancelMessage = z.infer<typeof cancelMessageSchema>;
export type ListSessionsMessage = z.infer<typeof listSessionsMessageSchema>;
export type RestoreSessionMessage = z.infer<typeof restoreSessionMessageSchema>;
export type ListCheckpointsMessage = z.infer<typeof listCheckpointsMessageSchema>;
export type RestoreCheckpointMessage = z.infer<typeof restoreCheckpointMessageSchema>;
export type ShowApprovalDiffMessage = z.infer<typeof showApprovalDiffMessageSchema>;
export type ApprovalDecisionIntent = z.infer<typeof approvalDecisionIntentSchema>;
export type ApprovalDecisionMessage = z.infer<typeof approvalDecisionMessageSchema>;
export type TextDeltaMessage = z.infer<typeof textDeltaMessageSchema>;
export type RunStatus = z.infer<typeof runStatusSchema>;
export type RunStatusMessage = z.infer<typeof runStatusMessageSchema>;
export type RunErrorCode = z.infer<typeof runErrorCodeSchema>;
export type RunErrorMessage = z.infer<typeof runErrorMessageSchema>;
export type ToolStateMessage = z.infer<typeof toolStateMessageSchema>;
export type ApprovalStateMessage = z.infer<typeof approvalStateMessageSchema>;
export type SessionListMessage = z.infer<typeof sessionListMessageSchema>;
export type RestoredSession = z.infer<typeof restoredSessionSchema>;
export type SessionRestoredMessage = z.infer<typeof sessionRestoredMessageSchema>;
export type SessionErrorMessage = z.infer<typeof sessionErrorMessageSchema>;
export type CheckpointListMessage = z.infer<typeof checkpointListMessageSchema>;
export type CheckpointRestoredMessage = z.infer<typeof checkpointRestoredMessageSchema>;
export type CheckpointErrorMessage = z.infer<typeof checkpointErrorMessageSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;
export type ExtensionToWebviewMessage = z.infer<typeof extensionToWebviewMessageSchema>;
