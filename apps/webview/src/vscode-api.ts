import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  extensionToWebviewMessageSchema,
  protocolVersion,
  type WebviewToExtensionMessage,
} from "@ctrl-zebra/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

let vscodeApi: VsCodeApi | undefined;

export interface WebviewHost {
  submit(requestId: string, content: string): void;
  cancel(requestId: string): void;
  showApprovalDiff(requestId: string, approvalId: string): void;
  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void;
  listSessions(requestId: string): void;
  restoreSession(requestId: string, sessionId: string): void;
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
  submit(requestId, content) {
    getVsCodeApi().postMessage({
      protocolVersion,
      type: "webview/submit",
      requestId,
      content,
    });
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
  subscribe,
};

function getVsCodeApi(): VsCodeApi {
  vscodeApi ??= acquireVsCodeApi();
  return vscodeApi;
}

export function getWebviewHost(): WebviewHost {
  return webviewHost;
}
