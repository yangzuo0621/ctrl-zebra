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

  const finishRun = (
    run: NonNullable<typeof activeRun>,
    status: "completed" | "cancelled" | "failed",
  ) => {
    if (disposed || activeRun !== run || run.terminalSent) {
      return;
    }

    run.terminalSent = true;
    activeRun = undefined;
    postStatus(run.requestId, status);
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

    if (event.type === "agent.tool-state") {
      if (!("result" in event)) {
        post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          status: event.status,
        });
      } else if (event.status === "success") {
        post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          status: event.status,
          result: event.result,
        });
      } else {
        post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          status: "error",
          result: event.result,
        });
      }
      return;
    }

    if (event.status === "preparing") {
      return;
    }

    if (event.status === "streaming") {
      postStatus(run.requestId, event.status);
      return;
    }

    if (event.status === "completed" || event.status === "cancelled" || event.status === "failed") {
      finishRun(run, event.status);
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
          const status = run.abortController.signal.aborted ? "cancelled" : "completed";
          finishRun(run, status);
        },
        () => {
          const status = run.abortController.signal.aborted ? "cancelled" : "failed";
          finishRun(run, status);
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

    const run = activeRun;
    if (run?.requestId === result.data.requestId) {
      run.abortController.abort(new Error("Chat run cancelled by the user."));
      finishRun(run, "cancelled");
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
