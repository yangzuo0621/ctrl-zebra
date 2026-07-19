import { persistenceFormatVersion, type SessionManifest } from "@ctrl-zebra/protocol";
import { describe, expect, it } from "vitest";

import { type EventStorage, JsonlEventStore, maxEventLogBytes } from "./event-store.js";
import {
  AtomicManifestStore,
  type ManifestStorage,
  type PersistencePath,
} from "./manifest-store.js";
import {
  DuplicateSessionError,
  InconsistentSessionRecordError,
  InMemorySessionRepository,
  PersistedSessionRepository,
  type SessionCatalog,
  SessionNotFoundError,
  type SessionRepository,
} from "./session-repository.js";

const manifest = {
  formatVersion: persistenceFormatVersion,
  sessionId: "session-1",
  status: "idle",
  createdAt: "2026-07-19T10:00:00+08:00",
  updatedAt: "2026-07-19T10:00:00+08:00",
  lastEventSequence: 0,
} satisfies SessionManifest;

const firstEvent = {
  sequence: 1,
  recordedAt: "2026-07-19T10:01:00+08:00",
  event: { type: "session.status-changed", data: { status: "preparing" } },
} as const;

const factories = [
  ["in-memory", () => new InMemorySessionRepository()],
  ["persisted", () => createPersistedHarness().repository],
] as const satisfies readonly [string, () => SessionRepository][];

describe.each(factories)("SessionRepository contract: %s", (_name, createRepository) => {
  it("creates, gets, and lists a Session", async () => {
    const repository = createRepository();

    await repository.create(manifest);

    await expect(repository.get(manifest.sessionId)).resolves.toEqual({
      manifest,
      events: [],
      eventLogTailDamaged: false,
    });
    await expect(repository.list()).resolves.toEqual([
      { sessionId: manifest.sessionId, status: "idle", createdAt: manifest.createdAt },
    ]);
  });

  it("updates metadata and appends an event", async () => {
    const repository = createRepository();
    await repository.create(manifest);

    await repository.update(manifest.sessionId, {
      status: "preparing",
      updatedAt: "2026-07-19T10:00:30+08:00",
    });
    await repository.appendEvent(manifest.sessionId, firstEvent);

    await expect(repository.get(manifest.sessionId)).resolves.toMatchObject({
      manifest: {
        status: "preparing",
        updatedAt: firstEvent.recordedAt,
        lastEventSequence: 1,
      },
      events: [firstEvent],
      eventLogTailDamaged: false,
    });
  });

  it("rejects duplicate creation and operations on a missing Session", async () => {
    const repository = createRepository();
    await repository.create(manifest);

    await expect(repository.create(manifest)).rejects.toBeInstanceOf(DuplicateSessionError);
    await expect(
      repository.update("missing-session", { status: "failed", updatedAt: manifest.updatedAt }),
    ).rejects.toBeInstanceOf(SessionNotFoundError);
    await expect(repository.appendEvent("missing-session", firstEvent)).rejects.toBeInstanceOf(
      SessionNotFoundError,
    );
  });

  it("rejects a new Session whose manifest claims existing events", async () => {
    const repository = createRepository();

    await expect(repository.create({ ...manifest, lastEventSequence: 1 })).rejects.toBeInstanceOf(
      InconsistentSessionRecordError,
    );
    await expect(repository.list()).resolves.toEqual([]);
  });
});

describe("PersistedSessionRepository", () => {
  it("rejects a committed manifest whose event sequence does not match its log", async () => {
    const harness = createPersistedHarness();
    await harness.repository.create(manifest);
    await harness.manifests.write({ ...manifest, lastEventSequence: 1 });

    await expect(harness.repository.get(manifest.sessionId)).rejects.toBeInstanceOf(
      InconsistentSessionRecordError,
    );
  });
});

function createPersistedHarness() {
  const storage = new FakeSessionStorage();
  const manifests = new AtomicManifestStore(storage);
  const events = new JsonlEventStore(storage);
  const catalog: SessionCatalog = { listSessionIds: async () => [...storage.sessionIds] };
  return {
    manifests,
    repository: new PersistedSessionRepository(manifests, events, catalog),
  };
}

class FakeSessionStorage implements ManifestStorage, EventStorage {
  readonly files = new Map<string, string>();
  readonly sessionIds = new Set<string>();

  async readText(path: PersistencePath, _maxBytes?: number): Promise<string | undefined> {
    return this.files.get(pathKey(path));
  }

  async writeText(path: PersistencePath, content: string): Promise<void> {
    this.files.set(pathKey(path), content);
  }

  async rename(source: PersistencePath, destination: PersistencePath): Promise<void> {
    const content = this.files.get(pathKey(source));
    if (content === undefined) {
      throw new Error("missing rename source");
    }
    this.files.set(pathKey(destination), content);
    this.files.delete(pathKey(source));
    const parsed = JSON.parse(content) as { sessionId?: unknown };
    if (typeof parsed.sessionId === "string") {
      this.sessionIds.add(parsed.sessionId);
    }
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    this.files.delete(pathKey(path));
  }

  async appendText(path: PersistencePath, content: string, maxTotalBytes: number): Promise<void> {
    expect(maxTotalBytes).toBe(maxEventLogBytes);
    this.files.set(pathKey(path), `${this.files.get(pathKey(path)) ?? ""}${content}`);
  }
}

function pathKey(path: PersistencePath): string {
  return path.join("/");
}
