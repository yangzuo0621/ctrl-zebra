import {
  type PersistedEventRecord,
  persistedEventRecordSchema,
  type SessionManifest,
  type SessionStatus,
  type SessionSummary,
  sessionManifestSchema,
  sessionSummarySchema,
} from "@ctrl-zebra/protocol";

import type { EventStore } from "./event-store.js";
import type { ManifestStore } from "./manifest-store.js";

export interface SessionRecord {
  readonly manifest: SessionManifest;
  readonly events: readonly PersistedEventRecord[];
  readonly eventLogTailDamaged: boolean;
}

export interface SessionMetadataPatch {
  readonly status?: SessionStatus;
  readonly updatedAt: string;
}

export interface SessionRepository {
  create(manifest: unknown): Promise<void>;
  get(sessionId: unknown): Promise<SessionRecord | undefined>;
  list(): Promise<readonly SessionSummary[]>;
  update(sessionId: unknown, patch: SessionMetadataPatch): Promise<void>;
  appendEvent(sessionId: unknown, record: unknown): Promise<void>;
}

export interface SessionCatalog {
  listSessionIds(): Promise<readonly string[]>;
}

export class DuplicateSessionError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session "${sessionId}" already exists.`);
    this.name = "DuplicateSessionError";
  }
}

export class SessionNotFoundError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session "${sessionId}" does not exist.`);
    this.name = "SessionNotFoundError";
  }
}

export class InconsistentSessionRecordError extends Error {
  constructor(readonly sessionId: string) {
    super(`Session "${sessionId}" has inconsistent persisted metadata and events.`);
    this.name = "InconsistentSessionRecordError";
  }
}

export class InMemorySessionRepository implements SessionRepository {
  readonly #records = new Map<string, SessionRecord>();

  async create(manifest: unknown): Promise<void> {
    const parsed = parseInitialManifest(manifest);
    if (this.#records.has(parsed.sessionId)) {
      throw new DuplicateSessionError(parsed.sessionId);
    }
    this.#records.set(parsed.sessionId, {
      manifest: parsed,
      events: [],
      eventLogTailDamaged: false,
    });
  }

  async get(sessionId: unknown): Promise<SessionRecord | undefined> {
    const id = parseSessionId(sessionId);
    const record = this.#records.get(id);
    return record === undefined ? undefined : cloneRecord(record);
  }

  async list(): Promise<readonly SessionSummary[]> {
    return [...this.#records.values()].map(({ manifest }) => toSummary(manifest));
  }

  async update(sessionId: unknown, patch: SessionMetadataPatch): Promise<void> {
    const current = await this.#require(sessionId);
    const manifest = sessionManifestSchema.parse({ ...current.manifest, ...patch });
    this.#records.set(manifest.sessionId, { ...current, manifest });
  }

  async appendEvent(sessionId: unknown, record: unknown): Promise<void> {
    const current = await this.#require(sessionId);
    const event = persistedEventRecordSchema.parse(record);
    const expected = current.events.length + 1;
    if (event.sequence !== expected) {
      throw new InconsistentSessionRecordError(current.manifest.sessionId);
    }
    const manifest = sessionManifestSchema.parse({
      ...current.manifest,
      updatedAt: event.recordedAt,
      lastEventSequence: event.sequence,
    });
    this.#records.set(manifest.sessionId, {
      manifest,
      events: [...current.events, event],
      eventLogTailDamaged: false,
    });
  }

  async #require(sessionId: unknown): Promise<SessionRecord> {
    const id = parseSessionId(sessionId);
    const record = this.#records.get(id);
    if (record === undefined) {
      throw new SessionNotFoundError(id);
    }
    return record;
  }
}

export class PersistedSessionRepository implements SessionRepository {
  readonly #manifests: ManifestStore;
  readonly #events: EventStore;
  readonly #catalog: SessionCatalog;

  constructor(manifests: ManifestStore, events: EventStore, catalog: SessionCatalog) {
    this.#manifests = manifests;
    this.#events = events;
    this.#catalog = catalog;
  }

  async create(manifest: unknown): Promise<void> {
    const parsed = parseInitialManifest(manifest);
    if ((await this.#manifests.read(parsed.sessionId)) !== undefined) {
      throw new DuplicateSessionError(parsed.sessionId);
    }
    await this.#manifests.write(parsed);
  }

  async get(sessionId: unknown): Promise<SessionRecord | undefined> {
    const manifest = await this.#manifests.read(sessionId);
    if (manifest === undefined) {
      return undefined;
    }
    const result = await this.#events.read(manifest.sessionId);
    const lastSequence = result.records.at(-1)?.sequence ?? 0;
    if (!result.tailDamaged && manifest.lastEventSequence !== lastSequence) {
      throw new InconsistentSessionRecordError(manifest.sessionId);
    }
    return {
      manifest,
      events: result.records,
      eventLogTailDamaged: result.tailDamaged,
    };
  }

  async list(): Promise<readonly SessionSummary[]> {
    const summaries: SessionSummary[] = [];
    for (const sessionId of await this.#catalog.listSessionIds()) {
      const manifest = await this.#manifests.read(sessionId);
      if (manifest !== undefined) {
        summaries.push(toSummary(manifest));
      }
    }
    return summaries;
  }

  async update(sessionId: unknown, patch: SessionMetadataPatch): Promise<void> {
    const current = await this.#require(sessionId);
    await this.#manifests.write(sessionManifestSchema.parse({ ...current.manifest, ...patch }));
  }

  async appendEvent(sessionId: unknown, record: unknown): Promise<void> {
    const current = await this.#require(sessionId);
    const event = persistedEventRecordSchema.parse(record);
    await this.#events.append(current.manifest.sessionId, event);
    await this.#manifests.write({
      ...current.manifest,
      updatedAt: event.recordedAt,
      lastEventSequence: event.sequence,
    });
  }

  async #require(sessionId: unknown): Promise<SessionRecord> {
    const record = await this.get(sessionId);
    if (record === undefined) {
      throw new SessionNotFoundError(parseSessionId(sessionId));
    }
    return record;
  }
}

function parseInitialManifest(value: unknown): SessionManifest {
  const manifest = sessionManifestSchema.parse(value);
  if (manifest.lastEventSequence !== 0) {
    throw new InconsistentSessionRecordError(manifest.sessionId);
  }
  return manifest;
}

function parseSessionId(value: unknown): string {
  return sessionManifestSchema.shape.sessionId.parse(value);
}

function toSummary(manifest: SessionManifest): SessionSummary {
  return sessionSummarySchema.parse({
    sessionId: manifest.sessionId,
    status: manifest.status,
    createdAt: manifest.createdAt,
  });
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    manifest: sessionManifestSchema.parse(record.manifest),
    events: record.events.map((event) => persistedEventRecordSchema.parse(event)),
    eventLogTailDamaged: record.eventLogTailDamaged,
  };
}
