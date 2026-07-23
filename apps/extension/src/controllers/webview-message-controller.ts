import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";

import type { ChatRunner } from "./chat-runner.js";
import type { CheckpointActions } from "./checkpoint-actions.js";
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
        runMessages.start(data.requestId, data.content);
        return;
      case "webview/list-sessions":
        sessionMessages.list(data.requestId);
        return;
      case "webview/restore-session":
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
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}
