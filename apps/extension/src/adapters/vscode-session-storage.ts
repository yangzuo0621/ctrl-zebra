import {
  AtomicManifestStore,
  type EventStorage,
  JsonlEventStore,
  type ManifestStorage,
  PersistedSessionRepository,
  type PersistencePath,
  type SessionCatalog,
  type SessionRepository,
} from "@ctrl-zebra/core";
import {
  persistenceFormatDirectory,
  persistenceSessionsDirectory,
  sessionManifestFileName,
  sessionManifestSchema,
} from "@ctrl-zebra/protocol";
import { type FileSystem, FileSystemError, FileType, Uri } from "vscode";

export const maxManifestBytes = 65_536;

type SessionFileSystem = Pick<
  FileSystem,
  "createDirectory" | "delete" | "readDirectory" | "readFile" | "rename" | "writeFile"
>;

export class WorkspaceSessionStorageUnavailableError extends Error {
  constructor() {
    super("Open a workspace before starting a persistent CtrlZebra Session.");
    this.name = "WorkspaceSessionStorageUnavailableError";
  }
}

export function createWorkspaceSessionRepositoryProvider(
  storageUri: Uri | undefined,
  fileSystem: SessionFileSystem,
): () => Promise<SessionRepository> {
  let pending: Promise<SessionRepository> | undefined;
  return async () => {
    if (storageUri === undefined) {
      throw new WorkspaceSessionStorageUnavailableError();
    }
    pending ??= createRepository(storageUri, fileSystem);
    return pending;
  };
}

class VsCodeSessionStorage implements ManifestStorage, EventStorage, SessionCatalog {
  readonly #root: Uri;
  readonly #fileSystem: SessionFileSystem;

  constructor(root: Uri, fileSystem: SessionFileSystem) {
    this.#root = root;
    this.#fileSystem = fileSystem;
  }

  async initialize(): Promise<void> {
    await this.#fileSystem.createDirectory(this.#root);
    await this.#fileSystem.createDirectory(Uri.joinPath(this.#root, persistenceSessionsDirectory));
    await this.#fileSystem.createDirectory(
      Uri.joinPath(this.#root, persistenceSessionsDirectory, persistenceFormatDirectory),
    );
  }

  async readText(path: PersistencePath, maxBytes = maxManifestBytes): Promise<string | undefined> {
    const uri = this.#resolve(path);
    let content: Uint8Array;
    try {
      content = await this.#fileSystem.readFile(uri);
    } catch (error) {
      if (isFileNotFound(error)) {
        return undefined;
      }
      throw error;
    }
    if (content.byteLength > maxBytes) {
      throw new RangeError(`Persisted file exceeds the ${maxBytes}-byte read limit.`);
    }
    return new TextDecoder("utf-8", { fatal: true }).decode(content);
  }

  async writeText(path: PersistencePath, content: string): Promise<void> {
    await this.#ensureParent(path);
    const encoded = new TextEncoder().encode(content);
    if (encoded.byteLength > maxManifestBytes) {
      throw new RangeError(`Persisted manifest exceeds the ${maxManifestBytes}-byte limit.`);
    }
    await this.#fileSystem.writeFile(this.#resolve(path), encoded);
  }

  async rename(source: PersistencePath, destination: PersistencePath): Promise<void> {
    await this.#fileSystem.rename(this.#resolve(source), this.#resolve(destination), {
      overwrite: true,
    });
  }

  async deleteFile(path: PersistencePath): Promise<void> {
    try {
      await this.#fileSystem.delete(this.#resolve(path), { recursive: false, useTrash: false });
    } catch (error) {
      if (!isFileNotFound(error)) {
        throw error;
      }
    }
  }

  async appendText(path: PersistencePath, content: string, maxTotalBytes: number): Promise<void> {
    const existing = (await this.readText(path, maxTotalBytes)) ?? "";
    const combined = new TextEncoder().encode(`${existing}${content}`);
    if (combined.byteLength > maxTotalBytes) {
      throw new RangeError(`Persisted event log exceeds the ${maxTotalBytes}-byte limit.`);
    }
    const temporaryPath: PersistencePath = [
      path[0],
      ...path.slice(1, -1),
      `${path[path.length - 1]}.append.tmp`,
    ];
    await this.#ensureParent(temporaryPath);
    await this.#fileSystem.writeFile(this.#resolve(temporaryPath), combined);
    await this.rename(temporaryPath, path);
  }

  async listSessionIds(): Promise<readonly string[]> {
    const directory = Uri.joinPath(
      this.#root,
      persistenceSessionsDirectory,
      persistenceFormatDirectory,
    );
    const entries = await this.#fileSystem.readDirectory(directory);
    const sessionIds: string[] = [];
    for (const [name, type] of entries) {
      if ((type & FileType.Directory) === 0) {
        continue;
      }
      const content = await this.readText([
        persistenceSessionsDirectory,
        persistenceFormatDirectory,
        name,
        sessionManifestFileName,
      ]);
      if (content === undefined) {
        continue;
      }
      let value: unknown;
      try {
        value = JSON.parse(content) as unknown;
      } catch {
        continue;
      }
      const result = sessionManifestSchema.safeParse(value);
      if (result.success) {
        sessionIds.push(result.data.sessionId);
      }
    }
    return sessionIds;
  }

  async #ensureParent(path: PersistencePath): Promise<void> {
    let current = this.#root;
    await this.#fileSystem.createDirectory(current);
    for (const segment of path.slice(0, -1)) {
      assertPathSegment(segment);
      current = Uri.joinPath(current, segment);
      await this.#fileSystem.createDirectory(current);
    }
  }

  #resolve(path: PersistencePath): Uri {
    for (const segment of path) {
      assertPathSegment(segment);
    }
    return Uri.joinPath(this.#root, ...path);
  }
}

async function createRepository(
  storageUri: Uri,
  fileSystem: SessionFileSystem,
): Promise<SessionRepository> {
  const storage = new VsCodeSessionStorage(storageUri, fileSystem);
  await storage.initialize();
  return new PersistedSessionRepository(
    new AtomicManifestStore(storage),
    new JsonlEventStore(storage),
    storage,
  );
}

function assertPathSegment(segment: string): void {
  if (segment.length === 0 || segment === "." || segment === ".." || /[\\/:]/.test(segment)) {
    throw new TypeError("Persistence paths must contain portable relative path segments.");
  }
}

function isFileNotFound(error: unknown): boolean {
  return error instanceof FileSystemError && error.code === "FileNotFound";
}
