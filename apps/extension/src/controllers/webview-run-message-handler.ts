import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  protocolVersion,
  type RunStatus,
} from "@ctrl-zebra/protocol";

import type { ChatRunner, ChatRunnerEvent } from "./chat-runner.js";
import { mapRunErrorToUi } from "./run-error-mapper.js";

type PostWebviewMessage = (message: ExtensionToWebviewMessage) => void;

interface ApprovalUiActions {
  showDiff(requestId: string, approvalId: string): void;
  decide(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void;
}

interface ActiveRun {
  readonly requestId: string;
  readonly abortController: AbortController;
  sessionId?: string;
  eventsClosed: boolean;
  terminalSent: boolean;
}

export class WebviewRunMessageHandler {
  #activeRun: ActiveRun | undefined;
  #disposed = false;

  constructor(
    private readonly post: PostWebviewMessage,
    private readonly chatRunner: ChatRunner,
    private readonly approvalActions?: ApprovalUiActions,
    private readonly reportRunFailure: (error: unknown) => void = () => {},
  ) {}

  start(requestId: string, content: string): void {
    if (this.#activeRun !== undefined) {
      return;
    }

    const run: ActiveRun = {
      requestId,
      abortController: new AbortController(),
      eventsClosed: false,
      terminalSent: false,
    };
    this.#activeRun = run;
    this.#postStatus(requestId, "preparing");

    void this.chatRunner
      .run(content, run.abortController.signal, (event) => this.#handleRuntimeEvent(run, event))
      .then(
        () => {
          const status = run.abortController.signal.aborted ? "cancelled" : "completed";
          this.#finish(run, status);
        },
        (error: unknown) => {
          if (run.abortController.signal.aborted) {
            this.#finish(run, "cancelled");
            return;
          }

          this.reportRunFailure(error);
          this.post({
            protocolVersion,
            type: "extension/run-error",
            requestId: run.requestId,
            ...mapRunErrorToUi(error),
          });
          this.#finish(run, "failed");
        },
      )
      .finally(() => {
        if (this.#activeRun === run) {
          this.#activeRun = undefined;
        }
      });
  }

  cancel(requestId: string): void {
    const run = this.#activeRun;
    if (run?.requestId !== requestId) {
      return;
    }

    run.abortController.abort(new Error("Chat run cancelled by the user."));
    this.#finish(run, "cancelled");
  }

  showApprovalDiff(requestId: string, approvalId: string): void {
    if (this.#activeRun?.requestId === requestId) {
      this.approvalActions?.showDiff(requestId, approvalId);
    }
  }

  decideApproval(requestId: string, approvalId: string, decision: ApprovalDecisionIntent): void {
    if (this.#activeRun?.requestId === requestId) {
      this.approvalActions?.decide(requestId, approvalId, decision);
    }
  }

  dispose(): void {
    this.#disposed = true;
    this.#activeRun?.abortController.abort(new Error("Webview disposed during chat run."));
    this.#activeRun = undefined;
  }

  #postStatus(requestId: string, status: RunStatus): void {
    this.post({
      protocolVersion,
      type: "extension/run-status",
      requestId,
      status,
    });
  }

  #finish(run: ActiveRun, status: "completed" | "cancelled" | "failed"): void {
    if (this.#disposed || this.#activeRun !== run || run.terminalSent) {
      return;
    }

    run.terminalSent = true;
    this.#activeRun = undefined;
    this.#postStatus(run.requestId, status);
  }

  #handleRuntimeEvent(run: ActiveRun, event: ChatRunnerEvent): void {
    if (this.#disposed || this.#activeRun !== run || run.terminalSent || run.eventsClosed) {
      return;
    }
    if (run.sessionId === undefined) {
      run.sessionId = event.sessionId;
    } else if (run.sessionId !== event.sessionId) {
      return;
    }

    if (event.type === "agent.text-delta") {
      this.post({
        protocolVersion,
        type: "extension/text-delta",
        requestId: run.requestId,
        text: event.text,
      });
      return;
    }

    if (event.type === "agent.tool-state") {
      if (!("result" in event)) {
        this.post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          status: event.status,
        });
      } else if (event.status === "success") {
        this.post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          status: event.status,
          result: event.result,
        });
      } else {
        this.post({
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
      this.post({
        protocolVersion,
        type: "extension/approval-state",
        requestId: run.requestId,
        approval: event.approval,
        status: event.status,
      });
      return;
    }

    if (event.type === "session.reasoning-start") {
      this.post({
        protocolVersion,
        type: "extension/reasoning-start",
        requestId: run.requestId,
        blockId: event.blockId,
      });
      return;
    }

    if (event.type === "session.reasoning-delta") {
      this.post({
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: run.requestId,
        blockId: event.blockId,
        text: event.text,
      });
      return;
    }

    if (event.type === "session.reasoning-end") {
      this.post({
        protocolVersion,
        type: "extension/reasoning-end",
        requestId: run.requestId,
        blockId: event.blockId,
        truncated: event.truncated,
      });
      return;
    }

    if (event.type === "session.reasoning-limit") {
      this.post({
        protocolVersion,
        type: "extension/reasoning-limit",
        requestId: run.requestId,
        ...(event.scope === "block"
          ? { scope: event.scope, blockId: event.blockId, reason: event.reason }
          : { scope: event.scope, reason: event.reason }),
      });
      return;
    }

    if (event.status === "preparing") {
      return;
    }

    if (event.status === "streaming") {
      this.#postStatus(run.requestId, event.status);
      return;
    }

    if (event.status === "failed") {
      run.eventsClosed = true;
      return;
    }

    if (event.status === "completed" || event.status === "cancelled") {
      this.#finish(run, event.status);
    }
  }
}
