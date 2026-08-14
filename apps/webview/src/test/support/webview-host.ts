import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  protocolVersion,
  type WebviewToExtensionMessage,
} from "@ctrl-zebra/protocol";

import type { WebviewHost } from "../../vscode-api.js";

export interface WebviewHostFixture extends WebviewHost {
  readonly sent: WebviewToExtensionMessage[];
  emit(message: ExtensionToWebviewMessage): void;
}

export function createWebviewHostFixture(): WebviewHostFixture {
  return new TestWebviewHost();
}

class TestWebviewHost implements WebviewHostFixture {
  readonly sent: WebviewToExtensionMessage[] = [];
  readonly #listeners = new Set<(message: ExtensionToWebviewMessage) => void>();

  submit(requestId: string, content: string, sessionId?: string): void {
    this.sent.push({
      protocolVersion,
      type: "webview/submit",
      requestId,
      content,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  }

  regenerate(requestId: string, sessionId: string, messageId: string): void {
    this.sent.push({
      protocolVersion,
      type: "webview/regenerate",
      requestId,
      sessionId,
      messageId,
    });
  }

  newChat(requestId: string): void {
    this.sent.push({ protocolVersion, type: "webview/new-chat", requestId });
  }

  cancel(requestId: string): void {
    this.sent.push({ protocolVersion, type: "webview/cancel", requestId });
  }

  showApprovalDiff(requestId: string, approvalId: string): void {
    this.sent.push({
      protocolVersion,
      type: "webview/show-approval-diff",
      requestId,
      approvalId,
    });
  }

  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void {
    this.sent.push({
      protocolVersion,
      type: "webview/approval-decision",
      requestId,
      approvalId,
      decision,
    });
  }

  listSessions(requestId: string): void {
    this.sent.push({ protocolVersion, type: "webview/list-sessions", requestId });
  }

  restoreSession(requestId: string, sessionId: string): void {
    this.sent.push({ protocolVersion, type: "webview/restore-session", requestId, sessionId });
  }

  listCheckpoints(requestId: string): void {
    this.sent.push({ protocolVersion, type: "webview/list-checkpoints", requestId });
  }

  restoreCheckpoint(requestId: string, checkpointId: string): void {
    this.sent.push({
      protocolVersion,
      type: "webview/restore-checkpoint",
      requestId,
      checkpointId,
    });
  }

  refreshEditorContext(
    requestId: string,
    viewGeneration: number,
    sessionGeneration: number,
    cardGeneration: number,
    contextId: string,
    scope: "selection" | "active-editor",
  ): void {
    this.sent.push({
      protocolVersion,
      type: "webview/editor-context-refresh",
      requestId,
      viewGeneration,
      sessionGeneration,
      cardGeneration,
      contextId,
      scope,
    });
  }

  subscribe(listener: (message: ExtensionToWebviewMessage) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(message: ExtensionToWebviewMessage): void {
    for (const listener of this.#listeners) {
      listener(message);
    }
  }
}
