import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import {
  type ExtensionToWebviewMessage,
  protocolVersion,
  type RunStatus,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";

import type { ChatRunner } from "./chat-runner.js";

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
  chatRunner: ChatRunner,
): void {
  let disposed = false;
  let activeRun:
    | {
        readonly requestId: string;
        readonly abortController: AbortController;
        terminalSent: boolean;
      }
    | undefined;

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

  const postStatus = (requestId: string, status: RunStatus) => {
    post({
      protocolVersion,
      type: "extension/run-status",
      requestId,
      status,
    });
  };

  const handleRuntimeEvent = (run: NonNullable<typeof activeRun>, event: AgentRuntimeEvent) => {
    if (disposed || activeRun !== run || run.terminalSent) {
      return;
    }

    if (event.type === "agent.text-delta") {
      post({
        protocolVersion,
        type: "extension/text-delta",
        requestId: run.requestId,
        text: event.text,
      });
      return;
    }

    if (event.status === "preparing") {
      return;
    }

    if (
      event.status === "streaming" ||
      event.status === "completed" ||
      event.status === "cancelled" ||
      event.status === "failed"
    ) {
      postStatus(run.requestId, event.status);
      run.terminalSent =
        event.status === "completed" || event.status === "cancelled" || event.status === "failed";
    }
  };

  const startRun = (requestId: string, content: string) => {
    if (activeRun !== undefined) {
      return;
    }

    const run = {
      requestId,
      abortController: new AbortController(),
      terminalSent: false,
    };
    activeRun = run;
    postStatus(requestId, "preparing");

    void chatRunner
      .run(content, run.abortController.signal, (event) => handleRuntimeEvent(run, event))
      .then(
        () => {
          if (!run.terminalSent) {
            const status = run.abortController.signal.aborted ? "cancelled" : "completed";
            postStatus(requestId, status);
            run.terminalSent = true;
          }
        },
        () => {
          if (!run.terminalSent) {
            const status = run.abortController.signal.aborted ? "cancelled" : "failed";
            postStatus(requestId, status);
            run.terminalSent = true;
          }
        },
      )
      .finally(() => {
        if (activeRun === run) {
          activeRun = undefined;
        }
      });
  };

  const messageSubscription = channel.onDidReceiveMessage((message) => {
    const result = webviewToExtensionMessageSchema.safeParse(message);

    if (!result.success) {
      return;
    }

    if (result.data.type === "webview/ping") {
      const response = handleWebviewMessage(result.data);
      if (response !== undefined) {
        post(response);
      }
      return;
    }

    if (result.data.type === "webview/submit") {
      startRun(result.data.requestId, result.data.content);
      return;
    }

    if (activeRun?.requestId === result.data.requestId) {
      activeRun.abortController.abort(new Error("Chat run cancelled by the user."));
      postStatus(activeRun.requestId, "cancelled");
      activeRun.terminalSent = true;
    }
  });
  let disposalSubscription: DisposableResource | undefined;
  disposalSubscription = lifetime.onDidDispose(() => {
    disposed = true;
    activeRun?.abortController.abort(new Error("Webview disposed during chat run."));
    activeRun = undefined;
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}
