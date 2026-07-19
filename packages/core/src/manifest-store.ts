import {
  getSessionPersistencePaths,
  type SessionManifest,
  sessionManifestFileName,
  sessionManifestSchema,
} from "@ctrl-zebra/protocol";

export type PersistencePath = readonly [string, ...string[]];

export interface ManifestStorage {
  readText(path: PersistencePath): Promise<string | undefined>;
  writeText(path: PersistencePath, content: string): Promise<void>;
  /** Atomically replaces the destination when it already exists. */
  rename(source: PersistencePath, destination: PersistencePath): Promise<void>;
  deleteFile(path: PersistencePath): Promise<void>;
}

export interface ManifestStore {
  read(sessionId: unknown): Promise<SessionManifest | undefined>;
  write(manifest: unknown): Promise<void>;
}

export type InvalidSessionManifestReason = "invalid-json" | "invalid-schema" | "session-mismatch";

export class InvalidSessionManifestError extends Error {
  constructor(readonly reason: InvalidSessionManifestReason) {
    super("The persisted Session manifest is invalid.");
    this.name = "InvalidSessionManifestError";
  }
}

export class AtomicManifestStore implements ManifestStore {
  readonly #storage: ManifestStorage;

  constructor(storage: ManifestStorage) {
    this.#storage = storage;
  }

  async read(sessionId: unknown): Promise<SessionManifest | undefined> {
    const paths = getSessionPersistencePaths(sessionId);
    const content = await this.#storage.readText(paths.manifest);
    if (content === undefined) {
      return undefined;
    }

    let value: unknown;
    try {
      value = JSON.parse(content) as unknown;
    } catch {
      throw new InvalidSessionManifestError("invalid-json");
    }

    const result = sessionManifestSchema.safeParse(value);
    if (!result.success) {
      throw new InvalidSessionManifestError("invalid-schema");
    }

    if (result.data.sessionId !== sessionId) {
      throw new InvalidSessionManifestError("session-mismatch");
    }

    return result.data;
  }

  async write(manifest: unknown): Promise<void> {
    const result = sessionManifestSchema.safeParse(manifest);
    if (!result.success) {
      throw new InvalidSessionManifestError("invalid-schema");
    }

    const paths = getSessionPersistencePaths(result.data.sessionId);
    const temporaryPath = [...paths.directory, `${sessionManifestFileName}.tmp`] as const;
    const content = `${JSON.stringify(result.data)}\n`;

    try {
      await this.#storage.writeText(temporaryPath, content);
      await this.#storage.rename(temporaryPath, paths.manifest);
    } catch (error) {
      await this.#deleteTemporaryFile(temporaryPath);
      throw error;
    }
  }

  async #deleteTemporaryFile(path: PersistencePath): Promise<void> {
    try {
      await this.#storage.deleteFile(path);
    } catch {
      // Preserve the primary write or rename failure; the storage owner may clean stale temp files.
    }
  }
}
