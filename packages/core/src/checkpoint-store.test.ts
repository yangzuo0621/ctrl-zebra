import type { Checkpoint } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  AtomicCheckpointStore,
  type CheckpointStorage,
  DuplicateCheckpointError,
  type InvalidCheckpointError,
  maxCheckpointRecordBytes,
  type PersistencePath,
} from "./index.js";

const beforeHash = "a".repeat(64);
const checkpoint = {
  id: "checkpoint-1",
  sessionId: "session-1",
  runId: "run-1",
  createdAt: "2026-07-19T16:00:00+08:00",
  files: [
    {
      uri: "file:///workspace/file.ts",
      beforeContent: "before\n",
      beforeHash,
      afterHash: "b".repeat(64),
    },
  ],
} satisfies Checkpoint;

describe("AtomicCheckpointStore", () => {
  it("durably commits a validated Checkpoint through a temporary file", async () => {
    const storage = new FakeCheckpointStorage();
    const store = createStore(storage);

    await expect(store.create(checkpoint, new AbortController().signal)).resolves.toEqual(
      checkpoint,
    );

    expect(storage.operations).toEqual([
      "exists:checkpoints/v1/636865636b706f696e742d31.json",
      "write:checkpoints/v1/636865636b706f696e742d31.json.tmp",
      "commit:checkpoints/v1/636865636b706f696e742d31.json.tmp->checkpoints/v1/636865636b706f696e742d31.json",
    ]);
    expect(storage.files.get("checkpoints/v1/636865636b706f696e742d31.json")).toBe(
      `${JSON.stringify(checkpoint)}\n`,
    );
    await expect(store.read(checkpoint.id, new AbortController().signal)).resolves.toEqual(
      checkpoint,
    );
  });

  it("rejects an existing Checkpoint ID without writing", async () => {
    const storage = new FakeCheckpointStorage();
    storage.files.set("checkpoints/v1/636865636b706f696e742d31.json", "existing");
    const store = createStore(storage);

    await expect(store.create(checkpoint, new AbortController().signal)).rejects.toBeInstanceOf(
      DuplicateCheckpointError,
    );
    expect(storage.operations).toEqual(["exists:checkpoints/v1/636865636b706f696e742d31.json"]);
  });

  it("rejects invalid integrity and oversized content before storage", async () => {
    const storage = new FakeCheckpointStorage();
    const store = createStore(storage);

    await expect(
      store.create(
        { ...checkpoint, files: [{ ...checkpoint.files[0], beforeHash: "c".repeat(64) }] },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject<InvalidCheckpointError>({ reason: "integrity" });
    await expect(
      store.create(
        {
          ...checkpoint,
          id: "checkpoint-large",
          files: [
            {
              ...checkpoint.files[0],
              beforeContent: "x".repeat(maxCheckpointRecordBytes),
              beforeHash: "c".repeat(64),
            },
          ],
        },
        new AbortController().signal,
      ),
    ).rejects.toMatchObject<InvalidCheckpointError>({ reason: "too-large" });
    expect(storage.operations).toEqual([]);
  });

  it("cleans the temporary file and preserves the creation failure", async () => {
    const storage = new FakeCheckpointStorage();
    storage.commitFailure = new Error("commit failed");
    const store = createStore(storage);

    await expect(store.create(checkpoint, new AbortController().signal)).rejects.toBe(
      storage.commitFailure,
    );
    expect(storage.operations.at(-1)).toBe(
      "delete:checkpoints/v1/636865636b706f696e742d31.json.tmp",
    );
    expect(storage.files.has("checkpoints/v1/636865636b706f696e742d31.json")).toBe(false);
  });

  it("performs no storage operation when already cancelled", async () => {
    const storage = new FakeCheckpointStorage();
    const store = createStore(storage);
    const controller = new AbortController();
    const cancellation = new Error("cancel Checkpoint");
    controller.abort(cancellation);

    await expect(store.create(checkpoint, controller.signal)).rejects.toBe(cancellation);
    expect(storage.operations).toEqual([]);
  });

  it("rejects corrupt, mismatched, and integrity-damaged persisted Checkpoints", async () => {
    const storage = new FakeCheckpointStorage();
    const store = createStore(storage);
    const key = "checkpoints/v1/636865636b706f696e742d31.json";

    storage.files.set(key, "not JSON");
    await expect(store.read(checkpoint.id, new AbortController().signal)).rejects.toMatchObject({
      reason: "invalid-schema",
    });
    storage.files.set(key, JSON.stringify({ ...checkpoint, id: "checkpoint-2" }));
    await expect(store.read(checkpoint.id, new AbortController().signal)).rejects.toMatchObject({
      reason: "id-mismatch",
    });
    storage.files.set(
      key,
      JSON.stringify({
        ...checkpoint,
        files: [{ ...checkpoint.files[0], beforeHash: "c".repeat(64) }],
      }),
    );
    await expect(store.read(checkpoint.id, new AbortController().signal)).rejects.toMatchObject({
      reason: "integrity",
    });
  });
});

function createStore(storage: CheckpointStorage): AtomicCheckpointStore {
  return new AtomicCheckpointStore(storage, (text) =>
    text === checkpoint.files[0].beforeContent ? beforeHash : "c".repeat(64),
  );
}

class FakeCheckpointStorage implements CheckpointStorage {
  readonly files = new Map<string, string>();
  readonly operations: string[] = [];
  commitFailure: Error | undefined;

  async exists(path: PersistencePath): Promise<boolean> {
    const key = path.join("/");
    this.operations.push(`exists:${key}`);
    return this.files.has(key);
  }

  async readText(path: PersistencePath, maxBytes: number): Promise<string | undefined> {
    const key = path.join("/");
    this.operations.push(`read:${key}:${maxBytes}`);
    return this.files.get(key);
  }

  async writeText(path: PersistencePath, content: string, maxBytes: number): Promise<void> {
    expect(new TextEncoder().encode(content).byteLength).toBeLessThanOrEqual(maxBytes);
    const key = path.join("/");
    this.operations.push(`write:${key}`);
    this.files.set(key, content);
  }

  async commit(source: PersistencePath, destination: PersistencePath): Promise<void> {
    const sourceKey = source.join("/");
    const destinationKey = destination.join("/");
    this.operations.push(`commit:${sourceKey}->${destinationKey}`);
    if (this.commitFailure !== undefined) {
      throw this.commitFailure;
    }
    if (this.files.has(destinationKey)) {
      throw new Error("destination exists");
    }
    const content = this.files.get(sourceKey);
    if (content === undefined) {
      throw new Error("source missing");
    }
    this.files.set(destinationKey, content);
    this.files.delete(sourceKey);
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    const key = path.join("/");
    this.operations.push(`delete:${key}`);
    this.files.delete(key);
  }
}
