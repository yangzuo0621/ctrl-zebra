import type { SessionRecord, SessionRepository } from "@ctrl-zebra/core";
import {
  jsonValueSchema,
  type PersistedEventRecord,
  persistenceFormatVersion,
} from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { projectSessionModelHistory, SessionHistoryCorruptError } from "./session-history.js";
import { createSessionRecoveryActions, SessionRecoveryError } from "./session-recovery.js";

describe("regeneration relation validation parity", () => {
  const cases = [
    {
      name: "a later text delta target",
      events: baseEvents({ targetMessageId: "assistant-5" }),
    },
    {
      name: "a failed target Run",
      events: failedTargetEvents(),
    },
    {
      name: "an orphan replacement user relation",
      events: orphanRelationEvents(),
    },
    {
      name: "a relation before its replacement user",
      events: relationBeforeReplacementUserEvents(),
    },
    {
      name: "a relation after the replacement Run",
      events: relationAfterReplacementRunEvents(),
    },
    {
      name: "a target from an older Run",
      events: wrongRunTargetEvents(),
    },
    {
      name: "a replacement prompt with mismatched content",
      events: baseEvents({ replacementContent: "Different question" }),
    },
    {
      name: "a completed replacement Run without text",
      events: completedWithoutTextEvents(),
    },
    {
      name: "a replacement Run with an unowned idle start",
      events: replacementIdleStartEvents(),
    },
  ] as const;

  it.each(cases)("rejects $name consistently for continuation and restore", async ({ events }) => {
    const record = sessionRecord(events);
    expect(() => projectSessionModelHistory(record)).toThrow(SessionHistoryCorruptError);

    const repository: SessionRepository = {
      async get() {
        return record;
      },
      async list() {
        return [];
      },
      async create() {},
      async update() {},
      async appendEvent() {},
    };
    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-1"),
    ).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "corrupt",
      message: new SessionRecoveryError("corrupt").message,
    });
  });
});

function baseEvents(
  options: {
    targetMessageId?: string;
    replacementUserMessageId?: string;
    replacementContent?: string;
  } = {},
): readonly PersistedEventRecord[] {
  return normalize([
    user("message-1", "Question"),
    status("idle", "preparing"),
    status("preparing", "streaming"),
    text("Original"),
    text(" answer"),
    status("streaming", "completed"),
    user(options.replacementUserMessageId ?? "message-2", options.replacementContent ?? "Question"),
    relation(
      options.targetMessageId ?? "assistant-4",
      options.replacementUserMessageId ?? "message-2",
    ),
    status("completed", "preparing"),
    status("preparing", "streaming"),
    text("Replacement"),
    status("streaming", "completed"),
  ]);
}

function completedWithoutTextEvents(): readonly PersistedEventRecord[] {
  const events = [...baseEvents()];
  events.splice(10, 1);
  return normalize(events.map(({ event }) => ({ type: event.type, data: event.data })));
}

function replacementIdleStartEvents(): readonly PersistedEventRecord[] {
  const events = [...baseEvents()];
  const rawEvents = events.map(({ event }) => ({ type: event.type, data: event.data }));
  rawEvents[8] = status("idle", "preparing");
  return normalize(rawEvents);
}

function failedTargetEvents(): readonly PersistedEventRecord[] {
  return normalize([
    user("message-1", "Question"),
    status("idle", "preparing"),
    status("preparing", "streaming"),
    text("Original"),
    status("streaming", "failed"),
    user("message-2", "Question"),
    relation("assistant-4", "message-2"),
    status("failed", "preparing"),
    status("preparing", "streaming"),
    text("Replacement"),
    status("streaming", "completed"),
  ]);
}

function orphanRelationEvents(): readonly PersistedEventRecord[] {
  const events = [...baseEvents()];
  events.splice(6, 1);
  const rawEvents = events.map(({ event }) => ({ type: event.type, data: event.data }));
  rawEvents[6] = relation("assistant-4", "missing-user");
  return normalize(rawEvents);
}

function relationBeforeReplacementUserEvents(): readonly PersistedEventRecord[] {
  const events = [...baseEvents()];
  const relationIndex = events.findIndex(({ event }) => event.type === "session.regeneration");
  const relationEvent = events.splice(relationIndex, 1)[0];
  events.splice(relationIndex - 1, 0, relationEvent);
  return normalize(events.map(({ event }) => ({ type: event.type, data: event.data })));
}

function relationAfterReplacementRunEvents(): readonly PersistedEventRecord[] {
  const events = [...baseEvents()];
  const relationIndex = events.findIndex(({ event }) => event.type === "session.regeneration");
  const relationEvent = events.splice(relationIndex, 1)[0];
  events.push(relationEvent);
  return normalize(events.map(({ event }) => ({ type: event.type, data: event.data })));
}

function wrongRunTargetEvents(): readonly PersistedEventRecord[] {
  return normalize([
    user("message-1", "First"),
    status("idle", "preparing"),
    status("preparing", "streaming"),
    text("First answer"),
    status("streaming", "completed"),
    user("message-2", "Second"),
    status("completed", "preparing"),
    status("preparing", "streaming"),
    text("Second answer"),
    status("streaming", "completed"),
    user("message-3", "Second"),
    relation("assistant-4", "message-3"),
    status("completed", "preparing"),
    status("preparing", "streaming"),
    text("Replacement"),
    status("streaming", "completed"),
  ]);
}

function user(messageId: string, content: string) {
  return {
    type: "session.user-message",
    data: {
      messageId,
      sessionId: "session-1",
      createdAt: "2026-08-14T00:00:00.000Z",
      role: "user",
      content,
    },
  } as const;
}

function status(previousStatus: string, nextStatus: string) {
  return { type: "session.status-changed", data: { previousStatus, status: nextStatus } } as const;
}

function text(value: string) {
  return { type: "agent.text-delta", data: { text: value } } as const;
}

function relation(targetMessageId: string, replacementUserMessageId: string) {
  return {
    type: "session.regeneration",
    data: { targetMessageId, replacementUserMessageId },
  } as const;
}

function normalize(events: readonly { type: string; data: unknown }[]): PersistedEventRecord[] {
  return events.map((event, index) => ({
    sequence: index + 1,
    recordedAt: `2026-08-14T00:00:${String(index).padStart(2, "0")}.000Z`,
    event: { type: event.type, data: jsonValueSchema.parse(event.data) },
  }));
}

function sessionRecord(events: readonly PersistedEventRecord[]): SessionRecord {
  return {
    manifest: {
      formatVersion: persistenceFormatVersion,
      sessionId: "session-1",
      status: "completed",
      createdAt: "2026-08-14T00:00:00.000Z",
      updatedAt: "2026-08-14T00:00:00.000Z",
      lastEventSequence: events.length,
    },
    events,
    eventLogTailDamaged: false,
  };
}
