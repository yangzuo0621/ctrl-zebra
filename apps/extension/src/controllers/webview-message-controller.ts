import { McpPromptError, McpResourceError } from "@ctrl-zebra/mcp-client";
import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";
import type { ChatRunner } from "./chat-runner.js";
import type { CheckpointActions } from "./checkpoint-actions.js";
import { type McpPromptActions, McpPromptPreviewCancelledError } from "./mcp-prompt-actions.js";
import { type McpResourceActions, McpResourceReadCancelledError } from "./mcp-resource-actions.js";
import type { SessionRecoveryActions } from "./session-recovery.js";
import { WebviewCheckpointMessageHandler } from "./webview-checkpoint-message-handler.js";
import { WebviewRunMessageHandler } from "./webview-run-message-handler.js";
import { WebviewSessionMessageHandler } from "./webview-session-message-handler.js";

interface DisposableResource {
  dispose(): void;
}

interface WebviewMessageChannel {
  onDidReceiveMessage(listener: (message: unknown) => void): DisposableResource;
  postMessage(message: ExtensionToWebviewMessage): PromiseLike<boolean>;
}

interface WebviewViewLifetime {
  onDidDispose(listener: () => void): DisposableResource;
}

export interface ApprovalUiActions {
  showDiff(requestId: string, approvalId: string): void;
  decide(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void;
}

export function handleWebviewMessage(message: unknown): ExtensionToWebviewMessage | undefined {
  const result = webviewToExtensionMessageSchema.safeParse(message);

  if (!result.success) {
    return undefined;
  }

  return createPong(result.data.requestId);
}

function createPong(requestId: string): ExtensionToWebviewMessage {
  return {
    protocolVersion,
    type: "extension/pong",
    requestId,
  };
}

export function bindWebviewMessageController(
  channel: WebviewMessageChannel,
  lifetime: WebviewViewLifetime,
  reportDeliveryFailure: () => void,
  chatRunner: ChatRunner,
  approvalActions?: ApprovalUiActions,
  sessionActions?: SessionRecoveryActions,
  checkpointActions?: CheckpointActions,
  reportRunFailure: (error: unknown) => void = () => {},
  resourceActions?: McpResourceActions,
  promptActions?: McpPromptActions,
): void {
  let disposed = false;
  const post = (message: ExtensionToWebviewMessage) => {
    if (disposed) {
      return;
    }

    void channel.postMessage(message).then((delivered) => {
      if (!delivered) {
        reportDeliveryFailure();
      }
    }, reportDeliveryFailure);
  };
  const runMessages = new WebviewRunMessageHandler(
    post,
    chatRunner,
    approvalActions,
    reportRunFailure,
  );
  const sessionMessages = new WebviewSessionMessageHandler(post, sessionActions);
  const checkpointMessages = new WebviewCheckpointMessageHandler(post, checkpointActions);

  const messageSubscription = channel.onDidReceiveMessage((message) => {
    const result = webviewToExtensionMessageSchema.safeParse(message);
    if (!result.success) {
      return;
    }

    const data = result.data;
    switch (data.type) {
      case "webview/ping":
        post(createPong(data.requestId));
        return;
      case "webview/submit":
        if (runMessages.canStart()) {
          runMessages.start(
            data.requestId,
            data.content,
            resourceActions?.takeAttachments(),
            promptActions?.takeConfirmations(),
          );
        }
        return;
      case "webview/mcp-prompt-preview":
        void promptActions
          ?.preview(data.serverId, data.generation, data.promptName, data.arguments)
          .then((preview) => {
            post({
              protocolVersion,
              type: "extension/mcp-prompt-preview",
              requestId: data.requestId,
              status: "ready",
              preview,
            });
          })
          .catch((error: unknown) => {
            if (error instanceof McpPromptPreviewCancelledError) return;
            postPromptError(post, data.requestId, error);
          });
        return;
      case "webview/mcp-prompt-confirm":
        try {
          const confirmation = promptActions?.confirm(
            data.serverId,
            data.generation,
            data.previewId,
          );
          if (confirmation !== undefined) {
            post({
              protocolVersion,
              type: "extension/mcp-prompt-preview",
              requestId: data.requestId,
              status: "confirmed",
              confirmation,
            });
          }
        } catch (error) {
          postPromptError(post, data.requestId, error);
        }
        return;
      case "webview/mcp-prompt-cancel":
        if (promptActions?.cancel(data.serverId, data.generation, data.previewId) === true) {
          post({
            protocolVersion,
            type: "extension/mcp-prompt-preview",
            requestId: data.requestId,
            status: "cancelled",
            previewId: data.previewId,
          });
        }
        return;
      case "webview/mcp-resource-read":
        void resourceActions
          ?.read(data.serverId, data.generation, data.selection)
          .then(({ snapshotId, snapshot }) => {
            post({
              protocolVersion,
              type: "extension/mcp-resource-preview",
              requestId: data.requestId,
              status: "ready",
              snapshotId,
              snapshot,
            });
          })
          .catch((error: unknown) => {
            if (error instanceof McpResourceReadCancelledError) {
              return;
            }
            postResourceError(post, data.requestId, error);
          });
        return;
      case "webview/mcp-resource-attach":
        try {
          const attachment = resourceActions?.attach(
            data.serverId,
            data.generation,
            data.snapshotId,
          );
          if (attachment !== undefined) {
            post({
              protocolVersion,
              type: "extension/mcp-resource-preview",
              requestId: data.requestId,
              status: "attached",
              attachment,
            });
          }
        } catch (error) {
          postResourceError(post, data.requestId, error);
        }
        return;
      case "webview/list-sessions":
        sessionMessages.list(data.requestId);
        return;
      case "webview/restore-session":
        promptActions?.clearInput();
        sessionMessages.restore(data.requestId, data.sessionId);
        return;
      case "webview/list-checkpoints":
        checkpointMessages.list(data.requestId);
        return;
      case "webview/restore-checkpoint":
        checkpointMessages.restore(data.requestId, data.checkpointId);
        return;
      case "webview/show-approval-diff":
        runMessages.showApprovalDiff(data.requestId, data.approvalId);
        return;
      case "webview/approval-decision":
        runMessages.decideApproval(data.requestId, data.approvalId, data.decision);
        return;
      case "webview/cancel":
        runMessages.cancel(data.requestId);
        return;
    }
  });
  let disposalSubscription: DisposableResource | undefined;
  disposalSubscription = lifetime.onDidDispose(() => {
    disposed = true;
    runMessages.dispose();
    checkpointMessages.dispose();
    resourceActions?.dispose();
    promptActions?.dispose();
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}

function postPromptError(
  post: (message: ExtensionToWebviewMessage) => void,
  requestId: string,
  error: unknown,
): void {
  const code =
    error instanceof McpPromptError &&
    (error.code === "prompt-unavailable" ||
      error.code === "prompt-unsupported" ||
      error.code === "limit-exceeded")
      ? error.code
      : "internal";
  const messages = {
    "prompt-unavailable": "The MCP Prompt is unavailable for the current connection.",
    "prompt-unsupported": "The MCP Prompt uses unsupported content.",
    "limit-exceeded": "The MCP Prompt exceeded a bounded content limit.",
    internal: "The MCP Prompt operation failed unexpectedly.",
  } as const;
  post({
    protocolVersion,
    type: "extension/mcp-prompt-preview",
    requestId,
    status: "error",
    code,
    message: messages[code],
  });
}

function postResourceError(
  post: (message: ExtensionToWebviewMessage) => void,
  requestId: string,
  error: unknown,
): void {
  const code =
    error instanceof McpResourceError &&
    (error.code === "resource-unavailable" ||
      error.code === "resource-unsupported" ||
      error.code === "limit-exceeded")
      ? error.code
      : "internal";
  const messages = {
    "resource-unavailable": "The MCP Resource is unavailable for the current connection.",
    "resource-unsupported": "The MCP Resource uses unsupported content.",
    "limit-exceeded": "The MCP Resource exceeded a bounded content limit.",
    internal: "The MCP Resource operation failed unexpectedly.",
  } as const;
  post({
    protocolVersion,
    type: "extension/mcp-resource-preview",
    requestId,
    status: "error",
    code,
    message: messages[code],
  });
}
