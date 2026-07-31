import { type ExtensionToWebviewMessage, protocolVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { createChatStore } from "./chat-store.js";
import type { WebviewHost } from "./vscode-api.js";

function createHarness(ids: string[] = ["request-1"]) {
  let scheduled: (() => void) | undefined;
  const cancelledFlushes: number[] = [];
  const host: WebviewHost = {
    submit: vi.fn(),
    cancel: vi.fn(),
    showApprovalDiff: vi.fn(),
    decideApproval: vi.fn(),
    listSessions: vi.fn(),
    restoreSession: vi.fn(),
    listCheckpoints: vi.fn(),
    restoreCheckpoint: vi.fn(),
    subscribe: () => () => {},
  };
  const store = createChatStore({
    host,
    createRequestId: () => ids.shift() ?? "unexpected",
    scheduleFlush: (callback) => {
      scheduled = callback;
      return () => {
        cancelledFlushes.push(1);
        scheduled = undefined;
      };
    },
  });
  const receive = (message: ExtensionToWebviewMessage) => store.getState().receive(message);
  const flush = () => {
    const callback = scheduled;
    scheduled = undefined;
    callback?.();
  };
  return { store, host, receive, flush, cancelledFlushes };
}

function startRun(harness: ReturnType<typeof createHarness>) {
  expect(harness.store.getState().submit("Explain this.")).toBe(true);
  harness.receive({
    protocolVersion,
    type: "extension/run-status",
    requestId: "request-1",
    status: "streaming",
  });
}

describe("chat reasoning store", () => {
  it("flushes a visible batch within 50 milliseconds when no animation frame runs", () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    vi.stubGlobal("cancelAnimationFrame", vi.fn());
    const host = createHarness().host;
    const store = createChatStore({
      host,
      createRequestId: () => "request-1",
    });
    try {
      store.getState().submit("Explain this.");
      store.getState().receive({
        protocolVersion,
        type: "extension/reasoning-start",
        requestId: "request-1",
        blockId: "block-1",
      });
      store.getState().receive({
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: "request-1",
        blockId: "block-1",
        text: "Visible soon",
      });

      vi.advanceTimersByTime(49);
      expect(store.getState().messages[1]?.reasoningBlocks).toEqual([]);
      vi.advanceTimersByTime(1);
      expect(store.getState().messages[1]?.reasoningBlocks[0]?.content).toBe("Visible soon");
    } finally {
      store.getState().dispose();
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  });

  it("batches ordered deltas and preserves multiple block snapshots", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "block-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: "Check ",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: "facts.",
    });

    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([]);
    harness.flush();
    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([
      {
        blockId: "block-1",
        content: "Check facts.",
        state: "streaming",
        truncated: false,
        expanded: true,
      },
    ]);

    harness.receive({
      protocolVersion,
      type: "extension/reasoning-end",
      requestId: "request-1",
      blockId: "block-1",
      truncated: false,
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "block-2",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-2",
      text: "Compare.",
    });
    harness.flush();

    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([
      expect.objectContaining({ blockId: "block-1", state: "complete" }),
      expect.objectContaining({ blockId: "block-2", content: "Compare.", state: "streaming" }),
    ]);
  });

  it("keeps a user-collapsed block closed while later deltas arrive", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "block-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: "First",
    });
    harness.flush();
    harness.store.getState().toggleReasoningBlock("request-1:assistant", "block-1");
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: " second",
    });
    harness.flush();

    expect(harness.store.getState().messages[1]?.reasoningBlocks[0]).toMatchObject({
      content: "First second",
      expanded: false,
      state: "streaming",
    });
  });

  it("flushes a partial block on cancellation and ignores every late event", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "block-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: "Retained",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "cancelled",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: " discarded",
    });

    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([
      expect.objectContaining({
        content: "Retained",
        state: "partial",
        expanded: true,
      }),
    ]);
    expect(harness.store.getState().activeRequestId).toBeUndefined();
  });

  it("removes an empty completed lifecycle and defensively truncates oversized blocks", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "empty",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-end",
      requestId: "request-1",
      blockId: "empty",
      truncated: false,
    });
    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([]);

    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "bounded",
    });
    for (let index = 0; index < 5; index += 1) {
      harness.receive({
        protocolVersion,
        type: "extension/reasoning-delta",
        requestId: "request-1",
        blockId: "bounded",
        text: "x".repeat(8_192),
      });
    }
    harness.flush();

    expect(harness.store.getState().messages[1]?.reasoningBlocks[0]).toMatchObject({
      blockId: "bounded",
      content: "x".repeat(32_768),
      truncated: true,
    });
  });

  it("atomically restores ordered complete and partial blocks collapsed", () => {
    const harness = createHarness(["list-1", "restore-1"]);
    harness.store.getState().loadSessions();
    harness.receive({
      protocolVersion,
      type: "extension/session-list",
      requestId: "list-1",
      sessions: [
        {
          sessionId: "session-1",
          status: "interrupted",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });
    expect(harness.store.getState().restoreSelectedSession()).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-restored",
      requestId: "restore-1",
      sessionId: "session-1",
      blocks: [
        {
          blockId: "complete",
          startSequence: 2,
          endSequence: 4,
          content: "Saved summary",
          state: "complete",
          truncated: false,
        },
        {
          blockId: "partial",
          startSequence: 5,
          content: "Interrupted summary",
          state: "partial",
          truncated: true,
        },
      ],
      runTruncated: true,
    });
    expect(harness.store.getState().messages).toEqual([]);
    harness.receive({
      protocolVersion,
      type: "extension/session-restored",
      requestId: "restore-1",
      session: {
        sessionId: "session-1",
        status: "interrupted",
        eventLogTailDamaged: false,
        messages: [
          {
            messageId: "user-1",
            sessionId: "session-1",
            createdAt: "2026-07-31T00:00:00.000Z",
            role: "user",
            content: "Saved question",
          },
          {
            messageId: "assistant-1",
            sessionId: "session-1",
            createdAt: "2026-07-31T00:00:01.000Z",
            role: "assistant",
            content: "Saved answer",
          },
        ],
      },
    });

    expect(harness.store.getState().messages[1]).toMatchObject({
      id: "assistant-1",
      reasoningRunTruncated: true,
      reasoningBlocks: [
        expect.objectContaining({ blockId: "complete", state: "complete", expanded: false }),
        expect.objectContaining({ blockId: "partial", state: "partial", expanded: false }),
      ],
    });
    expect(harness.store.getState().reasoningAnnouncement).toBe("");
  });

  it("discards a staged restore when the next message does not match", () => {
    const harness = createHarness(["list-1", "restore-1"]);
    harness.store.getState().loadSessions();
    harness.receive({
      protocolVersion,
      type: "extension/session-list",
      requestId: "list-1",
      sessions: [
        {
          sessionId: "session-1",
          status: "completed",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });
    harness.store.getState().restoreSelectedSession();
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-restored",
      requestId: "restore-1",
      sessionId: "session-1",
      blocks: [
        {
          blockId: "block-1",
          startSequence: 1,
          endSequence: 3,
          content: "Do not commit",
          state: "complete",
          truncated: false,
        },
      ],
      runTruncated: false,
    });
    harness.receive({
      protocolVersion,
      type: "extension/pong",
      requestId: "unrelated",
    });
    harness.receive({
      protocolVersion,
      type: "extension/session-restored",
      requestId: "restore-1",
      session: {
        sessionId: "session-1",
        status: "completed",
        eventLogTailDamaged: false,
        messages: [],
      },
    });

    expect(harness.store.getState().messages).toEqual([]);
  });

  it("cancels its owned scheduler on disposal", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-start",
      requestId: "request-1",
      blockId: "block-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/reasoning-delta",
      requestId: "request-1",
      blockId: "block-1",
      text: "Pending",
    });

    harness.store.getState().dispose();

    expect(harness.cancelledFlushes).toHaveLength(1);
    expect(harness.store.getState().messages[1]?.reasoningBlocks).toEqual([]);
  });
});
