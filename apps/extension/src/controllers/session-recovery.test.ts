import { InMemorySessionRepository } from "@ctrl-zebra/core";
import { persistenceFormatVersion } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

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
      sessionId: "session-1",
      messages: [
        { role: "user", content: "Question" },
        { role: "assistant", content: "Answer" },
      ],
    });
  });

  it("isolates a corrupt Session behind a safe recovery error", async () => {
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

    await expect(actions.list()).resolves.toEqual([]);
    await expect(actions.restore("damaged")).rejects.toMatchObject({
      name: "SessionRecoveryError",
      code: "corrupt",
      message: new SessionRecoveryError("corrupt").message,
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
      status: "interrupted",
      messages: [],
    });
    expect(updates).toEqual(["interrupted"]);
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
