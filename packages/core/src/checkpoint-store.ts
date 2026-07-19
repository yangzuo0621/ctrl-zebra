import {
  type Checkpoint,
  getCheckpointPersistencePaths,
  InvalidCheckpointIntegrityError,
  parseCheckpoint,
} from "@ctrl-zebra/protocol";

import type { PersistencePath } from "./manifest-store.js";

export const maxCheckpointRecordBytes = 4_194_304;
export const maxCheckpointRecords = 10_000;

export interface CheckpointStorage {
  exists(path: PersistencePath): Promise<boolean>;
  readText(path: PersistencePath, maxBytes: number): Promise<string | undefined>;
  listFiles(directory: PersistencePath, maxFiles: number): Promise<readonly string[]>;
  writeText(path: PersistencePath, content: string, maxBytes: number): Promise<void>;
  /** Atomically moves source to a destination that must not already exist. */
  commit(source: PersistencePath, destination: PersistencePath): Promise<void>;
  deleteFile(path: PersistencePath): Promise<void>;
}

export interface CheckpointStore {
  create(checkpoint: unknown, signal: AbortSignal): Promise<Checkpoint>;
  read(checkpointId: unknown, signal: AbortSignal): Promise<Checkpoint | undefined>;
  list(signal: AbortSignal): Promise<readonly Checkpoint[]>;
}

export type InvalidCheckpointReason = "invalid-schema" | "integrity" | "too-large" | "id-mismatch";

export class InvalidCheckpointError extends Error {
  constructor(readonly reason: InvalidCheckpointReason) {
    super("The Checkpoint is invalid and was not persisted.");
    this.name = "InvalidCheckpointError";
  }
}

export class DuplicateCheckpointError extends Error {
  constructor() {
    super("The Checkpoint identifier is already persisted.");
    this.name = "DuplicateCheckpointError";
  }
}

export class AtomicCheckpointStore implements CheckpointStore {
  readonly #storage: CheckpointStorage;
  readonly #hashText: (text: string) => string;

  constructor(storage: CheckpointStorage, hashText: (text: string) => string) {
    this.#storage = storage;
    this.#hashText = hashText;
  }

  async create(value: unknown, signal: AbortSignal): Promise<Checkpoint> {
    signal.throwIfAborted();
    const checkpoint = this.#parse(value);
    const paths = getCheckpointPersistencePaths(checkpoint.id);
    const temporaryPath = [...paths.directory, `${paths.checkpoint.at(-1)}.tmp`] as PersistencePath;
    const content = `${JSON.stringify(checkpoint)}\n`;
    if (utf8ByteLength(content) > maxCheckpointRecordBytes) {
      throw new InvalidCheckpointError("too-large");
    }
    if (await this.#storage.exists(paths.checkpoint)) {
      throw new DuplicateCheckpointError();
    }

    signal.throwIfAborted();
    try {
      await this.#storage.writeText(temporaryPath, content, maxCheckpointRecordBytes);
      signal.throwIfAborted();
      await this.#storage.commit(temporaryPath, paths.checkpoint);
      return checkpoint;
    } catch (error) {
      await this.#deleteTemporaryFile(temporaryPath);
      throw error;
    }
  }

  async read(checkpointId: unknown, signal: AbortSignal): Promise<Checkpoint | undefined> {
    signal.throwIfAborted();
    const paths = getCheckpointPersistencePaths(checkpointId);
    const content = await this.#storage.readText(paths.checkpoint, maxCheckpointRecordBytes);
    signal.throwIfAborted();
    if (content === undefined) {
      return undefined;
    }

    const checkpoint = this.#parseJson(content);
    if (checkpoint.id !== checkpointId) {
      throw new InvalidCheckpointError("id-mismatch");
    }
    return checkpoint;
  }

  async list(signal: AbortSignal): Promise<readonly Checkpoint[]> {
    signal.throwIfAborted();
    const directory = getCheckpointPersistencePaths("index").directory;
    const names = await this.#storage.listFiles(directory, maxCheckpointRecords);
    const checkpoints: Checkpoint[] = [];
    for (const name of names) {
      signal.throwIfAborted();
      if (!name.endsWith(".json")) {
        continue;
      }
      const content = await this.#storage.readText(
        [...directory, name] as PersistencePath,
        maxCheckpointRecordBytes,
      );
      if (content === undefined) {
        continue;
      }
      const checkpoint = this.#parseJson(content);
      if (getCheckpointPersistencePaths(checkpoint.id).checkpoint.at(-1) !== name) {
        throw new InvalidCheckpointError("id-mismatch");
      }
      checkpoints.push(checkpoint);
    }
    return checkpoints.sort(
      (left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || left.id.localeCompare(right.id),
    );
  }

  #parse(value: unknown): Checkpoint {
    try {
      return parseCheckpoint(value, this.#hashText);
    } catch (error) {
      throw new InvalidCheckpointError(
        error instanceof InvalidCheckpointIntegrityError ? "integrity" : "invalid-schema",
      );
    }
  }

  #parseJson(content: string): Checkpoint {
    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      throw new InvalidCheckpointError("invalid-schema");
    }
    return this.#parse(value);
  }

  async #deleteTemporaryFile(path: PersistencePath): Promise<void> {
    try {
      await this.#storage.deleteFile(path);
    } catch {
      // Preserve the primary creation failure; the storage owner may clean stale temp files.
    }
  }
}

function utf8ByteLength(value: string): number {
  let bytes = 0;
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0;
    bytes += codePoint <= 0x7f ? 1 : codePoint <= 0x7ff ? 2 : codePoint <= 0xffff ? 3 : 4;
  }
  return bytes;
}
