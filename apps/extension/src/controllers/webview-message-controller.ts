import {
  type ExtensionToWebviewMessage,
  protocolVersion,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";

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

export function handleWebviewMessage(message: unknown): ExtensionToWebviewMessage | undefined {
  const result = webviewToExtensionMessageSchema.safeParse(message);

  if (!result.success) {
    return undefined;
  }

  return {
    protocolVersion,
    type: "extension/pong",
    requestId: result.data.requestId,
  };
}

export function bindWebviewMessageController(
  channel: WebviewMessageChannel,
  lifetime: WebviewViewLifetime,
  reportDeliveryFailure: () => void,
): void {
  const messageSubscription = channel.onDidReceiveMessage((message) => {
    const response = handleWebviewMessage(message);

    if (response === undefined) {
      return;
    }

    void channel.postMessage(response).then(undefined, reportDeliveryFailure);
  });
  let disposalSubscription: DisposableResource | undefined;
  disposalSubscription = lifetime.onDidDispose(() => {
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}
