import {
  type ApprovalDecisionIntent,
  type ExtensionToWebviewMessage,
  type McpPromptConfirmation,
  type McpResourceAttachment,
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
  sessionStartedSent: boolean;
  eventsClosed: boolean;
  terminalSent: boolean;
  readonly regenerationTargetMessageId?: string;
}

export class WebviewRunMessageHandler {
  #activeRun: ActiveRun | undefined;
  #disposed = false;
  #ownedSessionId: string | undefined;

  constructor(
    private readonly post: PostWebviewMessage,
    private readonly chatRunner: ChatRunner,
    private readonly approvalActions?: ApprovalUiActions,
    private readonly reportRunFailure: (error: unknown) => void = () => {},
  ) {}

  start(
    requestId: string,
    content: string,
    externalResources: readonly McpResourceAttachment[] = [],
    externalPrompts: readonly McpPromptConfirmation[] = [],
    sessionId?: string,
  ): void {
    if (this.#activeRun !== undefined) {
      return;
    }
    if (
      sessionId !== undefined &&
      this.#ownedSessionId !== undefined &&
      sessionId !== this.#ownedSessionId
    ) {
      return;
    }

    const run: ActiveRun = {
      requestId,
      abortController: new AbortController(),
      sessionId,
      sessionStartedSent: false,
      eventsClosed: false,
      terminalSent: false,
    };
    this.#launch(run, (signal) =>
      this.chatRunner.run(
        content,
        signal,
        (event) => this.#handleRuntimeEvent(run, event),
        externalResources,
        externalPrompts,
        sessionId,
      ),
    );
  }

  regenerate(requestId: string, sessionId: string, targetAssistantMessageId: string): void {
    const regenerate = this.chatRunner.regenerate;
    if (this.#activeRun !== undefined) {
      return;
    }
    if (regenerate === undefined) {
      this.#rejectRegeneration(requestId, new Error("Regeneration is unavailable."));
      return;
    }
    if (this.#ownedSessionId !== sessionId) {
      this.#rejectRegeneration(requestId, new Error("Regeneration Session ownership changed."));
      return;
    }

    const run: ActiveRun = {
      requestId,
      abortController: new AbortController(),
      sessionId,
      sessionStartedSent: false,
      eventsClosed: false,
      terminalSent: false,
      regenerationTargetMessageId: targetAssistantMessageId,
    };
    this.#launch(run, (signal) =>
      regenerate(sessionId, targetAssistantMessageId, signal, (event) =>
        this.#handleRuntimeEvent(run, event),
      ),
    );
  }

  edit(requestId: string, sessionId: string, targetUserMessageId: string, content: string): void {
    const edit = this.chatRunner.edit;
    if (this.#activeRun !== undefined) {
      return;
    }
    if (edit === undefined) {
      this.#rejectEdit(requestId, new Error("Editing is unavailable."));
      return;
    }
    if (this.#ownedSessionId !== sessionId) {
      this.#rejectEdit(requestId, new Error("Editing Session ownership changed."));
      return;
    }

    const run: ActiveRun = {
      requestId,
      abortController: new AbortController(),
      sessionId,
      sessionStartedSent: false,
      eventsClosed: false,
      terminalSent: false,
    };
    this.#launch(run, (signal) =>
      edit(sessionId, targetUserMessageId, content, signal, (event) =>
        this.#handleRuntimeEvent(run, event),
      ),
    );
  }

  #launch(run: ActiveRun, execute: (signal: AbortSignal) => Promise<void>): void {
    this.#activeRun = run;
    this.#postStatus(run.requestId, "preparing");

    void execute(run.abortController.signal)
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

  canStart(): boolean {
    return !this.#disposed && this.#activeRun === undefined;
  }

  setOwnedSession(sessionId: string): void {
    if (this.#activeRun === undefined) {
      this.#ownedSessionId = sessionId;
    }
  }

  clearOwnedSession(): void {
    if (this.#activeRun === undefined) {
      this.#ownedSessionId = undefined;
    }
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
    this.#ownedSessionId = undefined;
  }

  #postStatus(requestId: string, status: RunStatus): void {
    this.post({
      protocolVersion,
      type: "extension/run-status",
      requestId,
      status,
    });
  }

  #rejectRegeneration(requestId: string, error: unknown): void {
    this.#rejectRunIntent(requestId, error);
  }

  #rejectEdit(requestId: string, error: unknown): void {
    this.#rejectRunIntent(requestId, error);
  }

  #rejectRunIntent(requestId: string, error: unknown): void {
    if (this.#disposed) {
      return;
    }
    this.reportRunFailure(error);
    this.post({
      protocolVersion,
      type: "extension/run-error",
      requestId,
      ...mapRunErrorToUi(error),
    });
    this.#postStatus(requestId, "failed");
  }

  #finish(run: ActiveRun, status: "completed" | "truncated" | "cancelled" | "failed"): void {
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
      if (this.#ownedSessionId !== undefined && this.#ownedSessionId !== event.sessionId) {
        run.eventsClosed = true;
        return;
      }
      this.#ownedSessionId = event.sessionId;
    } else if (run.sessionId !== event.sessionId) {
      return;
    }

    if (!run.sessionStartedSent) {
      const sessionId = run.sessionId;
      if (sessionId === undefined) {
        return;
      }
      run.sessionStartedSent = true;
      this.post({
        protocolVersion,
        type: "extension/session-started",
        requestId: run.requestId,
        sessionId,
      });
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

    if (event.type === "agent.usage") {
      this.post({
        protocolVersion,
        type: "extension/token-usage",
        requestId: run.requestId,
        usage: event.usage,
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
          source: event.source ?? { kind: "builtin" },
          status: event.status,
        });
      } else if (event.status === "success") {
        this.post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          source: event.source ?? { kind: "builtin" },
          status: event.status,
          result: event.result,
        });
      } else {
        this.post({
          protocolVersion,
          type: "extension/tool-state",
          requestId: run.requestId,
          call: event.call,
          source: event.source ?? { kind: "builtin" },
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

    if (
      event.status === "completed" ||
      event.status === "truncated" ||
      event.status === "cancelled"
    ) {
      this.#finish(run, event.status);
    }
  }
}
