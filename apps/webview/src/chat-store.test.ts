import {
  type ExtensionToWebviewMessage,
  maxTokenCount,
  protocolVersion,
} from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { createChatStore } from "./chat-store.js";
import type { WebviewHost } from "./vscode-api.js";

function createHarness(ids: string[] = ["request-1"]) {
  let scheduled: (() => void) | undefined;
  const cancelledFlushes: number[] = [];
  const host: WebviewHost = {
    submit: vi.fn(),
    regenerate: vi.fn(),
    editMessage: vi.fn(),
    newChat: vi.fn(),
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

  it("flushes the partial answer and marks a length-truncated run incomplete", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Partial answer",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "truncated",
    });

    expect(harness.store.getState().status).toBe("truncated");
    expect(harness.store.getState().runError).toBe(
      "The response was truncated before completion. Ask a follow-up to continue.",
    );
    expect(harness.store.getState().messages[1]).toMatchObject({
      role: "assistant",
      content: "Partial answer",
    });
    expect(harness.store.getState().activeRequestId).toBeUndefined();
  });

  it("accumulates partial provider usage during a run and fences terminal updates", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: 7, totalTokens: 10 },
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { outputTokens: 3, totalTokens: 12 },
    });

    expect(harness.store.getState().usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 22,
    });

    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: 99, outputTokens: 99, totalTokens: 99 },
    });

    expect(harness.store.getState().usage).toEqual({
      inputTokens: 7,
      outputTokens: 3,
      totalTokens: 22,
    });
    expect(harness.store.getState().activeRequestId).toBeUndefined();
  });

  it("downgrades cumulative overflow instead of clamping and ignores later reports", () => {
    const harness = createHarness();
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: maxTokenCount },
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: 1 },
    });

    expect(harness.store.getState().usage).toBeUndefined();
    expect(harness.store.getState().runError).toBe(
      "Provider usage exceeded the supported Session limit.",
    );

    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { outputTokens: 1 },
    });
    expect(harness.store.getState().usage).toBeUndefined();
  });

  it("keeps overflow unavailable across a completed continuation", () => {
    const harness = createHarness(["request-1", "request-2"]);
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: maxTokenCount },
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: 1 },
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    expect(harness.store.getState().usage).toBeUndefined();
    expect(harness.store.getState().submit("Continue here.")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-2",
      status: "streaming",
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-2",
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    expect(harness.store.getState().usage).toBeUndefined();
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
        usage: { inputTokens: 10, totalTokens: 12 },
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
    expect(harness.store.getState().usage).toEqual({ inputTokens: 10, totalTokens: 12 });
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

  it("confirms the Host Session ID before sending a continuation", () => {
    const harness = createHarness(["request-new", "request-continue"]);

    expect(harness.store.getState().submit("Start here.")).toBe(true);
    expect(harness.host.submit).toHaveBeenLastCalledWith("request-new", "Start here.", undefined);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-new",
      sessionId: "session-host",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-new",
      status: "completed",
    });

    expect(harness.store.getState().selectedSessionId).toBe("session-host");
    expect(harness.store.getState().sessionAnnouncement).toBe("Current Session confirmed.");
    expect(harness.store.getState().submit("Continue here.")).toBe(true);
    expect(harness.host.submit).toHaveBeenLastCalledWith(
      "request-continue",
      "Continue here.",
      "session-host",
    );
  });

  it("keeps the previous answer until a regeneration replacement completes and restores it on cancel", () => {
    const harness = createHarness(["request-1", "regenerate-1"]);
    expect(harness.store.getState().submit("Explain this.")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Original answer",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });
    const targetId = "request-1:assistant";
    expect(harness.store.getState().messages.at(-1)?.content).toBe("Original answer");

    expect(harness.store.getState().regenerate(targetId)).toBe(true);
    expect(harness.store.getState().messages.at(-1)?.content).toBe("Original answer");
    expect(harness.host.regenerate).toHaveBeenCalledWith("regenerate-1", "session-1", targetId);
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "regenerate-1",
      status: "cancelled",
    });
    expect(harness.store.getState().messages.at(-1)?.content).toBe("Original answer");
  });

  it("projects an edited historical user message only after replacement output starts", () => {
    const harness = createHarness(["request-1", "edit-1", "edit-2"]);
    expect(harness.store.getState().submit("Original question")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Original answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    const targetId = "request-1:user";
    expect(harness.store.getState().editMessage(targetId, "Edited question")).toBe(true);
    expect(harness.host.editMessage).toHaveBeenCalledWith(
      "edit-1",
      "session-1",
      targetId,
      "Edited question",
    );
    expect(harness.store.getState().messages[0]?.content).toBe("Original question");

    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "edit-1",
      text: "Edited answer",
    });
    harness.flush();
    expect(
      harness.store.getState().messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "Edited question" },
      { role: "assistant", content: "Edited answer" },
    ]);
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "edit-1",
      status: "completed",
    });
    expect(harness.store.getState().editingMessageId).toBeUndefined();

    expect(harness.store.getState().editMessage(targetId, "Edited again question")).toBe(true);
    expect(harness.host.editMessage).toHaveBeenLastCalledWith(
      "edit-2",
      "session-1",
      targetId,
      "Edited again question",
    );
    expect(harness.store.getState().messages[0]?.content).toBe("Edited question");
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "edit-2",
      text: "Edited again answer",
    });
    harness.flush();
    expect(
      harness.store.getState().messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "Edited again question" },
      { role: "assistant", content: "Edited again answer" },
    ]);
  });

  it("restores the old branch and rejects invalid edit submissions", () => {
    const harness = createHarness(["request-1", "edit-1", "edit-2"]);
    expect(harness.store.getState().submit("Original question")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Original answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    const original = harness.store.getState().messages;
    expect(harness.store.getState().editMessage("request-1:assistant", "No")).toBe(false);
    expect(harness.store.getState().editMessage("request-1:user", " ")).toBe(false);
    expect(harness.store.getState().editMessage("request-1:user", "x".repeat(1_000_001))).toBe(
      false,
    );
    expect(harness.store.getState().editMessage("request-1:user", "Edited question")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "edit-1",
      status: "cancelled",
    });
    expect(harness.store.getState().messages).toEqual(original);
    expect(harness.store.getState().editingMessageId).toBeUndefined();

    expect(harness.store.getState().editMessage("request-1:user", "Retry question")).toBe(true);
    expect(harness.host.editMessage).toHaveBeenLastCalledWith(
      "edit-2",
      "session-1",
      "request-1:user",
      "Retry question",
    );
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "edit-2",
      text: "Retry answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "edit-2",
      status: "completed",
    });
    expect(
      harness.store.getState().messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "Retry question" },
      { role: "assistant", content: "Retry answer" },
    ]);
  });

  it("fences late edit events after a Session mismatch", () => {
    const harness = createHarness(["request-1", "edit-1"]);
    expect(harness.store.getState().submit("Original question")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Original answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    expect(harness.store.getState().editMessage("request-1:user", "Edited question")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "edit-1",
      sessionId: "session-other",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "edit-1",
      text: "Wrong branch",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "edit-1",
      status: "failed",
    });

    expect(
      harness.store.getState().messages.map(({ role, content }) => ({ role, content })),
    ).toEqual([
      { role: "user", content: "Original question" },
      { role: "assistant", content: "Original answer" },
    ]);
    expect(harness.store.getState().sessionError).toBe(
      "The response belonged to a different Session.",
    );
  });

  it("keeps usage cumulative for a continuation within the same Session", () => {
    const harness = createHarness(["request-new", "request-continue"]);

    expect(harness.store.getState().submit("Start here.")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-new",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-new",
      sessionId: "session-host",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-new",
      status: "completed",
    });

    expect(harness.store.getState().submit("Continue here.")).toBe(true);
    expect(harness.store.getState().usage).toEqual({
      inputTokens: 4,
      outputTokens: 2,
      totalTokens: 6,
    });
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-continue",
      usage: { inputTokens: 3, totalTokens: 5 },
    });
    expect(harness.store.getState().usage).toEqual({
      inputTokens: 7,
      outputTokens: 2,
      totalTokens: 11,
    });
  });

  it("fences a continuation when the Host reports a different Session", () => {
    const harness = createHarness(["request-1", "request-2"]);
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-current",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });
    expect(harness.store.getState().submit("Continue safely.")).toBe(true);

    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-2",
      sessionId: "session-other",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-2",
      text: "Wrong Session answer",
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-2",
      status: "completed",
    });

    expect(harness.store.getState().messages.at(-1)?.content).toBe("");
    expect(harness.store.getState().activeRequestId).toBeUndefined();
    expect(harness.store.getState().selectedSessionId).toBe("session-current");
    expect(harness.store.getState().sessionError).toBe(
      "The response belonged to a different Session.",
    );
  });

  it("resets the transcript and stale draft when starting a New chat", () => {
    const harness = createHarness(["request-1", "new-chat-1", "request-2"]);
    startRun(harness);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-1",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Old answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/token-usage",
      requestId: "request-1",
      usage: { inputTokens: 4, outputTokens: 2, totalTokens: 6 },
    });
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    expect(harness.store.getState().messages).toHaveLength(2);
    expect(harness.store.getState().newChat()).toBe(true);
    expect(harness.host.newChat).toHaveBeenCalledWith("new-chat-1");
    expect(harness.store.getState()).toMatchObject({
      messages: [],
      selectedSessionId: undefined,
      sessionSelectionId: undefined,
      activeRequestId: undefined,
      restoring: false,
      usage: undefined,
    });

    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Late answer",
    });
    expect(harness.store.getState().messages).toEqual([]);
    expect(harness.store.getState().submit("Fresh question.")).toBe(true);
    expect(harness.host.submit).toHaveBeenLastCalledWith("request-2", "Fresh question.", undefined);
  });

  it("keeps the current projection while a selected Session is restoring", () => {
    const harness = createHarness(["request-1", "list-1", "restore-1", "request-next"]);
    expect(harness.store.getState().submit("Current question.")).toBe(true);
    harness.receive({
      protocolVersion,
      type: "extension/session-started",
      requestId: "request-1",
      sessionId: "session-current",
    });
    harness.receive({
      protocolVersion,
      type: "extension/text-delta",
      requestId: "request-1",
      text: "Current answer",
    });
    harness.flush();
    harness.receive({
      protocolVersion,
      type: "extension/run-status",
      requestId: "request-1",
      status: "completed",
    });

    harness.store.getState().loadSessions();
    harness.receive({
      protocolVersion,
      type: "extension/session-list",
      requestId: "list-1",
      sessions: [
        {
          sessionId: "session-other",
          status: "completed",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });
    harness.store.getState().selectSession("session-other");
    expect(harness.store.getState().sessionSwitchPending).toBe(true);
    expect(harness.store.getState().newChat()).toBe(false);
    expect(harness.host.newChat).not.toHaveBeenCalled();
    expect(harness.store.getState().submit("Do not switch yet.")).toBe(false);
    expect(harness.store.getState().restoreSelectedSession()).toBe(true);
    expect(harness.store.getState().restoring).toBe(true);
    expect(harness.store.getState().submit("Still waiting.")).toBe(false);
    expect(harness.store.getState().messages[1]?.content).toBe("Current answer");
    harness.receive({
      protocolVersion,
      type: "extension/session-list",
      requestId: "list-1",
      sessions: [
        {
          sessionId: "session-stale",
          status: "completed",
          createdAt: "2026-07-31T00:00:00.000Z",
        },
      ],
    });
    expect(harness.store.getState().sessionSelectionId).toBe("session-other");

    harness.receive({
      protocolVersion,
      type: "extension/session-restored",
      requestId: "restore-1",
      session: {
        sessionId: "session-wrong",
        status: "completed",
        eventLogTailDamaged: false,
        messages: [],
      },
    });
    expect(harness.store.getState().restoring).toBe(false);
    expect(harness.store.getState().selectedSessionId).toBe("session-current");
    expect(harness.store.getState().messages[1]?.content).toBe("Current answer");
    expect(harness.store.getState().sessionError).toContain("did not match");
    expect(harness.store.getState().restoreSelectedSession()).toBe(true);
    expect(harness.store.getState().submit("After retry starts.")).toBe(false);
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
