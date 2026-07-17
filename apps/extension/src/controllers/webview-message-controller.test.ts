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
});
