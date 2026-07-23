import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  protocolVersion,
  type RunStatus,
  webviewToExtensionMessageSchema,
} from "@ctrl-zebra/protocol";

import type { ChatRunner } from "./chat-runner.js";
import { CheckpointActionError, type CheckpointActions } from "./checkpoint-actions.js";
import { mapRunErrorToUi } from "./run-error-mapper.js";
import { type SessionRecoveryActions, SessionRecoveryError } from "./session-recovery.js";

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
  approvalActions?: ApprovalUiActions,
  sessionActions?: SessionRecoveryActions,
  checkpointActions?: CheckpointActions,
  reportRunFailure: (error: unknown) => void = () => {},
): void {
  let disposed = false;
  const checkpointRequests = new Set<AbortController>();
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

    if (event.type === "agent.approval-state") {
      post({
        protocolVersion,
        type: "extension/approval-state",
        requestId: run.requestId,
        approval: event.approval,
        status: event.status,
      });
      return;
    }

    if (event.status === "preparing") {
      return;
    }

    if (event.status === "streaming") {
      postStatus(run.requestId, event.status);
      return;
    }

    if (event.status === "completed" || event.status === "cancelled") {
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
        (error: unknown) => {
          if (run.abortController.signal.aborted) {
            finishRun(run, "cancelled");
            return;
          }

          reportRunFailure(error);
          post({
            protocolVersion,
            type: "extension/run-error",
            requestId: run.requestId,
            ...mapRunErrorToUi(error),
          });
          finishRun(run, "failed");
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

    if (result.data.type === "webview/list-sessions") {
      void (
        sessionActions?.list() ?? Promise.reject(new Error("Session storage unavailable."))
      ).then(
        (sessions) =>
          post({
            protocolVersion,
            type: "extension/session-list",
            requestId: result.data.requestId,
            sessions: [...sessions],
          }),
        (error: unknown) =>
          post({
            protocolVersion,
            type: "extension/session-error",
            requestId: result.data.requestId,
            code: error instanceof SessionRecoveryError ? error.code : "unavailable",
            message: "Saved Sessions are unavailable.",
          }),
      );
      return;
    }

    if (result.data.type === "webview/restore-session") {
      void (
        sessionActions?.restore(result.data.sessionId) ??
        Promise.reject(new Error("Session storage unavailable."))
      ).then(
        (session) =>
          post({
            protocolVersion,
            type: "extension/session-restored",
            requestId: result.data.requestId,
            session,
          }),
        (error: unknown) =>
          post({
            protocolVersion,
            type: "extension/session-error",
            requestId: result.data.requestId,
            code: error instanceof SessionRecoveryError ? error.code : "unavailable",
            message: "The saved Session could not be restored.",
          }),
      );
      return;
    }

    if (result.data.type === "webview/list-checkpoints") {
      const controller = new AbortController();
      checkpointRequests.add(controller);
      void (
        checkpointActions?.list(controller.signal) ??
        Promise.reject(new Error("Checkpoint storage unavailable."))
      )
        .then(
          (checkpoints) =>
            post({
              protocolVersion,
              type: "extension/checkpoint-list",
              requestId: result.data.requestId,
              checkpoints: [...checkpoints],
            }),
          () =>
            post({
              protocolVersion,
              type: "extension/checkpoint-error",
              requestId: result.data.requestId,
              code: "unavailable",
              message: "Checkpoints are unavailable.",
            }),
        )
        .finally(() => checkpointRequests.delete(controller));
      return;
    }

    if (result.data.type === "webview/restore-checkpoint") {
      const { checkpointId, requestId } = result.data;
      const controller = new AbortController();
      checkpointRequests.add(controller);
      void (
        checkpointActions?.restore(checkpointId, controller.signal) ??
        Promise.reject(new Error("Checkpoint restore unavailable."))
      )
        .then(
          () =>
            post({
              protocolVersion,
              type: "extension/checkpoint-restored",
              requestId,
              checkpointId,
            }),
          (error: unknown) =>
            post({
              protocolVersion,
              type: "extension/checkpoint-error",
              requestId,
              code: error instanceof CheckpointActionError ? error.code : "unavailable",
              message:
                error instanceof CheckpointActionError && error.code === "conflict"
                  ? "Files changed after the Agent edit. Nothing was restored."
                  : "The Checkpoint could not be restored.",
            }),
        )
        .finally(() => checkpointRequests.delete(controller));
      return;
    }

    if (result.data.type === "webview/show-approval-diff") {
      if (activeRun?.requestId === result.data.requestId) {
        approvalActions?.showDiff(result.data.requestId, result.data.approvalId);
      }
      return;
    }

    if (result.data.type === "webview/approval-decision") {
      if (activeRun?.requestId === result.data.requestId) {
        approvalActions?.decide(
          result.data.requestId,
          result.data.approvalId,
          result.data.decision,
        );
      }
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
    for (const controller of checkpointRequests) {
      controller.abort(new Error("Webview disposed during Checkpoint operation."));
    }
    checkpointRequests.clear();
    messageSubscription.dispose();
    disposalSubscription?.dispose();
    disposalSubscription = undefined;
  });
}
