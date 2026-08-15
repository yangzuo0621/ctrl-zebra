import type { CheckpointStore } from "@ctrl-zebra/core";
import {
  InconsistentSessionRecordError,
  InMemorySessionRepository,
  type SessionRepository,
} from "@ctrl-zebra/core";
import {
  maxTokenCount,
  type PersistedEventRecord,
  persistenceFormatVersion,
} from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  completeReasoningV1Events,
  malformedReasoningV1Events,
  partialReasoningV1Events,
  preReasoningV1Events,
} from "../test/fixtures/session-reasoning-v1-fixtures.js";
import { createSessionRecoveryActions, SessionRecoveryError } from "./session-recovery.js";

describe("Session recovery", () => {
  it("normalizes every non-terminal status and preserves every terminal status", async () => {
    const statuses = [
      "idle",
      "preparing",
      "streaming",
      "awaiting_approval",
      "executing_tool",
      "completed",
      "cancelled",
      "failed",
      "interrupted",
    ] as const;
    const updates: Array<{ sessionId: string; status: string }> = [];
    const actions = createSessionRecoveryActions(
      async () => ({
        async list() {
          return statuses.map((status) => ({
            sessionId: `session-${status}`,
            status,
            createdAt: "2026-07-19T10:00:00.000Z",
          }));
        },
        async update(sessionId, patch) {
          updates.push({ sessionId: String(sessionId), status: patch.status ?? "missing" });
        },
        async get() {
          return undefined;
        },
        async create() {},
        async appendEvent() {},
      }),
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    const listed = await actions.list();

    expect(
      listed
        .filter(({ sessionId }) => /idle|preparing|streaming|awaiting|executing/.test(sessionId))
        .map(({ status }) => status),
    ).toEqual(Array.from({ length: 5 }, () => "interrupted"));
    expect(updates).toHaveLength(5);
    expect(
      listed.filter(({ sessionId }) => /completed|cancelled|failed|interrupted/.test(sessionId)),
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ status: "completed" }),
        expect.objectContaining({ status: "cancelled" }),
        expect.objectContaining({ status: "failed" }),
        expect.objectContaining({ status: "interrupted" }),
      ]),
    );
  });

  it("sorts summaries newest first with a deterministic ID tie-break", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-b", "2026-07-19T10:00:00.000Z"));
    await repository.create(manifest("session-a", "2026-07-19T10:00:00.000Z"));
    await repository.create(manifest("session-new", "2026-07-19T11:00:00.000Z"));

    await expect(createSessionRecoveryActions(async () => repository).list()).resolves.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ sessionId: "session-new" }),
        expect.objectContaining({ sessionId: "session-a" }),
        expect.objectContaining({ sessionId: "session-b" }),
      ]),
    );
    expect(
      (await createSessionRecoveryActions(async () => repository).list()).map(
        ({ sessionId }) => sessionId,
      ),
    ).toEqual(["session-new", "session-a", "session-b"]);
  });

  it("reports an unavailable recovery when an interrupted status cannot be persisted", async () => {
    const actions = createSessionRecoveryActions(async () => ({
      async list() {
        return [
          {
            sessionId: "session-streaming",
            status: "streaming",
            createdAt: "2026-07-19T10:00:00.000Z",
          },
        ];
      },
      async update() {
        throw new Error("raw storage failure");
      },
      async get() {
        return undefined;
      },
      async create() {},
      async appendEvent() {},
    }));

    await expect(actions.list()).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "unavailable",
    });
  });

  it("deletes a Session and its Checkpoints, and reports partial cleanup for retry", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-delete", "2026-07-19T10:00:00.000Z"));
    const checkpointDeletes: string[] = [];
    const checkpointStore: CheckpointStore = {
      create: async () => {
        throw new Error("unused");
      },
      read: async () => undefined,
      list: async () => [],
      deleteForSession: async (sessionId: string) => {
        checkpointDeletes.push(sessionId);
        return { deleted: 2, failed: 0 };
      },
    };
    const actions = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => checkpointStore,
    );

    await expect(actions.delete?.("session-delete")).resolves.toBeUndefined();
    expect(checkpointDeletes).toEqual(["session-delete"]);
    await expect(repository.get("session-delete")).resolves.toBeUndefined();

    const partialStore: CheckpointStore = {
      create: async () => {
        throw new Error("unused");
      },
      read: async () => undefined,
      list: async () => [],
      deleteForSession: async () => ({ deleted: 0, failed: 1 }),
    };
    const partial = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => partialStore,
    );
    await expect(partial.delete?.("session-delete")).rejects.toMatchObject({ code: "partial" });
  });

  it("aggregates Checkpoint deletions after a Session repository failure", async () => {
    const repository: SessionRepository = {
      async create() {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async update() {},
      async appendEvent() {},
      async delete() {
        throw new Error("Session repository unavailable");
      },
    };
    const checkpointStore: CheckpointStore = {
      create: async () => {
        throw new Error("unused");
      },
      read: async () => undefined,
      list: async () => [],
      deleteForSession: async () => ({ deleted: 2, failed: 0 }),
    };
    const actions = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => checkpointStore,
    );

    await expect(actions.delete?.("session-delete")).rejects.toMatchObject({
      code: "partial",
      deletedCount: 2,
    });
  });

  it("clears all Sessions and Checkpoints after cleanup succeeds", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-clear", "2026-07-19T10:00:00.000Z"));
    let checkpointsCleared = false;
    const checkpointStore: CheckpointStore = {
      create: async () => {
        throw new Error("unused");
      },
      read: async () => undefined,
      list: async () => [],
      clear: async () => {
        checkpointsCleared = true;
        return { deleted: 3, failed: 0 };
      },
    };
    const actions = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => checkpointStore,
    );

    await expect(actions.clear?.()).resolves.toBe(4);
    expect(checkpointsCleared).toBe(true);
    await expect(repository.list()).resolves.toEqual([]);
  });

  it("propagates a bounded partial Session cleanup report after multiple deletions", async () => {
    const clearCalls: string[] = [];
    const repository: SessionRepository = {
      async create() {},
      async get() {
        return undefined;
      },
      async list() {
        return [
          {
            sessionId: "session-removed",
            status: "completed",
            createdAt: "2026-07-19T10:00:00.000Z",
          },
          {
            sessionId: "session-failed",
            status: "completed",
            createdAt: "2026-07-19T09:00:00.000Z",
          },
        ];
      },
      async update() {},
      async appendEvent() {},
      async clear() {
        clearCalls.push("sessions");
        return { deleted: 1, failed: 1 };
      },
    };
    const actions = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => ({
        create: async () => {
          throw new Error("unused");
        },
        read: async () => undefined,
        list: async () => [],
        clear: async () => ({ deleted: 0, failed: 0 }),
      }),
    );

    await expect(actions.clear?.()).rejects.toMatchObject({
      code: "partial",
      deletedCount: 1,
    });
    expect(clearCalls).toEqual(["sessions"]);
  });

  it("aggregates Checkpoint deletions after a clear-all Session repository failure", async () => {
    const repository: SessionRepository = {
      async create() {},
      async get() {
        return undefined;
      },
      async list() {
        return [];
      },
      async update() {},
      async appendEvent() {},
      async clear() {
        throw new Error("Session repository unavailable");
      },
    };
    const checkpointStore: CheckpointStore = {
      create: async () => {
        throw new Error("unused");
      },
      read: async () => undefined,
      list: async () => [],
      clear: async () => ({ deleted: 3, failed: 0 }),
    };
    const actions = createSessionRecoveryActions(
      async () => repository,
      undefined,
      async () => checkpointStore,
    );

    await expect(actions.clear?.()).rejects.toMatchObject({
      code: "partial",
      deletedCount: 3,
    });
  });

  it("reconstructs user and assistant messages from ordered events", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-1", "2026-07-19T10:00:00.000Z"));
    await repository.appendEvent("session-1", {
      sequence: 1,
      recordedAt: "2026-07-19T10:00:00.000Z",
      event: {
        type: "session.user-message",
        data: {
          messageId: "message-1",
          sessionId: "session-1",
          createdAt: "2026-07-19T10:00:00.000Z",
          role: "user",
          content: "Question",
        },
      },
    });
    for (const [index, text] of ["Ans", "wer"].entries()) {
      await repository.appendEvent("session-1", {
        sequence: index + 2,
        recordedAt: `2026-07-19T10:00:0${index + 1}.000Z`,
        event: { type: "agent.text-delta", data: { text } },
      });
    }

    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-1"),
    ).resolves.toMatchObject({
      session: {
        sessionId: "session-1",
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "Answer" },
        ],
      },
      reasoning: { sessionId: "session-1", blocks: [], runTruncated: false },
    });
  });

  it("restores a completed regeneration without duplicating the replacement prompt", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-regeneration", "2026-07-19T10:00:00.000Z"));
    const events = [
      {
        type: "session.user-message",
        data: {
          messageId: "message-1",
          sessionId: "session-regeneration",
          createdAt: "2026-07-19T10:00:00.000Z",
          role: "user",
          content: "Question",
        },
      },
      { type: "agent.text-delta", data: { text: "Original" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "streaming", status: "completed" },
      },
      {
        type: "session.user-message",
        data: {
          messageId: "message-2",
          sessionId: "session-regeneration",
          createdAt: "2026-07-19T10:00:01.000Z",
          role: "user",
          content: "Question",
        },
      },
      {
        type: "session.regeneration",
        data: { targetMessageId: "assistant-2", replacementUserMessageId: "message-2" },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "completed", status: "preparing" },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "preparing", status: "streaming" },
      },
      { type: "agent.text-delta", data: { text: "Replacement" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "streaming", status: "completed" },
      },
    ] as const;
    for (const [index, event] of events.entries()) {
      await repository.appendEvent("session-regeneration", {
        sequence: index + 1,
        recordedAt: `2026-07-19T10:00:0${index}.000Z`,
        event,
      });
    }

    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-regeneration"),
    ).resolves.toMatchObject({
      session: {
        messages: [
          { role: "user", content: "Question" },
          { role: "assistant", content: "Replacement" },
        ],
      },
    });
  });

  it("restores a completed edit as the edited branch and removes the old suffix", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-edit", "2026-07-19T10:00:00.000Z"));
    const events = [
      {
        type: "session.user-message",
        data: {
          messageId: "message-1",
          sessionId: "session-edit",
          createdAt: "2026-07-19T10:00:00.000Z",
          role: "user",
          content: "Original question",
        },
      },
      { type: "session.status-changed", data: { previousStatus: "idle", status: "preparing" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "preparing", status: "streaming" },
      },
      { type: "agent.text-delta", data: { text: "Original answer" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "streaming", status: "completed" },
      },
      {
        type: "session.user-message",
        data: {
          messageId: "message-2",
          sessionId: "session-edit",
          createdAt: "2026-07-19T10:00:01.000Z",
          role: "user",
          content: "Later question",
        },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "completed", status: "preparing" },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "preparing", status: "streaming" },
      },
      { type: "agent.text-delta", data: { text: "Later answer" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "streaming", status: "completed" },
      },
      {
        type: "session.user-message",
        data: {
          messageId: "message-edited",
          sessionId: "session-edit",
          createdAt: "2026-07-19T10:00:02.000Z",
          role: "user",
          content: "Edited question",
        },
      },
      {
        type: "session.edit",
        data: { targetMessageId: "message-1", replacementUserMessageId: "message-edited" },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "completed", status: "preparing" },
      },
      {
        type: "session.status-changed",
        data: { previousStatus: "preparing", status: "streaming" },
      },
      { type: "agent.text-delta", data: { text: "Edited answer" } },
      {
        type: "session.status-changed",
        data: { previousStatus: "streaming", status: "completed" },
      },
    ] as const;
    for (const [index, event] of events.entries()) {
      await repository.appendEvent("session-edit", {
        sequence: index + 1,
        recordedAt: `2026-07-19T10:00:${String(index).padStart(2, "0")}.000Z`,
        event,
      });
    }

    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-edit"),
    ).resolves.toMatchObject({
      session: {
        messages: [
          { messageId: "message-1", role: "user", content: "Edited question" },
          { role: "assistant", content: "Edited answer" },
        ],
      },
    });
  });

  it("recovers cumulative and partial Provider Usage without treating it as model history", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-usage", "2026-08-10T00:00:00.000Z"));
    await repository.appendEvent("session-usage", {
      sequence: 1,
      recordedAt: "2026-08-10T00:00:00.000Z",
      event: {
        type: "session.user-message",
        data: {
          messageId: "message-usage",
          sessionId: "session-usage",
          createdAt: "2026-08-10T00:00:00.000Z",
          role: "user",
          content: "Count",
        },
      },
    });
    await repository.appendEvent("session-usage", {
      sequence: 2,
      recordedAt: "2026-08-10T00:00:01.000Z",
      event: { type: "session.usage", data: { inputTokens: 4, totalTokens: 6 } },
    });
    await repository.appendEvent("session-usage", {
      sequence: 3,
      recordedAt: "2026-08-10T00:00:02.000Z",
      event: { type: "session.usage", data: { outputTokens: 2, totalTokens: 3 } },
    });

    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-usage"),
    ).resolves.toMatchObject({
      session: {
        usage: { inputTokens: 4, outputTokens: 2, totalTokens: 9 },
        messages: [{ role: "user", content: "Count" }],
      },
    });
  });

  it("rejects cumulative Provider Usage overflow as corrupt", async () => {
    const repository = new InMemorySessionRepository();
    await repository.create(manifest("session-usage-overflow", "2026-08-10T00:00:00.000Z"));
    await repository.appendEvent("session-usage-overflow", {
      sequence: 1,
      recordedAt: "2026-08-10T00:00:00.000Z",
      event: { type: "session.usage", data: { inputTokens: maxTokenCount } },
    });
    await repository.appendEvent("session-usage-overflow", {
      sequence: 2,
      recordedAt: "2026-08-10T00:00:01.000Z",
      event: { type: "session.usage", data: { inputTokens: 1 } },
    });

    await expect(
      createSessionRecoveryActions(async () => repository).restore("session-usage-overflow"),
    ).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "corrupt",
    });
  });

  it("isolates a corrupt Session behind a safe recovery error", async () => {
    const actions = createSessionRecoveryActions(async () => ({
      async get() {
        throw new InconsistentSessionRecordError("damaged");
      },
      async list() {
        return [];
      },
      async create() {},
      async update() {},
      async appendEvent() {},
    }));

    await expect(actions.list()).resolves.toEqual([]);
    await expect(actions.restore("damaged")).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "corrupt",
      message: new SessionRecoveryError("corrupt").message,
    });
  });

  it("distinguishes unavailable Session storage from corrupt persisted data", async () => {
    const actions = createSessionRecoveryActions(async () => ({
      async get() {
        throw new Error("raw storage failure");
      },
      async list() {
        return [];
      },
      async create() {},
      async update() {},
      async appendEvent() {},
    }));

    await expect(actions.restore("unavailable")).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "unavailable",
    });
  });

  it("marks persisted approval and tool waits interrupted without replaying them", async () => {
    const updates: string[] = [];
    const actions = createSessionRecoveryActions(
      async () => ({
        async get() {
          return {
            manifest: {
              ...manifest("session-danger", "2026-07-19T10:00:00.000Z"),
              status: "awaiting_approval",
              lastEventSequence: 2,
            },
            events: [
              {
                sequence: 1,
                recordedAt: "2026-07-19T10:00:01.000Z",
                event: { type: "agent.approval-state", data: { status: "pending" } },
              },
              {
                sequence: 2,
                recordedAt: "2026-07-19T10:00:02.000Z",
                event: { type: "agent.tool-state", data: { status: "running" } },
              },
            ],
            eventLogTailDamaged: false,
          };
        },
        async update(_sessionId, patch) {
          updates.push(patch.status ?? "missing");
        },
        async list() {
          return [];
        },
        async create() {},
        async appendEvent() {},
      }),
      () => new Date("2026-07-19T12:00:00.000Z"),
    );

    await expect(actions.restore("session-danger")).resolves.toMatchObject({
      session: { status: "interrupted", messages: [] },
      reasoning: { blocks: [], runTruncated: false },
    });
    expect(updates).toEqual(["interrupted"]);
  });

  it("restores complete reasoning with original event ordering metadata", async () => {
    const actions = createSessionRecoveryActions(async () =>
      repositoryFixture("completed", completeReasoningV1Events),
    );

    await expect(actions.restore("session-fixture")).resolves.toMatchObject({
      session: {
        messages: [{ role: "assistant", content: "Answer" }],
      },
      reasoning: {
        sessionId: "session-fixture",
        runTruncated: false,
        blocks: [
          {
            blockId: "reasoning-1",
            startSequence: 1,
            endSequence: 5,
            content: "Check facts.",
            state: "complete",
            truncated: false,
          },
        ],
      },
    });
  });

  it("restores an interrupted open block as partial without resuming work", async () => {
    const updates: string[] = [];
    const repository = repositoryFixture("streaming", partialReasoningV1Events);
    repository.update = async (_sessionId, patch) => {
      updates.push(patch.status ?? "missing");
    };
    const actions = createSessionRecoveryActions(async () => repository);

    await expect(actions.restore("session-fixture")).resolves.toMatchObject({
      session: { status: "interrupted", messages: [] },
      reasoning: {
        blocks: [
          {
            blockId: "reasoning-partial",
            startSequence: 1,
            content: "Unfinished",
            state: "partial",
            truncated: false,
          },
        ],
      },
    });
    expect(updates).toEqual(["interrupted"]);
  });

  it("retains a bounded partial block when the event log tail is damaged", async () => {
    const actions = createSessionRecoveryActions(async () =>
      repositoryFixture("completed", partialReasoningV1Events, true),
    );

    await expect(actions.restore("session-fixture")).resolves.toMatchObject({
      session: { eventLogTailDamaged: true },
      reasoning: {
        blocks: [
          {
            blockId: "reasoning-partial",
            content: "Unfinished",
            state: "partial",
          },
        ],
      },
    });
  });

  it("preserves a valid persisted block truncation marker", async () => {
    const events: PersistedEventRecord[] = [
      {
        sequence: 1,
        recordedAt: "2026-07-31T00:00:01.000Z",
        event: { type: "session.reasoning-start", data: { blockId: "reasoning-limit" } },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        sequence: index + 2,
        recordedAt: `2026-07-31T00:00:0${index + 2}.000Z`,
        event: {
          type: "session.reasoning-delta",
          data: { blockId: "reasoning-limit", text: "x".repeat(8_192) },
        },
      })),
      {
        sequence: 6,
        recordedAt: "2026-07-31T00:00:06.000Z",
        event: {
          type: "session.reasoning-limit",
          data: {
            scope: "block",
            blockId: "reasoning-limit",
            reason: "code-points",
          },
        },
      },
      {
        sequence: 7,
        recordedAt: "2026-07-31T00:00:07.000Z",
        event: {
          type: "session.reasoning-end",
          data: { blockId: "reasoning-limit", truncated: true },
        },
      },
    ];
    const actions = createSessionRecoveryActions(async () =>
      repositoryFixture("completed", events),
    );

    const restored = await actions.restore("session-fixture");
    expect(restored.reasoning.blocks[0]).toMatchObject({
      content: "x".repeat(32_768),
      state: "complete",
      truncated: true,
    });
  });

  it("loads a pre-reasoning version 1 Session with an empty reasoning projection", async () => {
    const actions = createSessionRecoveryActions(async () =>
      repositoryFixture("completed", preReasoningV1Events),
    );

    await expect(actions.restore("session-fixture")).resolves.toMatchObject({
      session: { messages: [{ role: "assistant", content: "Legacy answer" }] },
      reasoning: { blocks: [], runTruncated: false },
    });
  });

  it("isolates a malformed persisted reasoning lifecycle", async () => {
    const actions = createSessionRecoveryActions(async () =>
      repositoryFixture("completed", malformedReasoningV1Events),
    );

    await expect(actions.restore("session-fixture")).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "corrupt",
    });
  });
});

function manifest(sessionId: string, createdAt: string) {
  return {
    formatVersion: persistenceFormatVersion,
    sessionId,
    status: "completed",
    createdAt,
    updatedAt: createdAt,
    lastEventSequence: 0,
  } as const;
}

function repositoryFixture(
  status: "completed" | "streaming",
  events: readonly PersistedEventRecord[],
  eventLogTailDamaged = false,
): SessionRepository {
  return {
    async get() {
      return {
        manifest: {
          ...manifest("session-fixture", "2026-07-31T00:00:00.000Z"),
          status,
          lastEventSequence: events.length,
        },
        events,
        eventLogTailDamaged,
      };
    },
    async list() {
      return [];
    },
    async create() {},
    async update() {},
    async appendEvent() {},
  };
}
