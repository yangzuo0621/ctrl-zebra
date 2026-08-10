import type { SessionRecord } from "@ctrl-zebra/core";
import {
  jsonValueSchema,
  type PersistedEventRecord,
  persistenceFormatVersion,
} from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { projectSessionModelHistory, SessionHistoryCorruptError } from "./session-history.js";

describe("projectSessionModelHistory", () => {
  it("projects ordered text across multiple completed Runs", () => {
    const session = record([
      userEvent("message-1", "First"),
      statusEvent("idle", "preparing"),
      statusEvent("preparing", "streaming"),
      textEvent("Hello"),
      statusEvent("streaming", "completed"),
      userEvent("message-2", "Second"),
      statusEvent("completed", "preparing"),
      statusEvent("preparing", "streaming"),
      textEvent("Again"),
      statusEvent("streaming", "completed"),
    ]);

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "First" },
      { role: "assistant", content: "Hello" },
      { role: "user", content: "Second" },
      { role: "assistant", content: "Again" },
    ]);
  });

  it("keeps a complete Tool Call/Result pair in source order", () => {
    const call = { id: "call-1", name: "list_files", input: {} } as const;
    const result = {
      callId: "call-1",
      name: "list_files",
      status: "success",
      output: { files: ["README.md"] },
      truncated: false,
    } as const;
    const session = record([
      userEvent("message-1", "List files"),
      statusEvent("idle", "preparing"),
      statusEvent("preparing", "streaming"),
      toolEvent("pending", call),
      statusEvent("streaming", "executing_tool"),
      toolEvent("running", call),
      toolEvent("success", call, result),
      statusEvent("executing_tool", "streaming"),
      textEvent("Done"),
      statusEvent("streaming", "completed"),
    ]);

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "List files" },
      { role: "assistant", toolCall: call },
      { role: "tool", result },
      { role: "assistant", content: "Done" },
    ]);
  });

  it("retains complete Tool pairs but discards partial assistant text after cancellation", () => {
    const call = { id: "call-1", name: "list_files", input: {} } as const;
    const result = {
      callId: "call-1",
      name: "list_files",
      status: "success",
      output: { files: [] },
      truncated: false,
    } as const;
    const session = record(
      [
        userEvent("message-1", "List files"),
        statusEvent("idle", "preparing"),
        statusEvent("preparing", "streaming"),
        toolEvent("pending", call),
        statusEvent("streaming", "executing_tool"),
        toolEvent("running", call),
        toolEvent("success", call, result),
        statusEvent("executing_tool", "streaming"),
        textEvent("partial answer"),
        statusEvent("streaming", "cancelled"),
      ],
      "cancelled",
    );

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "List files" },
      { role: "assistant", toolCall: call },
      { role: "tool", result },
    ]);
  });

  it("retains complete Tool pairs and drops partial text after interruption", () => {
    const call = { id: "call-1", name: "list_files", input: {} } as const;
    const result = {
      callId: "call-1",
      name: "list_files",
      status: "success",
      output: { files: [] },
      truncated: false,
    } as const;
    const session = record(
      [
        userEvent("message-1", "List files"),
        statusEvent("idle", "preparing"),
        statusEvent("preparing", "streaming"),
        toolEvent("pending", call),
        statusEvent("streaming", "executing_tool"),
        toolEvent("running", call),
        toolEvent("success", call, result),
        statusEvent("executing_tool", "streaming"),
        textEvent("partial answer"),
        statusEvent("streaming", "interrupted"),
      ],
      "interrupted",
    );

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "List files" },
      { role: "assistant", toolCall: call },
      { role: "tool", result },
    ]);
  });

  it("retains complete Tool pairs and drops partial text after truncation", () => {
    const call = { id: "call-1", name: "list_files", input: {} } as const;
    const result = {
      callId: "call-1",
      name: "list_files",
      status: "success",
      output: { files: [] },
      truncated: false,
    } as const;
    const session = record(
      [
        userEvent("message-1", "List files"),
        statusEvent("idle", "preparing"),
        statusEvent("preparing", "streaming"),
        toolEvent("pending", call),
        statusEvent("streaming", "executing_tool"),
        toolEvent("running", call),
        toolEvent("success", call, result),
        statusEvent("executing_tool", "streaming"),
        textEvent("partial answer"),
        statusEvent("streaming", "truncated"),
      ],
      "truncated",
    );

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "List files" },
      { role: "assistant", toolCall: call },
      { role: "tool", result },
    ]);
  });

  it("rejects an orphan Tool Result", () => {
    const session = record([
      userEvent("message-1", "List files"),
      toolEvent(
        "success",
        { id: "call-1", name: "list_files", input: {} },
        {
          callId: "call-1",
          name: "list_files",
          status: "success",
          output: {},
          truncated: false,
        },
      ),
    ]);

    expect(() => projectSessionModelHistory(session)).toThrow(SessionHistoryCorruptError);
  });

  it("returns an empty history for an empty Session", () => {
    expect(projectSessionModelHistory(record([]))).toEqual([]);
  });

  it("rejects a malformed recognized record and mismatched status transition", () => {
    const malformed = record([
      userEvent("message-1", "Hello"),
      event("agent.text-delta", { text: "Hello", extra: true }),
    ]);
    expect(() => projectSessionModelHistory(malformed)).toThrow(SessionHistoryCorruptError);

    const invalidTransition = record([
      userEvent("message-1", "Hello"),
      statusEvent("idle", "completed"),
    ]);
    expect(() => projectSessionModelHistory(invalidTransition)).toThrow(SessionHistoryCorruptError);
  });

  it("rejects an unfinished non-final Run instead of silently dropping its tail", () => {
    const session = record([
      userEvent("message-1", "First"),
      statusEvent("idle", "preparing"),
      statusEvent("preparing", "streaming"),
      textEvent("partial"),
      userEvent("message-2", "Second"),
    ]);

    expect(() => projectSessionModelHistory(session)).toThrow(SessionHistoryCorruptError);
  });

  it("rejects text and Tool payloads beyond their hard bounds", () => {
    const oversizedText = record([
      userEvent("message-1", "Hello"),
      textEvent("x".repeat(1_000_001)),
    ]);
    expect(() => projectSessionModelHistory(oversizedText)).toThrow(SessionHistoryCorruptError);

    const call = { id: "call-1", name: "list_files", input: {} } as const;
    const oversizedResult = {
      callId: "call-1",
      name: "list_files",
      status: "success",
      output: "x".repeat(1_049_000),
      truncated: false,
    } as const;
    const oversizedTool = record([
      userEvent("message-1", "List files"),
      toolEvent("pending", call),
      toolEvent("success", call, oversizedResult),
    ]);
    expect(() => projectSessionModelHistory(oversizedTool)).toThrow(SessionHistoryCorruptError);
  });

  it("rejects a projected history beyond the message-count ceiling", () => {
    const events: PersistedEventRecord[] = [
      userEvent("message-1", "Many tools"),
      statusEvent("idle", "preparing"),
      statusEvent("preparing", "streaming"),
    ];
    for (let index = 0; index < 5_000; index += 1) {
      const call = { id: `call-${index}`, name: "list_files", input: { index } } as const;
      events.push(
        toolEvent("pending", call),
        statusEvent("streaming", "executing_tool"),
        toolEvent("running", call),
        toolEvent("success", call, {
          callId: call.id,
          name: call.name,
          status: "success",
          output: { files: [] },
          truncated: false,
        }),
        statusEvent("executing_tool", "streaming"),
      );
    }
    events.push(statusEvent("streaming", "completed"));

    expect(() => projectSessionModelHistory(record(events))).toThrow(SessionHistoryCorruptError);
  });

  it("reads a legacy single-turn v1 Session without status events", () => {
    const session = record([userEvent("message-1", "Legacy"), textEvent("answer")]);

    expect(projectSessionModelHistory(session)).toEqual([
      { role: "user", content: "Legacy" },
      { role: "assistant", content: "answer" },
    ]);
  });

  it("drops a damaged unfinished tail without inventing an assistant result", () => {
    const session = record(
      [
        userEvent("message-1", "Continue"),
        statusEvent("idle", "preparing"),
        statusEvent("preparing", "streaming"),
        textEvent("partial"),
      ],
      "streaming",
      true,
    );

    expect(projectSessionModelHistory(session)).toEqual([{ role: "user", content: "Continue" }]);
  });
});

function record(
  events: readonly PersistedEventRecord[],
  status:
    | "idle"
    | "streaming"
    | "completed"
    | "truncated"
    | "cancelled"
    | "failed"
    | "interrupted" = "completed",
  eventLogTailDamaged = false,
): SessionRecord {
  const normalizedEvents = events.map((persisted, index) => ({
    ...persisted,
    sequence: index + 1,
  }));
  return {
    manifest: {
      formatVersion: persistenceFormatVersion,
      sessionId: "session-1",
      status,
      createdAt: "2026-08-10T00:00:00.000Z",
      updatedAt: "2026-08-10T00:00:00.000Z",
      lastEventSequence: normalizedEvents.length,
    },
    events: normalizedEvents,
    eventLogTailDamaged,
  };
}

function event(type: string, data: unknown): PersistedEventRecord {
  return {
    sequence: 1,
    recordedAt: "2026-08-10T00:00:00.000Z",
    event: { type, data: jsonValueSchema.parse(data) },
  };
}

function userEvent(messageId: string, content: string): PersistedEventRecord {
  return event("session.user-message", {
    messageId,
    sessionId: "session-1",
    createdAt: "2026-08-10T00:00:00.000Z",
    role: "user",
    content,
  });
}

function statusEvent(previousStatus: string, status: string): PersistedEventRecord {
  return event("session.status-changed", { previousStatus, status });
}

function textEvent(text: string): PersistedEventRecord {
  return event("agent.text-delta", { text });
}

function toolEvent(
  status: "pending" | "running" | "success" | "error",
  call: unknown,
  result?: unknown,
): PersistedEventRecord {
  return event(
    "agent.tool-state",
    result === undefined ? { status, call } : { status, call, result },
  );
}
