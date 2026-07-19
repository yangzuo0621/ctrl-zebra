import {
  getSessionPersistencePaths,
  type PersistedEventRecord,
  persistedEventRecordSchema,
} from "@ctrl-zebra/protocol";

import type { PersistencePath } from "./manifest-store.js";

export const maxEventRecordBytes = 1_048_576;
export const maxEventLogBytes = 16_777_216;
export const maxEventRecords = 10_000;

export interface EventStorage {
  readText(path: PersistencePath, maxBytes: number): Promise<string | undefined>;
  /** Atomically appends the complete content or leaves the file unchanged. */
  appendText(path: PersistencePath, content: string, maxTotalBytes: number): Promise<void>;
}

export interface EventStoreReadResult {
  readonly records: readonly PersistedEventRecord[];
  readonly tailDamaged: boolean;
}

export interface EventStore {
  append(sessionId: unknown, record: unknown): Promise<void>;
  read(sessionId: unknown): Promise<EventStoreReadResult>;
}

export type CorruptEventLogReason = "invalid-record" | "invalid-sequence";

export class CorruptEventLogError extends Error {
  constructor(
    readonly reason: CorruptEventLogReason,
    readonly lineNumber: number,
  ) {
    super("The persisted Session event log is corrupt.");
    this.name = "CorruptEventLogError";
  }
}

export class InvalidPersistedEventError extends Error {
  constructor() {
    super("The persisted Session event is invalid.");
    this.name = "InvalidPersistedEventError";
  }
}

export class InvalidEventSequenceError extends Error {
  constructor(
    readonly expected: number,
    readonly actual: number,
  ) {
    super(`Expected event sequence ${expected}, received ${actual}.`);
    this.name = "InvalidEventSequenceError";
  }
}

export class EventLogLimitExceededError extends Error {
  constructor(readonly limit: "record-bytes" | "records") {
    super("The persisted Session event log exceeds its configured limit.");
    this.name = "EventLogLimitExceededError";
  }
}

export class JsonlEventStore implements EventStore {
  readonly #storage: EventStorage;

  constructor(storage: EventStorage) {
    this.#storage = storage;
  }

  async append(sessionId: unknown, record: unknown): Promise<void> {
    const result = persistedEventRecordSchema.safeParse(record);
    if (!result.success) {
      throw new InvalidPersistedEventError();
    }

    const existing = await this.read(sessionId);
    if (existing.tailDamaged) {
      throw new CorruptEventLogError("invalid-record", existing.records.length + 1);
    }

    if (existing.records.length >= maxEventRecords) {
      throw new EventLogLimitExceededError("records");
    }

    const expectedSequence = existing.records.length + 1;
    if (result.data.sequence !== expectedSequence) {
      throw new InvalidEventSequenceError(expectedSequence, result.data.sequence);
    }

    const content = `${JSON.stringify(result.data)}\n`;
    if (utf8ByteLength(content) > maxEventRecordBytes) {
      throw new EventLogLimitExceededError("record-bytes");
    }

    const path = getSessionPersistencePaths(sessionId).events;
    await this.#storage.appendText(path, content, maxEventLogBytes);
  }

  async read(sessionId: unknown): Promise<EventStoreReadResult> {
    const path = getSessionPersistencePaths(sessionId).events;
    const content = await this.#storage.readText(path, maxEventLogBytes);
    if (content === undefined) {
      return { records: [], tailDamaged: false };
    }

    const lines = content
      .split(/\r?\n/)
      .map((text, index) => ({ text, lineNumber: index + 1 }))
      .filter(({ text }) => text.trim().length > 0);
    if (lines.length > maxEventRecords) {
      throw new EventLogLimitExceededError("records");
    }

    const records: PersistedEventRecord[] = [];
    for (const [index, line] of lines.entries()) {
      const result = parseRecord(line.text);
      if (result === undefined) {
        if (index === lines.length - 1) {
          return { records, tailDamaged: true };
        }
        throw new CorruptEventLogError("invalid-record", line.lineNumber);
      }

      const expectedSequence = records.length + 1;
      if (result.sequence !== expectedSequence) {
        throw new CorruptEventLogError("invalid-sequence", line.lineNumber);
      }
      records.push(result);
    }

    return { records, tailDamaged: false };
  }
}

function parseRecord(line: string): PersistedEventRecord | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line) as unknown;
  } catch {
    return undefined;
  }

  const result = persistedEventRecordSchema.safeParse(value);
  return result.success ? result.data : undefined;
}

function utf8ByteLength(value: string): number {
  let length = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint === undefined) {
      continue;
    }
    length += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return length;
}
