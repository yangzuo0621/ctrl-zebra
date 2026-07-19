import {
  getSessionPersistencePaths,
  persistenceFormatVersion,
  type SessionManifest,
} from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import {
  AtomicManifestStore,
  InvalidSessionManifestError,
  type ManifestStorage,
  type PersistencePath,
} from "./manifest-store.js";

const initialManifest = {
  formatVersion: persistenceFormatVersion,
  sessionId: "session-1",
  status: "idle",
  createdAt: "2026-07-19T10:00:00+08:00",
  updatedAt: "2026-07-19T10:00:00+08:00",
  lastEventSequence: 0,
} satisfies SessionManifest;

describe("AtomicManifestStore", () => {
  it("writes a temporary file, renames it, and reads the committed manifest", async () => {
    const storage = new FakeManifestStorage();
    const store = new AtomicManifestStore(storage);

    await store.write(initialManifest);

    expect(storage.operations).toEqual([
      "write:sessions/v1/73657373696f6e2d31/manifest.json.tmp",
      "rename:sessions/v1/73657373696f6e2d31/manifest.json.tmp->sessions/v1/73657373696f6e2d31/manifest.json",
    ]);
    await expect(store.read(initialManifest.sessionId)).resolves.toEqual(initialManifest);
  });

  it("atomically replaces an existing manifest", async () => {
    const storage = new FakeManifestStorage();
    const store = new AtomicManifestStore(storage);
    await store.write(initialManifest);
    const updatedManifest = {
      ...initialManifest,
      status: "completed",
      updatedAt: "2026-07-19T10:05:00+08:00",
      lastEventSequence: 4,
    } satisfies SessionManifest;

    await store.write(updatedManifest);

    await expect(store.read(initialManifest.sessionId)).resolves.toEqual(updatedManifest);
    expect(storage.files.has(manifestTemporaryKey())).toBe(false);
  });

  it("does not rename or replace the manifest when the temporary write fails", async () => {
    const storage = new FakeManifestStorage();
    const originalContent = `${JSON.stringify(initialManifest)}\n`;
    storage.files.set(manifestKey(), originalContent);
    storage.writeFailure = new Error("temporary write failed");
    const store = new AtomicManifestStore(storage);

    await expect(store.write({ ...initialManifest, status: "completed" })).rejects.toBe(
      storage.writeFailure,
    );

    expect(storage.files.get(manifestKey())).toBe(originalContent);
    expect(storage.files.has(manifestTemporaryKey())).toBe(false);
    expect(storage.operations.some((operation) => operation.startsWith("rename:"))).toBe(false);
  });

  it("preserves the committed manifest and cleans the temp file when rename fails", async () => {
    const storage = new FakeManifestStorage();
    const originalContent = `${JSON.stringify(initialManifest)}\n`;
    storage.files.set(manifestKey(), originalContent);
    storage.renameFailure = new Error("rename failed");
    const store = new AtomicManifestStore(storage);

    await expect(store.write({ ...initialManifest, status: "completed" })).rejects.toBe(
      storage.renameFailure,
    );

    expect(storage.files.get(manifestKey())).toBe(originalContent);
    expect(storage.files.has(manifestTemporaryKey())).toBe(false);
    expect(storage.operations.at(-1)).toBe(`delete:${manifestTemporaryKey()}`);
  });

  it.each([
    ["invalid-json", "not JSON"],
    ["invalid-schema", JSON.stringify({ ...initialManifest, formatVersion: 2 })],
    ["session-mismatch", JSON.stringify({ ...initialManifest, sessionId: "session-2" })],
  ] as const)("rejects a persisted manifest with %s", async (reason, content) => {
    const storage = new FakeManifestStorage();
    storage.files.set(manifestKey(), content);
    const store = new AtomicManifestStore(storage);

    const error = await store.read(initialManifest.sessionId).catch((failure: unknown) => failure);

    expect(error).toBeInstanceOf(InvalidSessionManifestError);
    expect(error).toMatchObject({ reason });
  });

  it("rejects an invalid manifest before creating a temporary file", async () => {
    const storage = new FakeManifestStorage();
    const store = new AtomicManifestStore(storage);

    await expect(store.write({ ...initialManifest, unexpected: true })).rejects.toMatchObject({
      name: "InvalidSessionManifestError",
      reason: "invalid-schema",
    });
    expect(storage.operations).toEqual([]);
  });
});

class FakeManifestStorage implements ManifestStorage {
  readonly files = new Map<string, string>();
  readonly operations: string[] = [];
  writeFailure: Error | undefined;
  renameFailure: Error | undefined;

  async readText(path: PersistencePath): Promise<string | undefined> {
    this.operations.push(`read:${pathKey(path)}`);
    return this.files.get(pathKey(path));
  }

  async writeText(path: PersistencePath, content: string): Promise<void> {
    const key = pathKey(path);
    this.operations.push(`write:${key}`);
    this.files.set(key, content);
    if (this.writeFailure !== undefined) {
      throw this.writeFailure;
    }
  }

  async rename(source: PersistencePath, destination: PersistencePath): Promise<void> {
    const sourceKey = pathKey(source);
    const destinationKey = pathKey(destination);
    this.operations.push(`rename:${sourceKey}->${destinationKey}`);
    if (this.renameFailure !== undefined) {
      throw this.renameFailure;
    }

    const content = this.files.get(sourceKey);
    if (content === undefined) {
      throw new Error("missing rename source");
    }

    this.files.set(destinationKey, content);
    this.files.delete(sourceKey);
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    const key = pathKey(path);
    this.operations.push(`delete:${key}`);
    this.files.delete(key);
  }
}

function pathKey(path: PersistencePath): string {
  return path.join("/");
}

function manifestKey(): string {
  return pathKey(getSessionPersistencePaths(initialManifest.sessionId).manifest);
}

function manifestTemporaryKey(): string {
  return `${pathKey(getSessionPersistencePaths(initialManifest.sessionId).directory)}/manifest.json.tmp`;
}
