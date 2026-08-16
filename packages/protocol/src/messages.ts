import { z } from "zod";
import {
  approvalRequestIdSchema,
  approvalRequestSchema,
  approvalStatusSchema,
} from "./approval.js";
import { assistantMessageSchema, messageIdSchema, userMessageSchema } from "./chat-message.js";
import { checkpointIdSchema, checkpointSummarySchema } from "./checkpoint.js";
import { ideTextContextSchema } from "./ide-context.js";
import {
  mcpCatalogSequenceSchema,
  mcpConnectionProjectionSchema,
  mcpDiagnosticsProjectionSchema,
  mcpToolCatalogProjectionSchema,
  mcpToolCatalogSchema,
  toolStateSourceSchema,
} from "./mcp-connection.js";
import {
  mcpPromptArgumentsSchema,
  mcpPromptCatalogSchema,
  mcpPromptConfirmationSchema,
  mcpPromptNameSchema,
  mcpPromptPreviewIdSchema,
  mcpPromptPreviewSchema,
} from "./mcp-prompt.js";
import {
  mcpGenerationSchema,
  mcpResourceAttachmentSchema,
  mcpResourceCatalogSchema,
  mcpResourceSelectionSchema,
  mcpResourceSnapshotIdSchema,
  mcpResourceSnapshotSchema,
  mcpServerIdSchema,
} from "./mcp-resource.js";
import {
  reasoningBlockLimitDataSchema,
  reasoningBlockStartDataSchema,
  reasoningDeltaDataSchema,
  reasoningEndDataSchema,
  reasoningRunLimitDataSchema,
  restoredReasoningSchema,
} from "./reasoning.js";
import { sessionIdSchema, sessionStatusSchema, sessionSummarySchema } from "./session.js";
import { utf8ByteLength } from "./text-primitives.js";
import { toolCallSchema, toolErrorResultSchema, toolSuccessResultSchema } from "./tool.js";
import { tokenUsageSchema } from "./usage.js";
import {
  workspaceFileReadMessageSchema,
  workspaceFileReferenceMessageSchema,
  workspaceFileRefreshMessageSchema,
  workspaceFileRemoveMessageSchema,
  workspaceFileSearchMessageSchema,
  workspaceFileSearchResponseSchema,
  workspaceFileUseStaleMessageSchema,
} from "./workspace-file-reference.js";

export const protocolVersion = 1 as const;

const requestIdSchema = z.string().min(1).max(128);
const generationSchema = z.number().int().nonnegative().safe();
export const editorContextScopeSchema = z.enum(["selection", "active-editor"]);
const editorContextOpaqueIdSchema = z.string().min(1).max(128);
export const editorContextTransitionReasonSchema = z.enum([
  "editor-changed",
  "selection-changed",
  "document-changed",
]);
export const editorContextClearReasonSchema = z.enum([
  "disabled",
  "trust-lost",
  "workspace-changed",
  "editor-unavailable",
]);
export const editorContextUnavailableCodeSchema = z.enum([
  "disabled",
  "no-editor",
  "no-selection",
  "untrusted-workspace",
  "unsupported-document",
  "outside-workspace",
  "unavailable",
]);
const messageTypeSchema = z.string().regex(/^[^/]+\/[^/]+$/);
const submittedContentSchema = z
  .string()
  .min(1)
  .max(1_000_000)
  .refine((content) => content.trim().length > 0);

export const maxExternalLinkCharacters = 2_048;
const externalLinkSchemePattern = /^https?:\/\//iu;
export const externalLinkSchema = z
  .string()
  .min(1)
  .max(maxExternalLinkCharacters)
  .url()
  .refine((href) => externalLinkSchemePattern.test(href), {
    message: "Only HTTP and HTTPS external links are allowed.",
  })
  .refine((href) => !hasExternalLinkControlCharacters(href), {
    message: "External links must not contain control characters or spaces.",
  });

export function isApprovedExternalLink(href: string): boolean {
  return externalLinkSchema.safeParse(href).success;
}

function hasExternalLinkControlCharacters(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    if (codePoint <= 0x20 || codePoint === 0x7f) {
      return true;
    }
  }
  return false;
}

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

export const providerDisplayIdSchema = z.enum(["openai", "gemini", "openai-compatible"]);
export const providerActionSchema = z.enum(["save-key", "select-model", "open-settings"]);
export const providerActionErrorCodeSchema = z.enum([
  "configuration",
  "storage",
  "unavailable",
  "internal",
]);

export const providerStatusRequestMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/provider-status"),
});

export const providerSaveKeyMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/provider-save-key"),
});

export const providerSelectModelMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/provider-select-model"),
});

export const providerOpenSettingsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/provider-open-settings"),
});

export const openExternalLinkMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/open-external-link"),
  href: externalLinkSchema,
});

export const providerStatusMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/provider-status"),
  provider: providerDisplayIdSchema,
  apiKeyConfigured: z.boolean(),
  modelConfigured: z.boolean(),
});

export const providerActionMessageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/provider-action"),
    action: providerActionSchema,
    status: z.literal("completed"),
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/provider-action"),
    action: providerActionSchema,
    status: z.literal("cancelled"),
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/provider-action"),
    action: providerActionSchema,
    status: z.literal("failed"),
    code: providerActionErrorCodeSchema,
    message: z.string().min(1).max(256),
  }),
]);

export const submitMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/submit"),
  content: submittedContentSchema,
  sessionId: sessionIdSchema.optional(),
});

export const newChatMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/new-chat"),
});

export const cancelMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/cancel"),
});

/**
 * Regeneration is bound to the exact assistant projection the user reviewed. The Host
 * revalidates the Session and target against persisted history before allocating a new Run.
 */
export const regenerateMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/regenerate"),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
});

/**
 * Editing is bound to the exact persisted user projection the user reviewed. The Host
 * revalidates the Session, target, and edited content before allocating a fresh Run.
 */
export const editMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/edit-message"),
  sessionId: sessionIdSchema,
  messageId: messageIdSchema,
  content: submittedContentSchema,
});

export const editorContextRefreshMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/editor-context-refresh"),
  viewGeneration: generationSchema,
  sessionGeneration: generationSchema,
  cardGeneration: generationSchema,
  contextId: editorContextOpaqueIdSchema,
  scope: editorContextScopeSchema,
});

export const editorContextRemoveMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/editor-context-remove"),
  viewGeneration: generationSchema,
  sessionGeneration: generationSchema,
  cardGeneration: generationSchema,
  contextId: editorContextOpaqueIdSchema,
});

export const editorContextUseStaleMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/editor-context-use-stale"),
  viewGeneration: generationSchema,
  sessionGeneration: generationSchema,
  cardGeneration: generationSchema,
  contextId: editorContextOpaqueIdSchema,
});

const editorContextBaseMessageShape = {
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/editor-context"),
  viewGeneration: generationSchema,
  sessionGeneration: generationSchema,
  eventSequence: generationSchema,
};

export const editorContextMessageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...editorContextBaseMessageShape,
    status: z.literal("ready"),
    cardGeneration: generationSchema,
    captureId: editorContextOpaqueIdSchema,
    contextId: editorContextOpaqueIdSchema,
    scope: editorContextScopeSchema,
    context: ideTextContextSchema,
  }),
  z.strictObject({
    ...editorContextBaseMessageShape,
    status: z.literal("stale"),
    cardGeneration: generationSchema,
    captureId: editorContextOpaqueIdSchema,
    contextId: editorContextOpaqueIdSchema,
    scope: editorContextScopeSchema,
    reason: editorContextTransitionReasonSchema,
    context: ideTextContextSchema.refine((value) => value.source.stale, {
      message: "A stale editor context projection must mark its source stale.",
    }),
  }),
  z.strictObject({
    ...editorContextBaseMessageShape,
    status: z.literal("cleared"),
    cardGeneration: generationSchema,
    contextId: editorContextOpaqueIdSchema,
    reason: editorContextClearReasonSchema,
  }),
  z.strictObject({
    ...editorContextBaseMessageShape,
    status: z.literal("unavailable"),
    scope: editorContextScopeSchema.optional(),
    code: editorContextUnavailableCodeSchema,
  }),
]);

export const mcpConnectMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-connect"),
});
export const mcpDisconnectMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-disconnect"),
});
export const mcpOpenSettingsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-open-settings"),
});
export const mcpRefreshToolsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-refresh-tools"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
});
export const mcpConnectionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/mcp-connection"),
  connection: mcpConnectionProjectionSchema,
});
export const mcpToolsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/mcp-tools"),
  catalog: mcpToolCatalogSchema,
});
export const mcpToolCatalogMessageSchema = z
  .strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-tool-catalog"),
    catalogSequence: mcpCatalogSequenceSchema,
    catalog: mcpToolCatalogProjectionSchema,
  })
  .superRefine((message, context) => {
    if (utf8ByteLength(JSON.stringify(message)) > 1_048_576) {
      context.addIssue({
        code: "custom",
        message: "MCP Tool catalog envelope exceeds the serialized byte limit.",
      });
    }
  });

export const mcpDiagnosticsMessageSchema = z
  .strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-diagnostics"),
    diagnosticSequence: mcpCatalogSequenceSchema,
    diagnostic: mcpDiagnosticsProjectionSchema,
  })
  .superRefine((message, context) => {
    if (utf8ByteLength(JSON.stringify(message)) > 1_048_576) {
      context.addIssue({
        code: "custom",
        message: "MCP diagnostics envelope exceeds the serialized byte limit.",
      });
    }
  });

export const mcpResourceReadMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-resource-read"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
  selection: mcpResourceSelectionSchema,
});

export const mcpResourceAttachMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-resource-attach"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
  snapshotId: mcpResourceSnapshotIdSchema,
});
export const mcpResourceDetachMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-resource-detach"),
  snapshotId: mcpResourceSnapshotIdSchema,
});

export const mcpResourcesMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/mcp-resources"),
  catalog: mcpResourceCatalogSchema,
});

export const mcpResourcePreviewMessageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-resource-preview"),
    status: z.literal("ready"),
    snapshotId: mcpResourceSnapshotIdSchema,
    snapshot: mcpResourceSnapshotSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-resource-preview"),
    status: z.literal("attached"),
    attachment: mcpResourceAttachmentSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-resource-preview"),
    status: z.literal("detached"),
    snapshotId: mcpResourceSnapshotIdSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-resource-preview"),
    status: z.literal("error"),
    code: z.enum(["resource-unavailable", "resource-unsupported", "limit-exceeded", "internal"]),
    message: z.string().min(1).max(1_024),
  }),
]);

export const mcpPromptPreviewRequestMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-prompt-preview"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
  promptName: mcpPromptNameSchema,
  arguments: mcpPromptArgumentsSchema,
});
export const mcpPromptConfirmMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-prompt-confirm"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
  previewId: mcpPromptPreviewIdSchema,
});
export const mcpPromptCancelMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-prompt-cancel"),
  serverId: mcpServerIdSchema,
  generation: mcpGenerationSchema,
  previewId: mcpPromptPreviewIdSchema,
});
export const mcpPromptDetachMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/mcp-prompt-detach"),
  previewId: mcpPromptPreviewIdSchema,
});
export const mcpPromptsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/mcp-prompts"),
  catalog: mcpPromptCatalogSchema,
});
export const mcpPromptPreviewMessageSchema = z.discriminatedUnion("status", [
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-prompt-preview"),
    status: z.literal("ready"),
    preview: mcpPromptPreviewSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-prompt-preview"),
    status: z.literal("confirmed"),
    previewId: mcpPromptPreviewIdSchema,
    confirmation: mcpPromptConfirmationSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-prompt-preview"),
    status: z.literal("detached"),
    previewId: mcpPromptPreviewIdSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-prompt-preview"),
    status: z.literal("cancelled"),
    previewId: mcpPromptPreviewIdSchema,
  }),
  z.strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/mcp-prompt-preview"),
    status: z.literal("error"),
    code: z.enum(["prompt-unavailable", "prompt-unsupported", "limit-exceeded", "internal"]),
    message: z.string().min(1).max(1_024),
  }),
]);

export const listSessionsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/list-sessions"),
});

export const selectSessionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/select-session"),
  sessionId: sessionIdSchema.optional(),
});

export const restoreSessionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/restore-session"),
  sessionId: sessionIdSchema,
});

export const deleteSessionMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/delete-session"),
  sessionId: sessionIdSchema,
});

export const clearSessionsMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/clear-sessions"),
  confirm: z.literal(true),
});

export const localDataClearCategorySchema = z.enum([
  "running-operations",
  "sessions",
  "checkpoints",
  "temporary-files",
  "caches",
  "provider-secret",
  "provider-configuration",
  "mcp-configuration",
  "other-local-state",
]);

export const localDataClearCategoryResultSchema = z.strictObject({
  category: localDataClearCategorySchema,
  outcome: z.enum(["cleared", "failed"]),
  deleted: z.number().int().nonnegative().max(10_000),
  failed: z.number().int().nonnegative().max(10_000),
});

const localDataClearCategoryResultsSchema = z
  .array(localDataClearCategoryResultSchema)
  .max(9)
  .refine(
    (categories) => new Set(categories.map(({ category }) => category)).size === categories.length,
    "Each local-data clear category may appear at most once.",
  );

export const clearLocalDataMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("webview/clear-local-data"),
  confirm: z.literal(true),
});

export const localDataClearResultMessageSchema = z
  .strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/local-data-clear-result"),
    outcome: z.enum(["completed", "partial", "cancelled"]),
    categories: localDataClearCategoryResultsSchema,
    message: z.string().min(1).max(256),
  })
  .refine(({ outcome, categories }) => outcome !== "cancelled" || categories.length === 0, {
    path: ["categories"],
    message: "Cancelled local-data clear results must not contain category results.",
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

export const tokenUsageMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/token-usage"),
  usage: tokenUsageSchema,
});

export const reasoningStartMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/reasoning-start"),
  ...reasoningBlockStartDataSchema.shape,
});

export const reasoningDeltaMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/reasoning-delta"),
  ...reasoningDeltaDataSchema.shape,
});

export const reasoningEndMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/reasoning-end"),
  ...reasoningEndDataSchema.shape,
});

export const reasoningBlockLimitMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/reasoning-limit"),
  ...reasoningBlockLimitDataSchema.shape,
});

export const reasoningRunLimitMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/reasoning-limit"),
  ...reasoningRunLimitDataSchema.shape,
});

export const reasoningLimitMessageSchema = z.discriminatedUnion("scope", [
  reasoningBlockLimitMessageSchema,
  reasoningRunLimitMessageSchema,
]);

export const reasoningRestoredMessageSchema = z
  .strictObject({
    ...protocolEnvelopeSchema.shape,
    type: z.literal("extension/reasoning-restored"),
    ...restoredReasoningSchema.shape,
  })
  .superRefine(({ sessionId, blocks, runTruncated }, context) => {
    if (!restoredReasoningSchema.safeParse({ sessionId, blocks, runTruncated }).success) {
      context.addIssue({
        code: "custom",
        message: "Restored reasoning must satisfy the bounded display projection schema.",
      });
    }
  });

export const runStatusSchema = z.enum([
  "preparing",
  "streaming",
  "completed",
  "truncated",
  "cancelled",
  "failed",
]);

export const runStatusMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/run-status"),
  status: runStatusSchema,
});

export const sessionStartedMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-started"),
  sessionId: sessionIdSchema,
});

export const runErrorCodeSchema = z.enum([
  "configuration",
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
  source: toolStateSourceSchema,
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
  usage: tokenUsageSchema.optional(),
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

export const sessionDeletedMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-deleted"),
  sessionId: sessionIdSchema,
});

export const sessionsClearedMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/sessions-cleared"),
  deletedCount: z.number().int().nonnegative().max(10_000),
});

export const sessionDeletionErrorMessageSchema = z.strictObject({
  ...protocolEnvelopeSchema.shape,
  type: z.literal("extension/session-deletion-error"),
  code: z.enum(["not-found", "partial", "unavailable"]),
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
  newChatMessageSchema,
  cancelMessageSchema,
  regenerateMessageSchema,
  editMessageSchema,
  editorContextRefreshMessageSchema,
  editorContextRemoveMessageSchema,
  editorContextUseStaleMessageSchema,
  workspaceFileSearchMessageSchema,
  workspaceFileReadMessageSchema,
  workspaceFileRemoveMessageSchema,
  workspaceFileRefreshMessageSchema,
  workspaceFileUseStaleMessageSchema,
  providerStatusRequestMessageSchema,
  providerSaveKeyMessageSchema,
  providerSelectModelMessageSchema,
  providerOpenSettingsMessageSchema,
  openExternalLinkMessageSchema,
  mcpConnectMessageSchema,
  mcpDisconnectMessageSchema,
  mcpOpenSettingsMessageSchema,
  mcpRefreshToolsMessageSchema,
  mcpResourceReadMessageSchema,
  mcpResourceAttachMessageSchema,
  mcpResourceDetachMessageSchema,
  mcpPromptPreviewRequestMessageSchema,
  mcpPromptConfirmMessageSchema,
  mcpPromptCancelMessageSchema,
  mcpPromptDetachMessageSchema,
  showApprovalDiffMessageSchema,
  approvalDecisionMessageSchema,
  listSessionsMessageSchema,
  selectSessionMessageSchema,
  restoreSessionMessageSchema,
  deleteSessionMessageSchema,
  clearSessionsMessageSchema,
  clearLocalDataMessageSchema,
  listCheckpointsMessageSchema,
  restoreCheckpointMessageSchema,
]);
export const extensionToWebviewMessageSchema = z.union([
  pongMessageSchema,
  providerStatusMessageSchema,
  providerActionMessageSchema,
  textDeltaMessageSchema,
  tokenUsageMessageSchema,
  reasoningStartMessageSchema,
  reasoningDeltaMessageSchema,
  reasoningEndMessageSchema,
  reasoningLimitMessageSchema,
  reasoningRestoredMessageSchema,
  sessionStartedMessageSchema,
  runStatusMessageSchema,
  runErrorMessageSchema,
  toolStateMessageSchema,
  approvalStateMessageSchema,
  sessionListMessageSchema,
  sessionRestoredMessageSchema,
  sessionErrorMessageSchema,
  sessionDeletedMessageSchema,
  sessionsClearedMessageSchema,
  sessionDeletionErrorMessageSchema,
  localDataClearResultMessageSchema,
  checkpointListMessageSchema,
  checkpointRestoredMessageSchema,
  checkpointErrorMessageSchema,
  editorContextMessageSchema,
  workspaceFileSearchResponseSchema,
  workspaceFileReferenceMessageSchema,
  mcpConnectionMessageSchema,
  mcpToolsMessageSchema,
  mcpToolCatalogMessageSchema,
  mcpDiagnosticsMessageSchema,
  mcpResourcesMessageSchema,
  mcpResourcePreviewMessageSchema,
  mcpPromptsMessageSchema,
  mcpPromptPreviewMessageSchema,
]);

export type ProtocolEnvelope = z.infer<typeof protocolEnvelopeSchema>;
export type PingMessage = z.infer<typeof pingMessageSchema>;
export type PongMessage = z.infer<typeof pongMessageSchema>;
export type ProviderDisplayId = z.infer<typeof providerDisplayIdSchema>;
export type ProviderAction = z.infer<typeof providerActionSchema>;
export type ProviderActionErrorCode = z.infer<typeof providerActionErrorCodeSchema>;
export type ProviderStatusRequestMessage = z.infer<typeof providerStatusRequestMessageSchema>;
export type OpenExternalLinkMessage = z.infer<typeof openExternalLinkMessageSchema>;
export type ProviderSaveKeyMessage = z.infer<typeof providerSaveKeyMessageSchema>;
export type ProviderSelectModelMessage = z.infer<typeof providerSelectModelMessageSchema>;
export type ProviderOpenSettingsMessage = z.infer<typeof providerOpenSettingsMessageSchema>;
export type ProviderStatusMessage = z.infer<typeof providerStatusMessageSchema>;
export type ProviderActionMessage = z.infer<typeof providerActionMessageSchema>;
export type SubmitMessage = z.infer<typeof submitMessageSchema>;
export type NewChatMessage = z.infer<typeof newChatMessageSchema>;
export type CancelMessage = z.infer<typeof cancelMessageSchema>;
export type RegenerateMessage = z.infer<typeof regenerateMessageSchema>;
export type EditMessage = z.infer<typeof editMessageSchema>;
export type EditorContextRefreshMessage = z.infer<typeof editorContextRefreshMessageSchema>;
export type EditorContextRemoveMessage = z.infer<typeof editorContextRemoveMessageSchema>;
export type EditorContextUseStaleMessage = z.infer<typeof editorContextUseStaleMessageSchema>;
export type EditorContextMessage = z.infer<typeof editorContextMessageSchema>;
export type EditorContextScope = z.infer<typeof editorContextScopeSchema>;
export type EditorContextTransitionReason = z.infer<typeof editorContextTransitionReasonSchema>;
export type EditorContextClearReason = z.infer<typeof editorContextClearReasonSchema>;
export type EditorContextUnavailableCode = z.infer<typeof editorContextUnavailableCodeSchema>;
export type WorkspaceFileSearchMessage = z.infer<typeof workspaceFileSearchMessageSchema>;
export type WorkspaceFileReadMessage = z.infer<typeof workspaceFileReadMessageSchema>;
export type WorkspaceFileRemoveMessage = z.infer<typeof workspaceFileRemoveMessageSchema>;
export type WorkspaceFileRefreshMessage = z.infer<typeof workspaceFileRefreshMessageSchema>;
export type WorkspaceFileUseStaleMessage = z.infer<typeof workspaceFileUseStaleMessageSchema>;
export type WorkspaceFileSearchResponse = z.infer<typeof workspaceFileSearchResponseSchema>;
export type WorkspaceFileReferenceMessage = z.infer<typeof workspaceFileReferenceMessageSchema>;
export type McpConnectMessage = z.infer<typeof mcpConnectMessageSchema>;
export type McpDisconnectMessage = z.infer<typeof mcpDisconnectMessageSchema>;
export type McpOpenSettingsMessage = z.infer<typeof mcpOpenSettingsMessageSchema>;
export type McpRefreshToolsMessage = z.infer<typeof mcpRefreshToolsMessageSchema>;
export type McpConnectionMessage = z.infer<typeof mcpConnectionMessageSchema>;
export type McpToolsMessage = z.infer<typeof mcpToolsMessageSchema>;
export type McpToolCatalogMessage = z.infer<typeof mcpToolCatalogMessageSchema>;
export type McpDiagnosticsMessage = z.infer<typeof mcpDiagnosticsMessageSchema>;
export type McpResourceReadMessage = z.infer<typeof mcpResourceReadMessageSchema>;
export type McpResourceAttachMessage = z.infer<typeof mcpResourceAttachMessageSchema>;
export type McpResourceDetachMessage = z.infer<typeof mcpResourceDetachMessageSchema>;
export type McpResourcesMessage = z.infer<typeof mcpResourcesMessageSchema>;
export type McpResourcePreviewMessage = z.infer<typeof mcpResourcePreviewMessageSchema>;
export type McpPromptPreviewRequestMessage = z.infer<typeof mcpPromptPreviewRequestMessageSchema>;
export type McpPromptConfirmMessage = z.infer<typeof mcpPromptConfirmMessageSchema>;
export type McpPromptCancelMessage = z.infer<typeof mcpPromptCancelMessageSchema>;
export type McpPromptDetachMessage = z.infer<typeof mcpPromptDetachMessageSchema>;
export type McpPromptsMessage = z.infer<typeof mcpPromptsMessageSchema>;
export type McpPromptPreviewMessage = z.infer<typeof mcpPromptPreviewMessageSchema>;
export type ListSessionsMessage = z.infer<typeof listSessionsMessageSchema>;
export type SelectSessionMessage = z.infer<typeof selectSessionMessageSchema>;
export type RestoreSessionMessage = z.infer<typeof restoreSessionMessageSchema>;
export type DeleteSessionMessage = z.infer<typeof deleteSessionMessageSchema>;
export type ClearSessionsMessage = z.infer<typeof clearSessionsMessageSchema>;
export type LocalDataClearCategory = z.infer<typeof localDataClearCategorySchema>;
export type LocalDataClearCategoryResult = z.infer<typeof localDataClearCategoryResultSchema>;
export type ClearLocalDataMessage = z.infer<typeof clearLocalDataMessageSchema>;
export type LocalDataClearResultMessage = z.infer<typeof localDataClearResultMessageSchema>;
export type ListCheckpointsMessage = z.infer<typeof listCheckpointsMessageSchema>;
export type RestoreCheckpointMessage = z.infer<typeof restoreCheckpointMessageSchema>;
export type ShowApprovalDiffMessage = z.infer<typeof showApprovalDiffMessageSchema>;
export type ApprovalDecisionIntent = z.infer<typeof approvalDecisionIntentSchema>;
export type ApprovalDecisionMessage = z.infer<typeof approvalDecisionMessageSchema>;
export type TextDeltaMessage = z.infer<typeof textDeltaMessageSchema>;
export type TokenUsageMessage = z.infer<typeof tokenUsageMessageSchema>;
export type ReasoningStartMessage = z.infer<typeof reasoningStartMessageSchema>;
export type ReasoningDeltaMessage = z.infer<typeof reasoningDeltaMessageSchema>;
export type ReasoningEndMessage = z.infer<typeof reasoningEndMessageSchema>;
export type ReasoningLimitMessage = z.infer<typeof reasoningLimitMessageSchema>;
export type ReasoningRestoredMessage = z.infer<typeof reasoningRestoredMessageSchema>;
export type SessionStartedMessage = z.infer<typeof sessionStartedMessageSchema>;
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
export type SessionDeletedMessage = z.infer<typeof sessionDeletedMessageSchema>;
export type SessionsClearedMessage = z.infer<typeof sessionsClearedMessageSchema>;
export type SessionDeletionErrorMessage = z.infer<typeof sessionDeletionErrorMessageSchema>;
export type CheckpointListMessage = z.infer<typeof checkpointListMessageSchema>;
export type CheckpointRestoredMessage = z.infer<typeof checkpointRestoredMessageSchema>;
export type CheckpointErrorMessage = z.infer<typeof checkpointErrorMessageSchema>;
export type WebviewToExtensionMessage = z.infer<typeof webviewToExtensionMessageSchema>;

export type ExtensionToWebviewMessage = z.infer<typeof extensionToWebviewMessageSchema>;
