import type { AgentRuntimeEvent } from "@ctrl-zebra/core";
import { protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  bindWebviewMessageController,
  handleWebviewMessage,
} from "./webview-message-controller.js";

const idleChatRunner = {
  async run() {},
};

describe("handleWebviewMessage", () => {
  it("returns a correlated pong for a valid ping", () => {
    expect(
      handleWebviewMessage({
        protocolVersion,
        type: "webview/ping",
        requestId: "request-1",
      }),
    ).toEqual({
      protocolVersion,
      type: "extension/pong",
      requestId: "request-1",
    });
  });

  it.each([
    null,
    "webview/ping",
    { protocolVersion: 2, type: "webview/ping", requestId: "request-1" },
    { protocolVersion, type: "webview/unknown", requestId: "request-1" },
  ])("ignores invalid or unknown input %#", (message) => {
    expect(handleWebviewMessage(message)).toBeUndefined();
  });

  it("posts responses until the Webview view is disposed", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    let disposeListener: (() => void) | undefined;
    let messageSubscriptionDisposed = false;
    let disposalSubscriptionDisposed = false;
    const postedMessages: unknown[] = [];
    const deliveryFailures: string[] = [];
    const emitMessage = (message: unknown) => {
      if (!messageSubscriptionDisposed) {
        messageListener?.(message);
      }
    };

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return {
            dispose() {
              messageSubscriptionDisposed = true;
            },
          };
        },
        postMessage(message) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
      },
      {
        onDidDispose(listener) {
          disposeListener = listener;
          return {
            dispose() {
              disposalSubscriptionDisposed = true;
            },
          };
        },
      },
      () => deliveryFailures.push("failed"),
      idleChatRunner,
    );

    emitMessage({ protocolVersion, type: "webview/ping", requestId: "request-1" });
    emitMessage({ protocolVersion, type: "webview/unknown", requestId: "request-2" });
    await Promise.resolve();

    expect(postedMessages).toEqual([
      { protocolVersion, type: "extension/pong", requestId: "request-1" },
    ]);
    expect(deliveryFailures).toEqual([]);

    disposeListener?.();

    expect(messageSubscriptionDisposed).toBe(true);
    expect(disposalSubscriptionDisposed).toBe(true);

    emitMessage({ protocolVersion, type: "webview/ping", requestId: "request-3" });
    expect(postedMessages).toHaveLength(1);
  });

  it("observes a rejected response delivery", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    let deliveryFailureCount = 0;

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage() {
          return Promise.reject(new Error("delivery failed"));
        },
      },
      {
        onDidDispose() {
          return { dispose() {} };
        },
      },
      () => {
        deliveryFailureCount += 1;
      },
      idleChatRunner,
    );

    messageListener?.({ protocolVersion, type: "webview/ping", requestId: "request-1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(deliveryFailureCount).toBe(1);
  });

  it("forwards ordered runtime deltas and terminal completion", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    const postedMessages: unknown[] = [];

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage(message) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
      },
      {
        onDidDispose() {
          return { dispose() {} };
        },
      },
      () => {},
      {
        async run(_content, _signal, emit) {
          emit({
            type: "session.status-changed",
            sessionId: "session-1",
            previousStatus: "preparing",
            status: "streaming",
          });
          emit({ type: "agent.text-delta", sessionId: "session-1", text: "Hel" });
          emit({
            type: "agent.tool-state",
            sessionId: "session-1",
            call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
            status: "pending",
          });
          emit({
            type: "agent.tool-state",
            sessionId: "session-1",
            call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
            status: "running",
          });
          emit({
            type: "agent.tool-state",
            sessionId: "session-1",
            call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
            status: "success",
            result: {
              callId: "call-1",
              name: "read_file",
              status: "success",
              output: { content: "Hello" },
              truncated: false,
            },
          });
          emit({ type: "agent.text-delta", sessionId: "session-1", text: "lo" });
          emit({
            type: "session.status-changed",
            sessionId: "session-1",
            previousStatus: "streaming",
            status: "completed",
          });
        },
      },
    );

    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-1",
      content: "Say hello.",
    });
    await Promise.resolve();

    expect(postedMessages).toEqual([
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "preparing",
      },
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "streaming",
      },
      {
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "Hel",
      },
      {
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-1",
        call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
        status: "pending",
      },
      {
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-1",
        call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
        status: "running",
      },
      {
        protocolVersion,
        type: "extension/tool-state",
        requestId: "request-1",
        call: { id: "call-1", name: "read_file", input: { path: "README.md" } },
        status: "success",
        result: {
          callId: "call-1",
          name: "read_file",
          status: "success",
          output: { content: "Hello" },
          truncated: false,
        },
      },
      {
        protocolVersion,
        type: "extension/text-delta",
        requestId: "request-1",
        text: "lo",
      },
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "completed",
      },
    ]);
  });

  it("aborts the correlated run and ignores later deltas after cancellation", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    const postedMessages: unknown[] = [];
    let emitRuntimeEvent: ((event: AgentRuntimeEvent) => void) | undefined;
    let receivedSignal: AbortSignal | undefined;

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage(message) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
      },
      {
        onDidDispose() {
          return { dispose() {} };
        },
      },
      () => {},
      {
        run(_content, signal, emit) {
          receivedSignal = signal;
          emitRuntimeEvent = emit;
          return new Promise((_, reject) => {
            signal.addEventListener("abort", () => reject(signal.reason), { once: true });
          });
        },
      },
    );

    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-1",
      content: "Keep going.",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/cancel",
      requestId: "request-1",
    });
    emitRuntimeEvent?.({ type: "agent.text-delta", sessionId: "session-1", text: "late" });
    await Promise.resolve();

    expect(receivedSignal?.aborted).toBe(true);
    expect(postedMessages).toEqual([
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "preparing",
      },
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "cancelled",
      },
    ]);
  });

  it("accepts a new run immediately after cancelling the active run", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    const postedMessages: unknown[] = [];
    const receivedContents: string[] = [];
    const resolveRuns: Array<() => void> = [];

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage(message) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
      },
      {
        onDidDispose() {
          return { dispose() {} };
        },
      },
      () => {},
      {
        run(content) {
          receivedContents.push(content);
          return new Promise((resolve) => resolveRuns.push(resolve));
        },
      },
    );

    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-1",
      content: "First request.",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/cancel",
      requestId: "request-1",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-2",
      content: "Second request.",
    });

    expect(receivedContents).toEqual(["First request.", "Second request."]);
    expect(postedMessages).toEqual([
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "preparing",
      },
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-1",
        status: "cancelled",
      },
      {
        protocolVersion,
        type: "extension/run-status",
        requestId: "request-2",
        status: "preparing",
      },
    ]);

    resolveRuns[0]?.();
    resolveRuns[1]?.();
    await Promise.resolve();

    expect(postedMessages.at(-1)).toEqual({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-2",
      status: "completed",
    });
  });

  it("projects an Agent approval event onto the current Webview run", async () => {
    let messageListener: ((message: unknown) => void) | undefined;
    const postedMessages: unknown[] = [];
    let finishRun: (() => void) | undefined;
    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage(message) {
          postedMessages.push(message);
          return Promise.resolve(true);
        },
      },
      { onDidDispose: () => ({ dispose() {} }) },
      () => {},
      {
        async run(_content, _signal, emit) {
          emit({
            type: "agent.approval-state",
            sessionId: "session-1",
            approval: {
              id: "approval-1",
              scope: {
                sessionId: "session-1",
                call: { id: "call-1", name: "propose_file_edit", input: {} },
                risk: "write",
                resources: [],
              },
              presentation: { title: "Apply edit", summary: "Apply one edit." },
              createdAt: "2026-07-19T00:00:00.000Z",
              expiresAt: "2026-07-19T00:05:00.000Z",
            },
            status: "pending",
          });
          await new Promise<void>((resolve) => {
            finishRun = resolve;
          });
        },
      },
    );

    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-approval",
      content: "Edit the file.",
    });
    await Promise.resolve();

    expect(postedMessages[1]).toMatchObject({
      protocolVersion,
      type: "extension/approval-state",
      requestId: "request-approval",
      status: "pending",
      approval: { id: "approval-1" },
    });
    finishRun?.();
  });

  it("routes only current-run Approval UI actions without treating them as cancellation", () => {
    let messageListener: ((message: unknown) => void) | undefined;
    const actions: unknown[] = [];

    bindWebviewMessageController(
      {
        onDidReceiveMessage(listener) {
          messageListener = listener;
          return { dispose() {} };
        },
        postMessage() {
          return Promise.resolve(true);
        },
      },
      {
        onDidDispose() {
          return { dispose() {} };
        },
      },
      () => {},
      idleChatRunner,
      {
        showDiff(requestId, approvalId) {
          actions.push({ type: "show-diff", requestId, approvalId });
        },
        decide(requestId, approvalId, decision) {
          actions.push({ type: "decision", requestId, approvalId, decision });
        },
      },
    );

    messageListener?.({
      protocolVersion,
      type: "webview/submit",
      requestId: "request-1",
      content: "Edit the file.",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/approval-decision",
      requestId: "different-run",
      approvalId: "approval-1",
      decision: "approved",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/show-approval-diff",
      requestId: "request-1",
      approvalId: "approval-1",
    });
    messageListener?.({
      protocolVersion,
      type: "webview/approval-decision",
      requestId: "request-1",
      approvalId: "approval-1",
      decision: "approved",
    });

    expect(actions).toEqual([
      {
        type: "show-diff",
        requestId: "request-1",
        approvalId: "approval-1",
      },
      {
        type: "decision",
        requestId: "request-1",
        approvalId: "approval-1",
        decision: "approved",
      },
    ]);
  });
});
