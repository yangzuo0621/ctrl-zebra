import {
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
  subscribe,
};

function getVsCodeApi(): VsCodeApi {
  vscodeApi ??= acquireVsCodeApi();
  return vscodeApi;
}

export function getWebviewHost(): WebviewHost {
  return webviewHost;
}
