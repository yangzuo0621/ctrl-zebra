import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  extensionToWebviewMessageSchema,
  type McpPromptArgumentsDto,
  type McpResourceSelectionDto,
  protocolVersion,
  type WebviewToExtensionMessage,
} from "@ctrl-zebra/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let vscodeApi: VsCodeApi | undefined;

export interface WebviewHost {
  ping?(requestId: string): void;
  submit(requestId: string, content: string, sessionId?: string): void;
  regenerate?(requestId: string, sessionId: string, messageId: string): void;
  editMessage?(requestId: string, sessionId: string, messageId: string, content: string): void;
  newChat?(requestId: string): void;
  cancel(requestId: string): void;
  showApprovalDiff(requestId: string, approvalId: string): void;
  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void;
  listSessions(requestId: string): void;
  restoreSession(requestId: string, sessionId: string): void;
  deleteSession?(requestId: string, sessionId: string): void;
  clearSessions?(requestId: string): void;
  listCheckpoints(requestId: string): void;
  restoreCheckpoint(requestId: string, checkpointId: string): void;
  connectMcp?(requestId: string): void;
  disconnectMcp?(requestId: string): void;
  refreshMcpTools?(requestId: string, serverId: string, generation: number): void;
  openMcpSettings?(requestId: string): void;
  requestProviderStatus?(requestId: string): void;
  saveProviderKey?(requestId: string): void;
  selectProviderModel?(requestId: string): void;
  openProviderSettings?(requestId: string): void;
  openExternal?(requestId: string, href: string): void;
  refreshEditorContext?(
    requestId: string,
    viewGeneration: number,
    sessionGeneration: number,
    cardGeneration: number,
    contextId: string,
    scope: "selection" | "active-editor",
  ): void;
  removeEditorContext?(
    requestId: string,
    viewGeneration: number,
    sessionGeneration: number,
    cardGeneration: number,
    contextId: string,
  ): void;
  useStaleEditorContext?(
    requestId: string,
    viewGeneration: number,
    sessionGeneration: number,
    cardGeneration: number,
    contextId: string,
  ): void;
  searchWorkspaceFiles?(requestId: string, query: string): void;
  readWorkspaceFile?(requestId: string, path: string): void;
  removeWorkspaceFile?(requestId: string, referenceId: string): void;
  refreshWorkspaceFile?(requestId: string, referenceId: string): void;
  useStaleWorkspaceFile?(requestId: string, referenceId: string): void;
  readMcpResource?(
    requestId: string,
    serverId: string,
    generation: number,
    selection: McpResourceSelectionDto,
  ): void;
  attachMcpResource?(
    requestId: string,
    serverId: string,
    generation: number,
    snapshotId: string,
  ): void;
  detachMcpResource?(requestId: string, snapshotId: string): void;
  previewMcpPrompt?(
    requestId: string,
    serverId: string,
    generation: number,
    promptName: string,
    argumentsValue: McpPromptArgumentsDto,
  ): void;
  confirmMcpPrompt?(
    requestId: string,
    serverId: string,
    generation: number,
    previewId: string,
  ): void;
  cancelMcpPrompt?(
    requestId: string,
    serverId: string,
    generation: number,
    previewId: string,
  ): void;
  detachMcpPrompt?(requestId: string, previewId: string): void;
  subscribe(listener: (message: ExtensionToWebviewMessage) => void): () => void;
}

export function sendPing(requestId: string): void {
  getVsCodeApi().postMessage({
    protocolVersion,
    type: "webview/ping",
    requestId,
  });
}

function subscribe(listener: (message: ExtensionToWebviewMessage) => void): () => void {
  const handleMessage = (event: MessageEvent<unknown>) => {
    const result = extensionToWebviewMessageSchema.safeParse(event.data);

    if (result.success) {
      listener(result.data);
    }
  };

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}

const webviewHost: WebviewHost = {
  ping: sendPing,
  submit(requestId, content, sessionId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/submit",
      requestId,
      content,
      ...(sessionId === undefined ? {} : { sessionId }),
    });
  },
  regenerate(requestId, sessionId, messageId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/regenerate",
      requestId,
      sessionId,
      messageId,
    });
  },
  editMessage(requestId, sessionId, messageId, content) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/edit-message",
      requestId,
      sessionId,
      messageId,
      content,
    });
  },
  newChat(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/new-chat", requestId });
  },
  cancel(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/cancel",
      requestId,
    });
  },
  showApprovalDiff(requestId, approvalId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/show-approval-diff",
      requestId,
      approvalId,
    });
  },
  decideApproval(requestId, approvalId, decision) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/approval-decision",
      requestId,
      approvalId,
      decision,
    });
  },
  listSessions(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/list-sessions", requestId });
  },
  restoreSession(requestId, sessionId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/restore-session",
      requestId,
      sessionId,
    });
  },
  deleteSession(requestId, sessionId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/delete-session",
      requestId,
      sessionId,
    });
  },
  clearSessions(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/clear-sessions",
      requestId,
      confirm: true,
    });
  },
  listCheckpoints(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/list-checkpoints", requestId });
  },
  restoreCheckpoint(requestId, checkpointId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/restore-checkpoint",
      requestId,
      checkpointId,
    });
  },
  connectMcp(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/mcp-connect", requestId });
  },
  disconnectMcp(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/mcp-disconnect", requestId });
  },
  refreshMcpTools(requestId, serverId, generation) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-refresh-tools",
      requestId,
      serverId,
      generation,
    });
  },
  openMcpSettings(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/mcp-open-settings", requestId });
  },
  requestProviderStatus(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/provider-status",
      requestId,
    });
  },
  saveProviderKey(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/provider-save-key",
      requestId,
    });
  },
  selectProviderModel(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/provider-select-model",
      requestId,
    });
  },
  openProviderSettings(requestId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/provider-open-settings",
      requestId,
    });
  },
  openExternal(requestId, href) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/open-external-link",
      requestId,
      href,
    });
  },
  refreshEditorContext(
    requestId,
    viewGeneration,
    sessionGeneration,
    cardGeneration,
    contextId,
    scope,
  ) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/editor-context-refresh",
      requestId,
      viewGeneration,
      sessionGeneration,
      cardGeneration,
      contextId,
      scope,
    });
  },
  removeEditorContext(requestId, viewGeneration, sessionGeneration, cardGeneration, contextId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/editor-context-remove",
      requestId,
      viewGeneration,
      sessionGeneration,
      cardGeneration,
      contextId,
    });
  },
  useStaleEditorContext(requestId, viewGeneration, sessionGeneration, cardGeneration, contextId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/editor-context-use-stale",
      requestId,
      viewGeneration,
      sessionGeneration,
      cardGeneration,
      contextId,
    });
  },
  searchWorkspaceFiles(requestId, query) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/workspace-file-search",
      requestId,
      query,
    });
  },
  readWorkspaceFile(requestId, path) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/workspace-file-read",
      requestId,
      path,
    });
  },
  removeWorkspaceFile(requestId, referenceId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/workspace-file-remove",
      requestId,
      referenceId,
    });
  },
  refreshWorkspaceFile(requestId, referenceId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/workspace-file-refresh",
      requestId,
      referenceId,
    });
  },
  useStaleWorkspaceFile(requestId, referenceId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/workspace-file-use-stale",
      requestId,
      referenceId,
    });
  },
  readMcpResource(requestId, serverId, generation, selection) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-resource-read",
      requestId,
      serverId,
      generation,
      selection,
    });
  },
  attachMcpResource(requestId, serverId, generation, snapshotId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-resource-attach",
      requestId,
      serverId,
      generation,
      snapshotId,
    });
  },
  detachMcpResource(requestId, snapshotId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-resource-detach",
      requestId,
      snapshotId,
    });
  },
  previewMcpPrompt(requestId, serverId, generation, promptName, argumentsValue) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-prompt-preview",
      requestId,
      serverId,
      generation,
      promptName,
      arguments: argumentsValue,
    });
  },
  confirmMcpPrompt(requestId, serverId, generation, previewId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-prompt-confirm",
      requestId,
      serverId,
      generation,
      previewId,
    });
  },
  cancelMcpPrompt(requestId, serverId, generation, previewId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-prompt-cancel",
      requestId,
      serverId,
      generation,
      previewId,
    });
  },
  detachMcpPrompt(requestId, previewId) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/mcp-prompt-detach",
      requestId,
      previewId,
    });
  },
  subscribe,
};

function getVsCodeApi(): VsCodeApi {
  vscodeApi ??= acquireVsCodeApi();
  return vscodeApi;
}

export function getWebviewHost(): WebviewHost {
  return webviewHost;
}
