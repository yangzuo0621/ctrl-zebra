import type { SessionStatus } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  type CheckpointStore,
  cleanupExpiredSessions,
  defaultSessionRetentionDays,
  maxSessionRecords,
  type SessionRepository,
} from "./index.js";

describe("Session retention", () => {
  it("uses the default duration, exact boundary, and UTC-independent timestamps", async () => {
    const candidates = [
      candidate("boundary", "2026-07-17T08:00:00+08:00"),
      candidate("older", "2026-07-17T07:59:59.999+08:00"),
      candidate("newer", "2026-07-17T08:00:00.001+08:00"),
    ];
    const { repository, deleted } = createRepository(candidates);

    const report = await cleanupExpiredSessions(repository, undefined, {
      policy: { enabled: true, days: defaultSessionRetentionDays },
      now: () => new Date("2026-08-16T08:00:00+08:00"),
      signal: new AbortController().signal,
      candidates,
    });

    expect(report.cutoffAt).toBe("2026-07-17T00:00:00.000Z");
    expect(report.expired).toBe(2);
    expect(report.deletedSessions).toBe(2);
    expect(deleted).toEqual(["boundary", "older"]);

    const utcRepository = createRepository(candidates);
    const utcReport = await cleanupExpiredSessions(utcRepository.repository, undefined, {
      policy: { enabled: true, days: defaultSessionRetentionDays },
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      signal: new AbortController().signal,
      candidates,
    });
    expect(utcReport.cutoffAt).toBe(report.cutoffAt);
    expect(utcRepository.deleted).toEqual(deleted);
  });

  it("does not scan or delete anything when automatic cleanup is disabled", async () => {
    const candidates = [candidate("expired", "2026-01-01T00:00:00.000Z")];
    const { repository, deleted, listedCandidates } = createRepository(candidates, {
      listCandidates: async () => {
        throw new Error("disabled cleanup must not scan");
      },
    });
    const checkpointStore = createCheckpointStore(() => {
      throw new Error("disabled cleanup must not delete Checkpoints");
    });

    await expect(
      cleanupExpiredSessions(repository, checkpointStore, {
        policy: { enabled: false, days: defaultSessionRetentionDays },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: new AbortController().signal,
      }),
    ).resolves.toEqual({
      outcome: "disabled",
      scanned: 0,
      expired: 0,
      protected: 0,
      deletedSessions: 0,
      deletedCheckpoints: 0,
      failedSessions: 0,
      failedCheckpoints: 0,
      removedSessionIds: [],
    });
    expect(deleted).toEqual([]);
    expect(listedCandidates).toBe(0);
  });

  it("handles an empty repository without a cleanup error", async () => {
    const { repository } = createRepository([]);

    await expect(
      cleanupExpiredSessions(repository, undefined, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: new AbortController().signal,
      }),
    ).resolves.toMatchObject({
      outcome: "completed",
      scanned: 0,
      expired: 0,
      deletedSessions: 0,
      deletedCheckpoints: 0,
    });
  });

  it("protects Sessions that are running or being recovered", async () => {
    const candidates = (
      ["idle", "preparing", "streaming", "awaiting_approval", "executing_tool"] as const
    ).map((status) => candidate(status, "2026-01-01T00:00:00.000Z", status));
    const { repository, deleted } = createRepository(candidates);

    const report = await cleanupExpiredSessions(repository, undefined, {
      policy: { enabled: true, days: 30 },
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      signal: new AbortController().signal,
      candidates,
    });

    expect(report.protected).toBe(5);
    expect(report.expired).toBe(0);
    expect(deleted).toEqual([]);
  });

  it("processes a large bounded set and rejects an over-limit scan", async () => {
    const candidates = Array.from({ length: maxSessionRecords }, (_, index) =>
      candidate(`session-${index}`, "2026-01-01T00:00:00.000Z"),
    );
    let batchCalls = 0;
    let batchOwnerCount = 0;
    const { repository } = createRepository(candidates);
    const checkpointStore = createCheckpointStore((sessionIds) => {
      batchCalls += 1;
      batchOwnerCount = sessionIds.length;
      return { deleted: sessionIds.length, failed: 0 };
    });

    await expect(
      cleanupExpiredSessions(repository, checkpointStore, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: new AbortController().signal,
        candidates,
      }),
    ).resolves.toMatchObject({
      scanned: maxSessionRecords,
      expired: maxSessionRecords,
      deletedSessions: maxSessionRecords,
      deletedCheckpoints: maxSessionRecords,
    });
    expect(batchCalls).toBe(1);
    expect(batchOwnerCount).toBe(maxSessionRecords);

    const overLimit = [...candidates, candidate("over-limit", "2026-01-01T00:00:00.000Z")];
    const overLimitRepository = createRepository(overLimit);
    await expect(
      cleanupExpiredSessions(overLimitRepository.repository, undefined, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: new AbortController().signal,
        candidates: overLimit,
      }),
    ).rejects.toThrow("10000-Session limit");
    expect(overLimitRepository.deleted).toEqual([]);
  });

  it("reports Session and Checkpoint cleanup failures while continuing", async () => {
    const candidates = [
      candidate("failed-session", "2026-01-01T00:00:00.000Z"),
      candidate("checkpoint-failure", "2026-01-01T00:00:00.000Z"),
      candidate("success", "2026-01-01T00:00:00.000Z"),
    ];
    const { repository, deleted } = createRepository(candidates, {
      delete: async (sessionId) => {
        if (sessionId === "failed-session") {
          throw new Error("Session delete failed");
        }
        return true;
      },
    });
    const checkpointStore = createCheckpointStore((sessionIds) => ({
      deleted: 1,
      failed: sessionIds.includes("checkpoint-failure") ? 1 : 0,
    }));

    await expect(
      cleanupExpiredSessions(repository, checkpointStore, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: new AbortController().signal,
        candidates,
      }),
    ).resolves.toMatchObject({
      expired: 3,
      deletedSessions: 2,
      failedSessions: 1,
      deletedCheckpoints: 1,
      failedCheckpoints: 1,
    });
    expect(deleted).toEqual(["checkpoint-failure", "success"]);
  });

  it("honors cancellation before scanning and during deletion", async () => {
    const beforeController = new AbortController();
    const beforeReason = new Error("retention cancelled before scan");
    beforeController.abort(beforeReason);
    const before = createRepository([candidate("expired", "2026-01-01T00:00:00.000Z")]);
    await expect(
      cleanupExpiredSessions(before.repository, undefined, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: beforeController.signal,
      }),
    ).rejects.toBe(beforeReason);
    expect(before.deleted).toEqual([]);

    const duringController = new AbortController();
    const duringReason = new Error("retention cancelled during deletion");
    const during = createRepository(
      [
        candidate("first", "2026-01-01T00:00:00.000Z"),
        candidate("second", "2026-01-01T00:00:00.000Z"),
      ],
      {
        delete: async (sessionId) => {
          if (sessionId === "first") {
            duringController.abort(duringReason);
          }
          return true;
        },
      },
    );
    await expect(
      cleanupExpiredSessions(during.repository, undefined, {
        policy: { enabled: true, days: 30 },
        now: () => new Date("2026-08-16T00:00:00.000Z"),
        signal: duringController.signal,
        candidates: during.repository.listRetentionCandidates
          ? await during.repository.listRetentionCandidates()
          : [],
      }),
    ).rejects.toBe(duringReason);
    expect(during.deleted).toEqual(["first"]);
  });

  it("passes only successfully deleted Session owners to Checkpoint cleanup", async () => {
    const candidates = [
      candidate("expired", "2026-01-01T00:00:00.000Z"),
      candidate("protected", "2026-01-01T00:00:00.000Z", "streaming"),
      candidate("fresh", "2026-08-01T00:00:00.000Z"),
    ];
    const { repository } = createRepository(candidates);
    let owners: readonly unknown[] = [];
    const checkpointStore = createCheckpointStore((sessionIds) => {
      owners = sessionIds;
      return { deleted: 2, failed: 0 };
    });

    const report = await cleanupExpiredSessions(repository, checkpointStore, {
      policy: { enabled: true, days: 30 },
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      signal: new AbortController().signal,
      candidates,
    });

    expect(owners).toEqual(["expired"]);
    expect(report.deletedCheckpoints).toBe(2);
  });

  it("leaves Checkpoints untouched when Session deletion reports an absent Session", async () => {
    const candidates = [
      candidate("already-absent", "2026-01-01T00:00:00.000Z"),
      candidate("deleted", "2026-01-01T00:00:00.000Z"),
    ];
    const { repository, deleted } = createRepository(candidates, {
      delete: async (sessionId) => sessionId !== "already-absent",
    });
    let owners: readonly unknown[] = [];
    const checkpointStore = createCheckpointStore((sessionIds) => {
      owners = sessionIds;
      return { deleted: 1, failed: 0 };
    });

    const report = await cleanupExpiredSessions(repository, checkpointStore, {
      policy: { enabled: true, days: 30 },
      now: () => new Date("2026-08-16T00:00:00.000Z"),
      signal: new AbortController().signal,
      candidates,
    });

    expect(deleted).toEqual(["deleted"]);
    expect(owners).toEqual(["deleted"]);
    expect(report).toMatchObject({
      expired: 2,
      deletedSessions: 1,
      failedSessions: 1,
      removedSessionIds: ["deleted"],
    });
  });
});

function candidate(
  sessionId: string,
  updatedAt: string,
  status: SessionStatus = "completed",
): {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
} {
  return { sessionId, status, createdAt: updatedAt, updatedAt };
}

function createRepository(
  candidates: readonly ReturnType<typeof candidate>[],
  options: {
    readonly listCandidates?: () => Promise<readonly ReturnType<typeof candidate>[]>;
    readonly delete?: (sessionId: string) => Promise<boolean>;
  } = {},
): {
  readonly repository: SessionRepository & {
    readonly listRetentionCandidates: () => Promise<readonly ReturnType<typeof candidate>[]>;
  };
  readonly deleted: string[];
  readonly listedCandidates: number;
} {
  const deleted: string[] = [];
  let listedCandidates = 0;
  const repository = {
    async create() {},
    async get() {
      return undefined;
    },
    async list() {
      return candidates.map(({ sessionId, status, createdAt }) => ({
        sessionId,
        status,
        createdAt,
      }));
    },
    async update() {},
    async appendEvent() {},
    async listRetentionCandidates() {
      listedCandidates += 1;
      return options.listCandidates === undefined ? candidates : await options.listCandidates();
    },
    async delete(sessionId: unknown) {
      const id = String(sessionId);
      const result = options.delete === undefined ? true : await options.delete(id);
      if (result) {
        deleted.push(id);
      }
      return result;
    },
  } satisfies SessionRepository & {
    listRetentionCandidates: () => Promise<readonly ReturnType<typeof candidate>[]>;
  };
  return {
    repository,
    deleted,
    get listedCandidates() {
      return listedCandidates;
    },
  };
}

function createCheckpointStore(
  deleteForSessions: (sessionIds: readonly string[]) => {
    readonly deleted: number;
    readonly failed: number;
  },
): CheckpointStore & {
  deleteForSessions: (
    sessionIds: readonly unknown[],
    signal: AbortSignal,
  ) => Promise<{ readonly deleted: number; readonly failed: number }>;
} {
  return {
    async create() {
      throw new Error("unused");
    },
    async read() {
      return undefined;
    },
    async list() {
      return [];
    },
    async deleteForSessions(sessionIds) {
      return deleteForSessions(sessionIds.map(String));
    },
  };
}
