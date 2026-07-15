import {
  extensionToWebviewMessageSchema,
  type PongMessage,
  protocolVersion,
  type WebviewToExtensionMessage,
} from "@ctrl-zebra/protocol";

interface VsCodeApi {
  postMessage(message: WebviewToExtensionMessage): void;
}

declare function acquireVsCodeApi(): VsCodeApi;

const vscodeApi = acquireVsCodeApi();

export function sendPing(requestId: string): void {
  vscodeApi.postMessage({
    protocolVersion,
    type: "webview/ping",
    requestId,
  });
}

export function subscribeToPong(listener: (message: PongMessage) => void): () => void {
  const handleMessage = (event: MessageEvent<unknown>) => {
    const result = extensionToWebviewMessageSchema.safeParse(event.data);

    if (result.success) {
      listener(result.data);
    }
  };

  window.addEventListener("message", handleMessage);
  return () => window.removeEventListener("message", handleMessage);
}
