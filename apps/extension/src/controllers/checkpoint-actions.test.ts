import type { CheckpointStore } from "@ctrl-zebra/core";
import type { Checkpoint } from "@ctrl-zebra/protocol";
import { describe, expect, it, vi } from "vitest";

import { CheckpointRestoreConflictError } from "../adapters/checkpoint-restorer.js";
import { CheckpointActionError, createCheckpointActions } from "./checkpoint-actions.js";

const checkpoint: Checkpoint = {
  id: "checkpoint-1",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T10:00:00.000Z",
  files: [
    {
      uri: "file:///workspace/file.ts",
      beforeContent: "sensitive content",
      beforeHash: "a".repeat(64),
      afterHash: "b".repeat(64),
    },
  ],
};

describe("Checkpoint actions", () => {
  it("lists summaries without exposing before-content", async () => {
    const store = fakeStore();
    const actions = createCheckpointActions({ selectStore: async () => store, restore: vi.fn() });

    const summaries = await actions.list(new AbortController().signal);

    expect(summaries).toEqual([
      {
        id: checkpoint.id,
        sessionId: checkpoint.sessionId,
        runId: checkpoint.runId,
        createdAt: checkpoint.createdAt,
        files: [
          {
            uri: checkpoint.files[0].uri,
            beforeHash: checkpoint.files[0].beforeHash,
            afterHash: checkpoint.files[0].afterHash,
          },
        ],
      },
    ]);
    expect(JSON.stringify(summaries)).not.toContain("sensitive content");
  });

  it("maps a restore conflict to a stable UI error", async () => {
    const actions = createCheckpointActions({
      selectStore: async () => fakeStore(),
      restore: async () => {
        throw new CheckpointRestoreConflictError();
      },
    });

    const error = await actions
      .restore(checkpoint.id, new AbortController().signal)
      .catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(CheckpointActionError);
    expect(error).toMatchObject({ code: "conflict" });
  });
});

function fakeStore(): CheckpointStore {
  return {
    create: async () => checkpoint,
    read: async () => checkpoint,
    list: async () => [checkpoint],
  };
}
