import {
  InconsistentSessionRecordError,
  InMemorySessionRepository,
  type SessionRepository,
} from "@ctrl-zebra/core";
import { type PersistedEventRecord, persistenceFormatVersion } from "@ctrl-zebra/protocol";
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
