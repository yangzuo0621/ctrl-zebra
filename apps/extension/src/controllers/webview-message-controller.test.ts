import { protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  bindWebviewMessageController,
  handleWebviewMessage,
} from "./webview-message-controller.js";

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
    );

    messageListener?.({ protocolVersion, type: "webview/ping", requestId: "request-1" });
    await Promise.resolve();
    await Promise.resolve();

    expect(deliveryFailureCount).toBe(1);
  });
});
