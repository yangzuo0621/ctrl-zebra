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
  newChat?(requestId: string): void;
  cancel(requestId: string): void;
  showApprovalDiff(requestId: string, approvalId: string): void;
  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void;
  listSessions(requestId: string): void;
  restoreSession(requestId: string, sessionId: string): void;
  listCheckpoints(requestId: string): void;
  restoreCheckpoint(requestId: string, checkpointId: string): void;
  connectMcp?(requestId: string): void;
  disconnectMcp?(requestId: string): void;
  openMcpSettings?(requestId: string): void;
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
  openMcpSettings(requestId) {
    getVsCodeApi().postMessage({ protocolVersion, type: "webview/mcp-open-settings", requestId });
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
