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

export const maxSessionRecords = 10_000;

export interface SessionRecord {
  readonly manifest: SessionManifest;
  readonly events: readonly PersistedEventRecord[];
  readonly eventLogTailDamaged: boolean;
  /** Historical pre-multiturn Sessions can be displayed but must never receive new events. */
  readonly readOnly?: boolean;
}

interface SessionRetentionCandidate {
  readonly sessionId: string;
  readonly status: SessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
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
  /** Removes one Session's durable directory and returns whether it existed. */
  delete?(sessionId: unknown): Promise<boolean>;
  /** Removes all durable Session directories and reports successful and failed entries. */
  clear?(): Promise<SessionDeletionReport>;
}

export interface SessionCatalog {
  listSessionIds(): Promise<readonly string[]>;
  /** Removes the exact encoded Session directory. */
  deleteSession?(sessionId: unknown): Promise<boolean>;
  /** Removes all Session directories, including directories with damaged manifests. */
  clearSessions?(): Promise<SessionDeletionReport>;
}

export interface SessionDeletionReport {
  readonly deleted: number;
  readonly failed: number;
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

export class SessionDeletionUnavailableError extends Error {
  constructor() {
    super("Session deletion storage is unavailable.");
    this.name = "SessionDeletionUnavailableError";
  }
}

export class ReadOnlySessionError extends Error {
  constructor(readonly sessionId: string) {
    super(
      `Session "${sessionId}" is read-only because its legacy format cannot be continued safely.`,
    );
    this.name = "ReadOnlySessionError";
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
  // A newly created Session may briefly have a user event before its first lifecycle event.
  readonly #freshSessionIds = new Set<string>();

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
    this.#freshSessionIds.add(parsed.sessionId);
  }

  async get(sessionId: unknown): Promise<SessionRecord | undefined> {
    const id = parseSessionId(sessionId);
    const record = this.#records.get(id);
    if (record === undefined) {
      return undefined;
    }
    if (
      record.readOnly !== true &&
      !this.#freshSessionIds.has(id) &&
      isLegacyReadOnlySession(record.events)
    ) {
      const readOnlyRecord = { ...record, readOnly: true };
      this.#records.set(id, readOnlyRecord);
      return cloneRecord(readOnlyRecord);
    }
    return cloneRecord(record);
  }

  async list(): Promise<readonly SessionSummary[]> {
    return [...this.#records.values()].map(({ manifest }) => toSummary(manifest));
  }

  async update(sessionId: unknown, patch: SessionMetadataPatch): Promise<void> {
    const current = await this.#require(sessionId);
    assertWritable(current);
    const manifest = sessionManifestSchema.parse({ ...current.manifest, ...patch });
    this.#records.set(manifest.sessionId, { ...current, manifest });
  }

  async appendEvent(sessionId: unknown, record: unknown): Promise<void> {
    const current = await this.#require(sessionId);
    assertWritable(current);
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

  async listRetentionCandidates(): Promise<readonly SessionRetentionCandidate[]> {
    if (this.#records.size > maxSessionRecords) {
      throw new RangeError(
        `Persisted Session count exceeds the ${maxSessionRecords}-Session limit.`,
      );
    }
    return [...this.#records.values()].map(({ manifest }) => toRetentionCandidate(manifest));
  }

  async delete(sessionId: unknown): Promise<boolean> {
    const id = parseSessionId(sessionId);
    const deleted = this.#records.delete(id);
    this.#freshSessionIds.delete(id);
    return deleted;
  }

  async clear(): Promise<SessionDeletionReport> {
    const count = this.#records.size;
    this.#records.clear();
    this.#freshSessionIds.clear();
    return { deleted: count, failed: 0 };
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
  // This in-process knowledge prevents a first user event from being mistaken for a legacy read.
  // A restart intentionally loses it, so an incomplete source then fails closed as read-only.
  readonly #freshSessionIds = new Set<string>();

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
    this.#freshSessionIds.add(parsed.sessionId);
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
      ...(!this.#freshSessionIds.has(manifest.sessionId) && isLegacyReadOnlySession(result.records)
        ? { readOnly: true }
        : {}),
    };
  }

  async list(): Promise<readonly SessionSummary[]> {
    const summaries: SessionSummary[] = [];
    const sessionIds = await this.#catalog.listSessionIds();
    if (sessionIds.length > maxSessionRecords) {
      throw new RangeError(
        `Persisted Session count exceeds the ${maxSessionRecords}-Session limit.`,
      );
    }
    for (const sessionId of sessionIds) {
      const manifest = await this.#manifests.read(sessionId);
      if (manifest !== undefined) {
        summaries.push(toSummary(manifest));
      }
    }
    return summaries;
  }

  async listRetentionCandidates(): Promise<readonly SessionRetentionCandidate[]> {
    const sessionIds = await this.#catalog.listSessionIds();
    if (sessionIds.length > maxSessionRecords) {
      throw new RangeError(
        `Persisted Session count exceeds the ${maxSessionRecords}-Session limit.`,
      );
    }
    const candidates: SessionRetentionCandidate[] = [];
    for (const sessionId of sessionIds) {
      const manifest = await this.#manifests.read(sessionId);
      if (manifest !== undefined) {
        candidates.push(toRetentionCandidate(manifest));
      }
    }
    return candidates;
  }

  async update(sessionId: unknown, patch: SessionMetadataPatch): Promise<void> {
    const current = await this.#require(sessionId);
    assertWritable(current);
    await this.#manifests.write(sessionManifestSchema.parse({ ...current.manifest, ...patch }));
  }

  async appendEvent(sessionId: unknown, record: unknown): Promise<void> {
    const current = await this.#require(sessionId);
    assertWritable(current);
    const event = persistedEventRecordSchema.parse(record);
    await this.#events.append(current.manifest.sessionId, event);
    await this.#manifests.write({
      ...current.manifest,
      updatedAt: event.recordedAt,
      lastEventSequence: event.sequence,
    });
  }

  async delete(sessionId: unknown): Promise<boolean> {
    const id = parseSessionId(sessionId);
    if (this.#catalog.deleteSession === undefined) {
      throw new SessionDeletionUnavailableError();
    }
    const deleted = await this.#catalog.deleteSession(id);
    if (deleted) {
      this.#freshSessionIds.delete(id);
    }
    return deleted;
  }

  async clear(): Promise<SessionDeletionReport> {
    if (this.#catalog.clearSessions === undefined) {
      throw new SessionDeletionUnavailableError();
    }
    const report = await this.#catalog.clearSessions();
    if (report.failed === 0) {
      this.#freshSessionIds.clear();
    }
    return report;
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

function toRetentionCandidate(manifest: SessionManifest): SessionRetentionCandidate {
  return {
    sessionId: manifest.sessionId,
    status: manifest.status,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
  };
}

function cloneRecord(record: SessionRecord): SessionRecord {
  return {
    manifest: sessionManifestSchema.parse(record.manifest),
    events: record.events.map((event) => persistedEventRecordSchema.parse(event)),
    eventLogTailDamaged: record.eventLogTailDamaged,
    ...(record.readOnly === true ? { readOnly: true } : {}),
  };
}

/**
 * T1504 added explicit status lifecycle events. Older v1 Sessions have a user message and model
 * output but no status event at all. Their history is still safe to display, but appending a new
 * Run would guess the boundary between the old single turn and the new lifecycle, so they remain
 * read-only until a future explicit migration exists.
 */
export function isLegacyReadOnlySession(events: readonly PersistedEventRecord[]): boolean {
  return (
    events.some(({ event }) => event.type === "session.user-message") &&
    !events.some(({ event }) => event.type === "session.status-changed")
  );
}

function assertWritable(record: SessionRecord): void {
  if (record.readOnly === true) {
    throw new ReadOnlySessionError(record.manifest.sessionId);
  }
}
