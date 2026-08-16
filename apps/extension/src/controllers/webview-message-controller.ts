import { McpPromptError, McpResourceError, McpToolDiscoveryError } from "@ctrl-zebra/mcp-client";
import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  isApprovedExternalLink,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";
import type { ChatRunner } from "./chat-runner.js";
import type { CheckpointActions } from "./checkpoint-actions.js";
import type { EditorContextWebviewActions } from "./editor-context-entry.js";
import { type McpPromptActions, McpPromptPreviewCancelledError } from "./mcp-prompt-actions.js";
import { type McpResourceActions, McpResourceReadCancelledError } from "./mcp-resource-actions.js";
import type { McpWebviewActions } from "./mcp-webview-actions.js";
import type { ProviderOnboardingController } from "./provider-onboarding-controller.js";
import type { SessionRecoveryActions } from "./session-recovery.js";
import { WebviewCheckpointMessageHandler } from "./webview-checkpoint-message-handler.js";
import { WebviewRunMessageHandler } from "./webview-run-message-handler.js";
import { WebviewSessionMessageHandler } from "./webview-session-message-handler.js";
import type { WorkspaceFileReferenceActions } from "./workspace-file-reference-actions.js";

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

function createPong(requestId: string): ExtensionToWebviewMessage {
  return {
    protocolVersion,
    type: "extension/pong",
    requestId,
  };
}

interface BindWebviewMessageControllerOptions {
  readonly channel: WebviewMessageChannel;
  readonly lifetime: WebviewViewLifetime;
  readonly reportDeliveryFailure?: () => void;
  readonly chatRunner: ChatRunner;
  readonly approvalActions?: ApprovalUiActions;
  readonly sessionActions?: SessionRecoveryActions;
  readonly checkpointActions?: CheckpointActions;
  readonly reportRunFailure?: (error: unknown) => void;
  readonly resourceActions?: McpResourceActions;
  readonly promptActions?: McpPromptActions;
  readonly mcpActions?: McpWebviewActions;
  readonly providerOnboarding?: ProviderOnboardingController;
  readonly openExternalLink?: (href: string) => void;
  readonly editorContextActions?: EditorContextWebviewActions;
  readonly workspaceFileActions?: WorkspaceFileReferenceActions;
}

export function bindWebviewMessageController({
  channel,
  lifetime,
  reportDeliveryFailure = () => {},
  chatRunner,
  approvalActions,
  sessionActions,
  checkpointActions,
  reportRunFailure = () => {},
  resourceActions,
  promptActions,
  mcpActions,
  providerOnboarding,
  openExternalLink,
  editorContextActions,
  workspaceFileActions,
}: BindWebviewMessageControllerOptions): void {
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
  const sessionMessages = new WebviewSessionMessageHandler(
    post,
    sessionActions,
    (sessionId) => runMessages.setOwnedSession(sessionId),
    (sessionId) => runMessages.cancelSession(sessionId),
    () => runMessages.cancelAllSessions(),
    (sessionId) => runMessages.clearOwnedSession(sessionId),
    () => runMessages.clearOwnedSession(),
    (sessionId) => runMessages.ownsSession(sessionId),
  );
  const checkpointMessages = new WebviewCheckpointMessageHandler(post, checkpointActions);
  mcpActions?.bind(post);
  workspaceFileActions?.bind(post);

  const messageSubscription = channel.onDidReceiveMessage((message) => {
    const result = webviewToExtensionMessageSchema.safeParse(message);
    if (!result.success) {
      return;
    }

    const data = result.data;
    switch (data.type) {
      case "webview/ping":
        post(createPong(data.requestId));
        mcpActions?.refresh(data.requestId);
        return;
      case "webview/provider-status":
        void providerOnboarding?.status(data.requestId, post).catch(reportRunFailure);
        return;
      case "webview/provider-save-key":
        void providerOnboarding?.action(data.requestId, "save-key", post).catch(reportRunFailure);
        return;
      case "webview/provider-select-model":
        void providerOnboarding
          ?.action(data.requestId, "select-model", post)
          .catch(reportRunFailure);
        return;
      case "webview/provider-open-settings":
        void providerOnboarding
          ?.action(data.requestId, "open-settings", post)
          .catch(reportRunFailure);
        return;
      case "webview/open-external-link":
        if (isApprovedExternalLink(data.href)) {
          openExternalLink?.(data.href);
        }
        return;
      case "webview/submit":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          runMessages.start(
            data.requestId,
            data.content,
            resourceActions?.takeAttachments(),
            promptActions?.takeConfirmations(),
            data.sessionId,
            workspaceFileActions?.takeReferences(),
          );
        }
        return;
      case "webview/regenerate":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          runMessages.regenerate(data.requestId, data.sessionId, data.messageId);
        }
        return;
      case "webview/edit-message":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          runMessages.edit(data.requestId, data.sessionId, data.messageId, data.content);
        }
        return;
      case "webview/new-chat":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          runMessages.clearOwnedSession();
          editorContextActions?.clearForNewChat();
          resourceActions?.clearInput();
          promptActions?.clearInput();
          workspaceFileActions?.clearInput();
        }
        return;
      case "webview/mcp-connect":
        void mcpActions?.connect(data.requestId).catch(reportRunFailure);
        return;
      case "webview/mcp-disconnect":
        resourceActions?.invalidateLiveState();
        promptActions?.invalidateLiveState();
        void mcpActions?.disconnect(data.requestId).catch(reportRunFailure);
        return;
      case "webview/mcp-open-settings":
        mcpActions?.openSettings();
        return;
      case "webview/mcp-refresh-tools":
        void mcpActions
          ?.refreshTools(data.requestId, data.serverId, data.generation)
          .catch((error: unknown) => {
            if (isMcpRefreshNoOp(error)) return;
            reportRunFailure(error);
          });
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
              previewId: data.previewId,
              confirmation,
            });
          }
        } catch (error) {
          postPromptError(post, data.requestId, error);
        }
        return;
      case "webview/mcp-prompt-detach":
        if (promptActions?.detach(data.previewId) === true) {
          post({
            protocolVersion,
            type: "extension/mcp-prompt-preview",
            requestId: data.requestId,
            status: "detached",
            previewId: data.previewId,
          });
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
      case "webview/mcp-resource-detach":
        if (resourceActions?.detach(data.snapshotId) === true) {
          post({
            protocolVersion,
            type: "extension/mcp-resource-preview",
            requestId: data.requestId,
            status: "detached",
            snapshotId: data.snapshotId,
          });
        }
        return;
      case "webview/list-sessions":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          sessionMessages.list(data.requestId);
        }
        return;
      case "webview/select-session":
        sessionMessages.select(data.requestId, data.sessionId);
        return;
      case "webview/restore-session":
        if (runMessages.canStart() && !sessionMessages.isRestoring()) {
          editorContextActions?.clearForSessionSwitch();
          resourceActions?.clearInput();
          promptActions?.clearInput();
          workspaceFileActions?.clearInput();
          sessionMessages.restore(data.requestId, data.sessionId);
        }
        return;
      case "webview/delete-session":
        if (!sessionMessages.isRestoring()) {
          editorContextActions?.clearForSessionSwitch();
          resourceActions?.clearInput();
          promptActions?.clearInput();
          workspaceFileActions?.clearInput();
          checkpointMessages.cancel();
          sessionMessages.delete(data.requestId, data.sessionId);
        }
        return;
      case "webview/clear-sessions":
        if (!sessionMessages.isRestoring()) {
          editorContextActions?.clearForSessionSwitch();
          resourceActions?.clearInput();
          promptActions?.clearInput();
          workspaceFileActions?.clearInput();
          checkpointMessages.cancel();
          sessionMessages.clear(data.requestId);
        }
        return;
      case "webview/list-checkpoints":
        if (!sessionMessages.isRestoring()) {
          checkpointMessages.list(data.requestId);
        }
        return;
      case "webview/restore-checkpoint":
        if (!sessionMessages.isRestoring()) {
          checkpointMessages.restore(data.requestId, data.checkpointId);
        }
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
      case "webview/editor-context-refresh":
        editorContextActions?.refresh(data);
        return;
      case "webview/editor-context-remove":
        editorContextActions?.remove(data);
        return;
      case "webview/editor-context-use-stale":
        editorContextActions?.useStale(data);
        return;
      case "webview/workspace-file-search":
        workspaceFileActions?.search(data.requestId, data.query);
        return;
      case "webview/workspace-file-read":
        workspaceFileActions?.read(data.requestId, data.path);
        return;
      case "webview/workspace-file-remove":
        workspaceFileActions?.remove(data.requestId, data.referenceId);
        return;
      case "webview/workspace-file-refresh":
        workspaceFileActions?.refresh(data.requestId, data.referenceId);
        return;
      case "webview/workspace-file-use-stale":
        workspaceFileActions?.useStale(data.requestId, data.referenceId);
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
    mcpActions?.dispose();
    editorContextActions?.dispose();
    workspaceFileActions?.dispose();
    providerOnboarding?.dispose();
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}

function isMcpRefreshNoOp(error: unknown): boolean {
  return (
    (error instanceof McpToolDiscoveryError && error.code === "disconnected") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

interface McpPreviewErrorConfig {
  readonly type: ExtensionToWebviewMessage["type"];
  readonly matchCode: (error: unknown) => string | undefined;
  readonly messages: Readonly<Record<string, string>>;
}

function postMcpPreviewError(
  post: (message: ExtensionToWebviewMessage) => void,
  requestId: string,
  error: unknown,
  { type, matchCode, messages }: McpPreviewErrorConfig,
): void {
  const code = matchCode(error) ?? "internal";
  post({
    protocolVersion,
    type,
    requestId,
    status: "error",
    code,
    message: messages[code] ?? messages.internal ?? "An unexpected error occurred.",
  } as ExtensionToWebviewMessage);
}

function postPromptError(
  post: (message: ExtensionToWebviewMessage) => void,
  requestId: string,
  error: unknown,
): void {
  postMcpPreviewError(post, requestId, error, {
    type: "extension/mcp-prompt-preview",
    matchCode: (e) =>
      e instanceof McpPromptError &&
      (e.code === "prompt-unavailable" ||
        e.code === "prompt-unsupported" ||
        e.code === "limit-exceeded")
        ? e.code
        : undefined,
    messages: {
      "prompt-unavailable": "The MCP Prompt is unavailable for the current connection.",
      "prompt-unsupported": "The MCP Prompt uses unsupported content.",
      "limit-exceeded": "The MCP Prompt exceeded a bounded content limit.",
      internal: "The MCP Prompt operation failed unexpectedly.",
    },
  });
}

function postResourceError(
  post: (message: ExtensionToWebviewMessage) => void,
  requestId: string,
  error: unknown,
): void {
  postMcpPreviewError(post, requestId, error, {
    type: "extension/mcp-resource-preview",
    matchCode: (e) =>
      e instanceof McpResourceError &&
      (e.code === "resource-unavailable" ||
        e.code === "resource-unsupported" ||
        e.code === "limit-exceeded")
        ? e.code
        : undefined,
    messages: {
      "resource-unavailable": "The MCP Resource is unavailable for the current connection.",
      "resource-unsupported": "The MCP Resource uses unsupported content.",
      "limit-exceeded": "The MCP Resource exceeded a bounded content limit.",
      internal: "The MCP Resource operation failed unexpectedly.",
    },
  });
}
